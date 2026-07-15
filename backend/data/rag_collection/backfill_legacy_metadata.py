"""
Backfill `tier` and `language` metadata on legacy documents in the
`coaching_kb` ChromaDB collection.

Metadata-only: uses collection.update() to patch metadatas. Never touches
`documents` or embeddings, never deletes anything.

Classifies each doc into one of four buckets (matches the diagnostic audit):
  A - legacy technique cards   -> tier=technique
  B - legacy PubMed abstracts  -> tier=abstract
  C - legacy web articles      -> tier=article
  D - already correct (Codex)  -> skip

Anything that doesn't match any bucket is left untouched and reported as
unclassified for manual review.

Usage:
    python backfill_legacy_metadata.py --dry-run   # preview only, no writes
    python backfill_legacy_metadata.py              # apply the backfill
"""
import argparse
import copy
import json
import os
import sys

import chromadb

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "chroma_db"))
COLLECTION_NAME = "coaching_kb"


def classify(md: dict) -> str:
    md = md or {}
    source_url = md.get("source_url") or ""
    is_pmc_new = "/pmc/articles/" in source_url

    if is_pmc_new and md.get("tier"):
        return "D"

    if md.get("technique_name") or md.get("content_type") == "technique_card":
        return "A"

    if (md.get("pmid") or md.get("doi")) and not is_pmc_new:
        return "B"

    if md.get("content_type") == "web_article":
        return "C"

    return None


BUCKET_TIER = {"A": "technique", "B": "abstract", "C": "article"}


def build_updated_metadata(md: dict, bucket: str) -> dict:
    new_md = copy.deepcopy(md or {})
    new_md["tier"] = BUCKET_TIER[bucket]
    if not new_md.get("language"):
        new_md["language"] = "en"
    return new_md


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                         help="Preview changes without calling collection.update()")
    args = parser.parse_args()

    print(f"Connecting to PersistentClient at: {DB_PATH}")
    client = chromadb.PersistentClient(path=DB_PATH)
    collection = client.get_collection(name=COLLECTION_NAME)

    result = collection.get(include=["metadatas", "documents"])
    ids = result["ids"]
    metadatas = result["metadatas"] or []
    total = len(ids)

    buckets = {"A": [], "B": [], "C": [], "D": []}
    unclassified = []

    for doc_id, md in zip(ids, metadatas):
        bucket = classify(md)
        if bucket is None:
            unclassified.append((doc_id, md))
            continue
        buckets[bucket].append((doc_id, md))

    print("\n" + "=" * 60)
    print("CLASSIFICATION SUMMARY")
    print("=" * 60)
    labels = {
        "A": "Bucket A - legacy technique cards (expected 60)",
        "B": "Bucket B - legacy PubMed abstracts (expected 93)",
        "C": "Bucket C - legacy web articles (expected 39)",
        "D": "Bucket D - already correct / Codex PubMed (expected 65, skipped)",
    }
    for key in ["A", "B", "C", "D"]:
        print(f"  {labels[key]}: {len(buckets[key])}")
    print(f"  Unclassified (untouched, needs manual review): {len(unclassified)}")
    print(f"  Total: {total}")

    for key in ["A", "B", "C"]:
        print("\n" + "-" * 60)
        print(f"SAMPLE — Bucket {key} (showing up to 3 of {len(buckets[key])})")
        print("-" * 60)
        for doc_id, md in buckets[key][:3]:
            new_md = build_updated_metadata(md, key)
            print(f"\n  id: {doc_id}")
            print(f"  BEFORE: {json.dumps(md, ensure_ascii=False)}")
            print(f"  AFTER:  {json.dumps(new_md, ensure_ascii=False)}")

    if unclassified:
        print("\n" + "=" * 60)
        print("UNCLASSIFIED DOCUMENTS (left untouched — needs manual review)")
        print("=" * 60)
        for doc_id, md in unclassified:
            print(f"  id: {doc_id}")
            print(f"    metadata: {json.dumps(md, ensure_ascii=False)}")

    if args.dry_run:
        print("\n" + "=" * 60)
        print("DRY RUN — no changes were written to the collection.")
        print("=" * 60)
        return

    # ---- Apply updates for buckets A, B, C only ----
    update_ids = []
    update_metadatas = []
    for key in ["A", "B", "C"]:
        for doc_id, md in buckets[key]:
            update_ids.append(doc_id)
            update_metadatas.append(build_updated_metadata(md, key))

    if not update_ids:
        print("\nNothing to update.")
        return

    print(f"\nApplying metadata-only update to {len(update_ids)} documents ...")
    collection.update(ids=update_ids, metadatas=update_metadatas)
    print("Done. Documents and embeddings were not touched.")


if __name__ == "__main__":
    main()
