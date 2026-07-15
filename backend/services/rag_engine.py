"""
Retrieval-augmented coaching — retrieval over the knowledge base.

The KB is a ChromaDB collection ("coaching_kb", 603 chunks) at
backend/data/chroma_db, embedded offline with intfloat/multilingual-e5-base
(dim 768) by data/rag_collection/embed_and_upsert.py. Each chunk carries
metadata: mode (psy|professional|sport|all), tier, topic, technique_name, etc.

This module is the ONLY runtime consumer of that KB. It is called from
llm_service before each coaching reply to ground the coach in evidence-based
material. It FAILS OPEN: if RAG is disabled, the model/DB can't load, or a query
errors, retrieve() returns [] and the coaching turn proceeds normally.

The embedding model + Chroma collection are loaded lazily as process-wide
singletons (guarded by a lock) on first use, and can be warmed off the request
path via warmup().
"""
import os
import threading
from pathlib import Path

from config import settings

# rag_engine.py lives in backend/services/, so parent.parent is backend/.
_BACKEND_DIR = Path(__file__).resolve().parent.parent

_model = None
_collection = None
_lock = threading.Lock()
_init_failed = False


def _db_path() -> str:
    """Resolve the Chroma store path (default: backend/data/chroma_db)."""
    p = settings.rag_db_path
    if not p:
        return str(_BACKEND_DIR / "data" / "chroma_db")
    return p if os.path.isabs(p) else str(_BACKEND_DIR / p)


def _ensure_loaded() -> bool:
    """Load the embedding model + collection once. Returns False (permanently)
    if loading fails, so we don't retry a broken setup on every turn."""
    global _model, _collection, _init_failed
    if _init_failed:
        return False
    if _model is not None and _collection is not None:
        return True
    with _lock:
        if _model is not None and _collection is not None:
            return True
        if _init_failed:
            return False
        try:
            # Imported lazily so importing rag_engine (and thus llm_service)
            # stays cheap and never fails on a heavy/missing ML dependency.
            import chromadb
            from sentence_transformers import SentenceTransformer

            # local_files_only: the model is already cached, so never hit the
            # network. Without this, sentence-transformers does an online HEAD
            # check on huggingface.co and fails hard when the box is offline /
            # DNS is flaky ("getaddrinfo failed"), disabling RAG needlessly.
            try:
                model = SentenceTransformer(settings.rag_embed_model, local_files_only=True)
            except Exception:
                # Fall back to a normal (possibly online) load if the cache is
                # incomplete or the kwarg isn't supported by this version.
                model = SentenceTransformer(settings.rag_embed_model)
            client = chromadb.PersistentClient(path=_db_path())
            collection = client.get_collection(settings.rag_collection)
            _model = model
            _collection = collection
            print(
                f"[rag] loaded collection '{settings.rag_collection}' "
                f"({collection.count()} docs) with {settings.rag_embed_model}"
            )
            return True
        except Exception as e:
            print(f"[rag] disabled — could not load knowledge base: {e}")
            _init_failed = True
            return False


def warmup() -> None:
    """Best-effort preload (e.g. from a startup background thread) so the first
    coaching turn doesn't pay the model-load cost. Never raises."""
    if not settings.rag_enabled:
        return
    try:
        _ensure_loaded()
    except Exception as e:  # defensive — _ensure_loaded already swallows errors
        print(f"[rag] warmup error: {e}")


def retrieve(query: str, mode: str, k: int | None = None) -> list[dict]:
    """Return up to k KB chunks relevant to `query`, filtered to the session's
    mode (plus cross-mode 'all'). Empty list on any failure or if disabled.

    Returns: list of {"text": str, "metadata": dict, "distance": float}.
    """
    if not settings.rag_enabled or not query or not query.strip():
        return []
    if not _ensure_loaded():
        return []
    k = k or settings.rag_top_k
    try:
        # e5 is asymmetric: queries take a "query: " prefix (documents were
        # embedded with "passage: "), embeddings L2-normalized to match indexing.
        emb = _model.encode([f"query: {query}"], normalize_embeddings=True).tolist()
        res = _collection.query(
            query_embeddings=emb,
            n_results=k,
            where={"mode": {"$in": [mode, "all"]}},
        )
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        return [
            {"text": t, "metadata": m or {}, "distance": d}
            for t, m, d in zip(docs, metas, dists)
        ]
    except Exception as e:
        print(f"[rag] retrieval error: {e}")
        return []


def build_context_block(chunks: list[dict], max_chars: int | None = None) -> str:
    """Format retrieved chunks into a bounded grounding block for the system
    instruction. Returns '' when there are no chunks."""
    if not chunks:
        return ""
    max_chars = max_chars if max_chars is not None else settings.rag_max_context_chars
    lines: list[str] = []
    used = 0
    for i, c in enumerate(chunks, 1):
        meta = c.get("metadata") or {}
        src = (
            meta.get("technique_name")
            or meta.get("source_name")
            or meta.get("topic")
            or meta.get("tier")
            or "reference"
        )
        snippet = " ".join((c.get("text") or "").split())
        entry = f"[{i}] ({src}) {snippet}"
        if used + len(entry) > max_chars:
            entry = entry[: max(0, max_chars - used)].rstrip()
            if entry:
                lines.append(entry)
            break
        lines.append(entry)
        used += len(entry) + 1
    if not lines:
        return ""
    return (
        "Relevant evidence-based coaching material (draw on it to ground your "
        "reply when helpful; do not quote it verbatim or mention these notes):\n"
        + "\n".join(lines)
    )


def context_for(query: str, mode: str) -> str:
    """Convenience: retrieve + format in one call. Returns '' if nothing (or on
    any failure)."""
    return build_context_block(retrieve(query, mode))
