"""
embed_and_upsert.py
---------------------
Reads every staged .jsonl file in ./staged_chunks/, validates each document's
metadata and text, embeds the text with multilingual-e5-base, and upserts into
your existing ChromaDB collection at backend/data/chroma_db.

Validation is performed BEFORE upsert — no malformed document reaches the
vector store.

Requirements: chromadb sentence-transformers tqdm

Usage:
    python embed_and_upsert.py --db-path ../backend/data/chroma_db \
                                --collection echocoach_knowledge
"""

import json
import sys
import argparse
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

BASE_DIR = Path(__file__).resolve().parent
STAGE_DIR = BASE_DIR / "staged_chunks"
DEFAULT_DB_PATH = BASE_DIR.parent / "chroma_db"
EMBED_MODEL_NAME = "intfloat/multilingual-e5-base"
BATCH_SIZE = 32

# ── Valid values for required metadata fields ──────────────────────────────
VALID_TIERS = {"technique", "article", "abstract", "session_guide", "signal_mapping"}
VALID_MODES = {"psy", "professional", "sport", "all"}
VALID_LANGUAGES = {"en", "fr", "ar"}

MIN_TEXT_LENGTH = 100
WARN_TEXT_LENGTH = 5000  # warn but don't block above this


def validate_document(doc: dict) -> list[str]:
    """
    Validate a single staged document.

    Returns a list of error messages (empty list = valid).
    """
    errors: list[str] = []
    doc_id = doc.get("id", "<no-id>")
    metadata = doc.get("metadata", {})
    text = doc.get("text", "")

    # ── text validation ────────────────────────────────────────────────────
    if not isinstance(text, str) or not text.strip():
        errors.append(f"[{doc_id}] text: empty or not a string")
    elif len(text.strip()) < MIN_TEXT_LENGTH:
        errors.append(
            f"[{doc_id}] text: too short ({len(text.strip())} chars, "
            f"minimum {MIN_TEXT_LENGTH})"
        )
    elif len(text.strip()) > WARN_TEXT_LENGTH:
        # warn but don't block — some legitimate chunks may be longer
        print(
            f"  [WARN] [{doc_id}] text: {len(text.strip())} chars "
            f"(exceeds {WARN_TEXT_LENGTH} — verify this is intentional)"
        )

    # ── metadata validation ────────────────────────────────────────────────
    tier = metadata.get("tier")
    if not tier:
        errors.append(f"[{doc_id}] metadata.tier: missing or empty")
    elif tier not in VALID_TIERS:
        errors.append(
            f"[{doc_id}] metadata.tier: invalid value {tier!r} "
            f"(must be one of {sorted(VALID_TIERS)})"
        )

    mode = metadata.get("mode")
    if not mode:
        errors.append(f"[{doc_id}] metadata.mode: missing or empty")
    elif mode not in VALID_MODES:
        errors.append(
            f"[{doc_id}] metadata.mode: invalid value {mode!r} "
            f"(must be one of {sorted(VALID_MODES)})"
        )

    language = metadata.get("language")
    if not language:
        errors.append(f"[{doc_id}] metadata.language: missing or empty")
    elif language not in VALID_LANGUAGES:
        errors.append(
            f"[{doc_id}] metadata.language: invalid value {language!r} "
            f"(must be one of {sorted(VALID_LANGUAGES)})"
        )

    return errors


