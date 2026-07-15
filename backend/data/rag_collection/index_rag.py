"""
RAG Chunker & ChromaDB Indexer for EchoCoach
==============================================
Takes all three tiers of content and indexes them into ChromaDB.

Tier 1: Technique cards (JSON) -> 1 card = 1 chunk (already right size)
Tier 2: Blog articles (JSON with text field) -> 512 tokens, 64 overlap
Tier 3: PubMed abstracts (JSON) -> 1 abstract = 1 chunk

Usage:
    python index_rag.py \
        --techniques ./data/techniques \
        --articles ./data/articles \
        --abstracts ./data/abstracts \
        --db ./data/chroma_db

Requires:
    pip install chromadb sentence-transformers tiktoken
"""

import json
import argparse
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(_enc.encode(text))
except ImportError:
    def count_tokens(text: str) -> int:
        return len(text.split()) * 4 // 3


# —— Chunking ——————————————————————————————————————————————————————————————

def chunk_text(text: str, max_tokens: int = 512, overlap_tokens: int = 64) -> list[str]:
    """Split text into overlapping chunks of ~max_tokens."""
    words = text.split()
    words_per_chunk = int(max_tokens * 0.75)
    overlap_words = int(overlap_tokens * 0.75)

    if len(words) <= words_per_chunk:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = start + words_per_chunk
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        start = end - overlap_words

    return chunks


# —— Tier 1: Technique Cards ——————————————————————————————————————————————

def index_techniques(collection, techniques_dir: Path) -> int:
    """Index technique cards. Each card = 1 chunk."""
    count = 0
    for mode_dir in sorted(techniques_dir.iterdir()):
        if not mode_dir.is_dir():
            continue
        for filepath in sorted(mode_dir.glob("*.json")):
            with open(filepath, "r", encoding="utf-8") as f:
                card = json.load(f)

            parts = [
                f"Technique: {card['technique']}",
                f"Framework: {card['source_framework']}",
                f"Source: {card['source_citation']}",
                f"Problem: {card['problem_it_solves']}",
                f"\n{card['description']}",
                f"\nWhen to use: {card['when_to_use']}",
                f"\nPractice drill: {card['practice_drill']}",
                f"\nCommon mistakes: {card['common_mistakes']}",
            ]
            text = "\n".join(parts)

            doc_id = card.get("id", filepath.stem)
            metadata = {
                "mode": card["mode"],
                "topic": ",".join(card.get("topics", [])),
                "technique_name": card["technique"],
                "source_framework": card["source_framework"],
                "content_type": "technique_card",
                "scenarios": ",".join(card.get("applicable_scenarios", [])),
                "detected_signals": ",".join(card.get("detected_signals", [])),
            }

            collection.upsert(
                ids=[doc_id],
                documents=[text],
                metadatas=[metadata],
            )
            count += 1
            print(f"  + [technique] {card['technique']} ({card['mode']})")

    return count


# —— Tier 2: Blog Articles —————————————————————————————————————————————————

def index_articles(collection, articles_dir: Path) -> int:
    """Index scraped articles. Chunked at 512 tokens."""
    count = 0
    for mode_dir in sorted(articles_dir.iterdir()):
        if not mode_dir.is_dir():
            continue
        for filepath in sorted(mode_dir.glob("*.json")):
            with open(filepath, "r", encoding="utf-8") as f:
                article = json.load(f)

            text = article.get("text", "")
            if not text or len(text) < 100:
                continue

            chunks = chunk_text(text)
            title = article.get("title", filepath.stem)

            for i, chunk in enumerate(chunks):
                doc_id = f"{filepath.stem}_chunk_{i}"
                metadata = {
                    "mode": article.get("mode", "unknown"),
                    "topic": article.get("topic", ""),
                    "content_type": "web_article",
                    "source_title": title[:200],
                    "source_url": article.get("url", ""),
                    "source_domain": article.get("domain", ""),
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                }

                collection.upsert(
                    ids=[doc_id],
                    documents=[chunk],
                    metadatas=[metadata],
                )
                count += 1

            print(f"  + [article] {title[:50]}... -> {len(chunks)} chunks ({article.get('mode', '?')})")

    return count


# —— Tier 3: PubMed Abstracts ———————————————————————————————————————————

