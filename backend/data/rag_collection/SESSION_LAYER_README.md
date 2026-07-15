# EchoCoach RAG Session Layer Collector

Adds Tier A/B/C/D/E session-practitioner content to the existing ChromaDB
collection at `backend/data/chroma_db`, collection `coaching_kb`.

## Files

| File | Role |
|---|---|
| `sources_config.py` | Registry of PDF URLs, PubMed queries, and metadata tags. Add sport-mode URLs here before running if needed. |
| `collect_session_sources.py` | Downloads PDFs, validates them, extracts text, chunks, and stages JSONL. |
| `collect_pubmed_openaccess.py` | Pulls open-access abstracts from PubMed Central via E-utilities. |
| `signal_mappings_template.yaml` | Template for hand-written signal-to-response entries. Copy to `signal_mappings.yaml` and fill it in. |
| `load_signal_mappings.py` | Converts filled YAML mappings into staged JSONL docs. |
| `embed_and_upsert.py` | Embeds all staged JSONL docs and upserts into `coaching_kb`. Run last. |

## Run Order

From `backend/data/rag_collection`:

```bash
python collect_session_sources.py
python collect_pubmed_openaccess.py
copy signal_mappings_template.yaml signal_mappings.yaml
python load_signal_mappings.py signal_mappings.yaml
python embed_and_upsert.py
```

Check `staged_chunks/collection_report.json` and
`staged_chunks/pubmed_collection_report.json` for failed or empty sources.

`embed_and_upsert.py` upserts by document id, so re-running the same staged
content is safe.
