"""Clean up test artifacts from the embed_and_upsert validation test."""
import chromadb
from pathlib import Path

c = chromadb.PersistentClient(path=r"backend\data\chroma_db").get_collection("coaching_kb")
before = c.count()
existing = c.get(ids=["test_valid_001"], include=[])
if existing["ids"]:
    c.delete(ids=["test_valid_001"])
    print(f"Removed test_valid_001 from collection")
print(f"Collection count: {before} -> {c.count()}")

for f in ["test_validation.jsonl", "_run_test.py", "_check_count.py"]:
    p = Path(f"backend/data/rag_collection/{f}")
    if p.exists():
        p.unlink()
        print(f"Removed {f}")

print("Cleanup complete")