def index_abstracts(collection, abstracts_dir: Path) -> int:
    """Index PubMed abstracts. Each abstract = 1 chunk."""
    count = 0
    for mode_dir in sorted(abstracts_dir.iterdir()):
        if not mode_dir.is_dir():
            continue
        for filepath in sorted(mode_dir.glob("*.json")):
            with open(filepath, "r", encoding="utf-8") as f:
                paper = json.load(f)

            abstract = paper.get("abstract", "")
            if not abstract or len(abstract) < 50:
                continue

            text = f"{paper.get('title', '')}. {abstract}"

            authors_str = ", ".join(paper.get("authors", [])[:3])
            doc_id = f"pubmed_{paper.get('pmid', filepath.stem)}"

            metadata = {
                "mode": paper.get("mode", "unknown"),
                "topic": paper.get("topic", ""),
                "content_type": "research_abstract",
                "title": paper.get("title", "")[:200],
                "authors": authors_str[:200],
                "year": paper.get("year", ""),
                "journal": paper.get("journal", "")[:200],
                "pmid": paper.get("pmid", ""),
                "doi": paper.get("doi", ""),
                "pubmed_url": paper.get("pubmed_url", ""),
            }

            collection.upsert(
                ids=[doc_id],
                documents=[text],
                metadatas=[metadata],
            )
            count += 1

            first_author = paper.get("authors", ["Unknown"])[0].split()[0]
            print(f"  + [abstract] {first_author} ({paper.get('year', '?')}) — {paper.get('title', '')[:50]}...")

    return count


# —— Main —————————————————————————————————————————————————————————————————

def main():
    parser = argparse.ArgumentParser(description="Index RAG content into ChromaDB")
    parser.add_argument("--techniques", default="./data/techniques", help="Technique cards directory")
    parser.add_argument("--articles", default="./data/articles", help="Scraped articles directory")
    parser.add_argument("--abstracts", default="./data/abstracts", help="PubMed abstracts directory")
    parser.add_argument("--db", default="./data/chroma_db", help="ChromaDB storage directory")
    parser.add_argument("--collection", default="coaching_kb", help="ChromaDB collection name")
    parser.add_argument("--reset", action="store_true", help="Delete existing collection first")
    args = parser.parse_args()

    print("Initializing ChromaDB with multilingual-e5-base embeddings...")
    print("(First run downloads the model ~1.1GB, takes a few minutes)\n")

    ef = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="intfloat/multilingual-e5-base"
    )
    client = chromadb.PersistentClient(path=args.db)

    if args.reset:
        try:
            client.delete_collection(args.collection)
            print("Deleted existing collection\n")
        except ValueError:
            pass

    collection = client.get_or_create_collection(
        name=args.collection,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )

    total = 0

    techniques_path = Path(args.techniques)
    if techniques_path.exists():
        print("--- Tier 1: Technique Cards ---")
        n = index_techniques(collection, techniques_path)
        total += n
        print(f"   -> {n} technique cards indexed\n")
    else:
        print(f"! Techniques dir not found: {techniques_path}\n")

    articles_path = Path(args.articles)
    if articles_path.exists():
        print("--- Tier 2: Blog Articles ---")
        n = index_articles(collection, articles_path)
        total += n
        print(f"   -> {n} article chunks indexed\n")
    else:
        print(f"! Articles dir not found: {articles_path}\n")

    abstracts_path = Path(args.abstracts)
    if abstracts_path.exists():
        print("--- Tier 3: PubMed Abstracts ---")
        n = index_abstracts(collection, abstracts_path)
        total += n
        print(f"   -> {n} abstracts indexed\n")
    else:
        print(f"! Abstracts dir not found: {abstracts_path}\n")

    print(f"{'='*60}")
    print(f"RAG indexing complete!")
    print(f"   Total documents in collection: {collection.count()}")
    print(f"   ChromaDB path: {Path(args.db).resolve()}")

    print(f"\n{'='*60}")
    print("Sanity test — querying: 'how to handle silence during negotiation'")
    results = collection.query(
        query_texts=["how to handle silence during negotiation"],
        n_results=3,
    )
    for i, (doc, meta) in enumerate(zip(results["documents"][0], results["metadatas"][0])):
        print(f"\n  Result {i+1} [{meta.get('content_type', '?')}] ({meta.get('mode', '?')}/{meta.get('topic', '?')})")
        print(f"  {doc[:150]}...")


if __name__ == "__main__":
    main()