def load_staged_docs() -> list[dict]:
    docs = []
    for jsonl_file in STAGE_DIR.glob("*.jsonl"):
        with open(jsonl_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                docs.append(json.loads(line))
    return docs


def embed_texts(model: SentenceTransformer, texts: list[str]) -> list[list[float]]:
    # e5 models expect a "passage: " prefix for documents being indexed
    # (and "query: " prefix at retrieval time in rag_engine.py — make sure
    # that's already the case there, since e5 embeddings are asymmetric).
    prefixed = [f"passage: {t}" for t in texts]
    embeddings = model.encode(prefixed, batch_size=BATCH_SIZE, show_progress_bar=False,
                               normalize_embeddings=True)
    return embeddings.tolist()


def run(db_path: str, collection_name: str):
    docs = load_staged_docs()
    if not docs:
        print("No staged documents found in ./staged_chunks/. "
              "Run the collector scripts first.")
        return

    print(f"Loaded {len(docs)} staged documents across all tiers.")

    # ── Step 1: Validate all documents before any upsert ───────────────────
    print("Validating documents...")
    valid_docs: list[dict] = []
    validation_failures: list[dict] = []

    for doc in docs:
        errors = validate_document(doc)
        if errors:
            validation_failures.append({
                "id": doc.get("id", "<no-id>"),
                "errors": errors,
            })
        else:
            valid_docs.append(doc)

    if validation_failures:
        print(f"\n{'=' * 60}")
        print(f"VALIDATION FAILURES: {len(validation_failures)} document(s) "
              f"rejected")
        print(f"{'=' * 60}")
        for fail in validation_failures:
            print(f"  Document: {fail['id']}")
            for err in fail["errors"]:
                print(f"    - {err}")
        print(f"\n{len(valid_docs)} valid document(s) will be processed.\n")

    if not valid_docs:
        print("No valid documents to embed. Exiting with code 1.")
        sys.exit(1)

    # ── Step 2: Load embedding model ───────────────────────────────────────
    print(f"Loading embedding model: {EMBED_MODEL_NAME} ...")
    model = SentenceTransformer(EMBED_MODEL_NAME)

    # ── Step 3: Connect to ChromaDB ────────────────────────────────────────
    client = chromadb.PersistentClient(path=db_path)
    collection = client.get_or_create_collection(name=collection_name)

    existing_ids = set(collection.get(include=[])["ids"]) if collection.count() > 0 else set()
    new_docs = [d for d in valid_docs if d["id"] not in existing_ids]
    skipped = len(valid_docs) - len(new_docs)
    if skipped:
        print(f"Skipping {skipped} docs already present in the collection (by id).")

    if not new_docs:
        print("Nothing new to add.")
        return

    # ── Step 4: Compute summary from validated data BEFORE upsert ──────────
    tier_counts = {}
    mode_counts = {}

    for d in new_docs:
        t = d["metadata"]["tier"]
        m = d["metadata"]["mode"]
        tier_counts[t] = tier_counts.get(t, 0) + 1
        mode_counts[m] = mode_counts.get(m, 0) + 1

    # ── Step 5: Embed and upsert in batches ────────────────────────────────
    for i in tqdm(range(0, len(new_docs), BATCH_SIZE), desc="Embedding + upserting"):
        batch = new_docs[i:i + BATCH_SIZE]
        texts = [d["text"] for d in batch]
        ids = [d["id"] for d in batch]
        metadatas = [d["metadata"] for d in batch]

        embeddings = embed_texts(model, texts)

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas,
        )

    # ── Step 6: Report ─────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("UPSERT COMPLETE")
    print("=" * 60)
    print(f"Documents processed: {len(docs)}")
    print(f"  - Valid:           {len(valid_docs)}")
    print(f"  - Failed validation: {len(validation_failures)}")
    print(f"  - Already in DB (skipped): {skipped}")
    print(f"  - Newly upserted:  {len(new_docs)}")
    print(f"Collection total now: {collection.count()}")
    print("\nBy tier:")
    for t, c in sorted(tier_counts.items()):
        print(f"  {t:<16} {c}")
    print("\nBy mode:")
    for m, c in sorted(mode_counts.items()):
        print(f"  {m:<16} {c}")

    if validation_failures:
        print(f"\n{'!' * 60}")
        print(f"WARNING: {len(validation_failures)} document(s) failed "
              f"validation and were NOT upserted.")
        print(f"{'!' * 60}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH),
                         help="Path to existing ChromaDB persistent store")
    parser.add_argument("--collection", default="coaching_kb",
                         help="Collection name to upsert into")
    args = parser.parse_args()
    run(args.db_path, args.collection)