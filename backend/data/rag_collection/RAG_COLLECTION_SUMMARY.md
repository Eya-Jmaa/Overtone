# EchoCoach RAG Collection — Complete Summary

**Generated:** 2026-07-01  
**Vector Store:** ChromaDB at `backend/data/chroma_db`  
**Collection Name:** `coaching_kb`  
**Total Documents in DB:** 603

---

## 1. Collection Pipelines

The RAG corpus is built from **4 distinct collection pipelines**, each targeting a different source type:

| Pipeline | Source Type | Collector Script |
|---|---|---|
| **Session Guides** | PDFs & HTML (therapist manuals, guides) | `collect_session_sources.py` |
| **PubMed Abstracts** | PubMed Central open-access abstracts | `collect_pubmed_openaccess.py` |
| **Web Articles** | Blog posts, psychology articles | `collect_articles.py` |
| **Academic Papers** | DOI-based paper PDFs + metadata | `collect_papers.py` |

---

## 2. Documents by Tier (Content Type)

| Tier | Count | Description |
|---|---|---|
| **session_guide** | 346 | Full therapist manuals, MI guides, CBT protocols |
| **abstract** | 158 | PubMed research abstracts |
| **technique** | 60 | Structured coaching technique descriptions |
| **article** | 39 | Web articles from psychology/coaching sources |
| **signal_mapping** | 0 | (Planned — not yet populated) |
| **Total** | **603** | |

---

## 3. Documents by Mode (Domain)

| Mode | Count | Description |
|---|---|---|
| **psy** | 364 | Psychology/therapy (MI, CBT, Gottman, NVC, attachment, etc.) |
| **sport** | 155 | Sports psychology (self-talk, imagery, flow, anxiety) |
| **professional** | 70 | Professional coaching (negotiation, feedback, assertiveness) |
| **all** | 14 | Cross-mode content (therapeutic alliance repair) |
| **Total** | **603** | |

---

## 4. Tier × Mode Matrix

| Tier | psy | professional | sport | all |
|---|---|---|---|---|
| **session_guide** | 247 | 0 | 85 | 14 |
| **abstract** | 72 | 36 | 50 | 0 |
| **technique** | 20 | 20 | 20 | 0 |
| **article** | 25 | 14 | 0 | 0 |

---

## 5. Session Guide Sources (Downloaded PDFs/HTML)

These are the core therapist/coach manuals, chunked and embedded:

| Source | Chunks | Status |
|---|---|---|
| SAMHSA TIP 35 — Enhancing Motivation for Change | 159 | ✅ Downloaded |
| VA Brief CBT Therapist Manual | 54 | ✅ Downloaded |
| VA CBT for Chronic Pain Therapist Manual | 83 | ✅ Downloaded |
| Dancing Gecko MI Guided Dialogue | 17 | ✅ Downloaded |
| Clinical Consensus — Alliance Rupture Repair (PMC) | 14 | ✅ Downloaded |
| Iowa MI Example Conversation | 6 | ✅ Downloaded |
| CT DCF MI Refresher — Reflective Listening | 4 | ✅ Downloaded |
| Person-Centered Therapy — StatPearls (NCBI) | 4 | ✅ Downloaded |
| UNH MI Basics OARS | 3 | ✅ Downloaded |
| Ohio State Imagery in Sport Guide | 2 | ✅ Downloaded |
| **Total session_guide chunks** | **346** | |

### Failed Downloads (not in DB)

| Source | Reason |
|---|---|
| SAMHSA Quick Guide for Clinicians (TIP 35) | 403 Forbidden |
| SAMHSA MI Advisory | 403 Forbidden |
| CAMH CBT Information Guide | Empty text (scanned PDF) |
| ICF Core Competencies 2025 | 403 Forbidden |
| ICF Competencies Comparison 2025 | 403 Forbidden |
| USMC Performance Imagery Script Guide | 403 Forbidden |

---

## 6. PubMed Abstracts (Open Access)

65 abstracts fetched from PubMed Central across 6 queries:

| Query | Mode | Fetched |
|---|---|---|
| motivational interviewing session structure | psy | 14 |
| person centered therapy core conditions Rogers | psy | 9 |
| therapeutic rupture repair alliance | psy | 8 |
| executive coaching session effectiveness | professional | 10 |
| sport psychology pre-performance routine | sport | 15 |
| self-talk restructuring athletes intervention | sport | 9 |
| **Total** | | **65** |

---

## 7. Web Articles (Scraped)

15 articles scraped from psychology/coaching websites:

### psy (8 articles)
- Gottman: Four Horsemen, Soft Startup, Repair Attempts, 5:1 Ratio
- CNVC: NVC Overview
- VeryWellMind: Emotion Regulation Skills, Active Listening, Attachment Theory

### professional (6 articles)
- PON Harvard: BATNA in Practice, Salary Negotiation
- CCL: SBI Feedback Model
- MindTools: Assertiveness, Conflict Resolution
- Kilmann Diagnostics: TKI Conflict Modes

### sport (1 article)
- AASP: Athlete Mental Performance Resources

---

## 8. Academic Papers (DOI-based)

9 papers targeted via Unpaywall/OpenAlex:

| DOI | Mode | Topic | Status |
|---|---|---|---|
| 10.1037/0022-3514.85.2.348 | psy | emotion_regulation_reappraisal | ? |
| 10.1023/A:1024569803230 | psy | attachment_conflict | ? |
| 10.1037/1089-2680.2.3.271 | psy | emotion_regulation | ? |
| 10.1037/0022-3514.85.2.348 | psy | emotion_regulation | ? |
| 10.1017/s0048577201393198 | psy | emotion_regulation | ? |
| 10.1177/1745691611413136 | psy | self_talk | ? |
| 10.1037/2F0022-3514.64.6.970 | psy | emotion_regulation | ? |
| 10.1037/2F0022-3514.63.2.221 | psy | conflict_relationships | ? |

*(Status depends on whether `collect_papers.py` was run with an email for Unpaywall)*

---

## 9. Metadata Health

| Metric | Value |
|---|---|
| Documents with `mode` populated | 100% |
| Documents with `tier` populated | 100% |
| Documents with `language` populated | 100% (all English) |
| Documents with `source_url` | 74.6% |
| Documents with `source_name` | 68.2% |
| Documents with `purpose` | 68.2% |
| Documents with `source_type` | 57.4% |
| Documents with `title` | 15.4% (abstracts only) |
| Documents with `doi` | 15.3% |
| Documents with `year` | 15.4% |

---

## 10. Known Gaps

1. **`signal_mapping` tier** — 0 documents (planned but not implemented)
2. **`session_guide` for professional mode** — 0 documents (ICF PDFs failed to download)
3. **`article` for sport mode** — 0 documents
4. **`article` for `all` mode** — 0 documents
5. **`abstract` for `all` mode** — 0 documents
6. **`technique` for `all` mode** — 0 documents
7. **2 documents under 100 chars** — likely need review
8. **257 documents missing `source` field** — metadata inconsistency across pipelines

---

## 11. Chunk Size Statistics

| Metric | Value |
|---|---|
| Min chunk size | 58 chars |
| Max chunk size | 12,618 chars |
| Mean chunk size | 3,663 chars |
| Median chunk size | 3,888 chars |
| Chunks over 3,000 chars | 385 (63.8%) |
| Chunks under 100 chars | 2 |

---

## 12. Embedding Model

- **Model:** `intfloat/multilingual-e5-base`
- **Prefix:** `passage: ` for indexing, `query: ` for retrieval
- **Normalization:** L2-normalized embeddings
- **Batch size:** 32

---

## 13. Pipeline Scripts Overview

| Script | Purpose |
|---|---|
| `collect_session_sources.py` | Downloads PDFs/HTML from `sources_config.py`, extracts text, chunks, stages JSONL |
| `collect_pubmed_openaccess.py` | Searches PMC via E-utilities, fetches abstracts, stages JSONL |
| `collect_articles.py` | Scrapes web articles via newspaper3k/BeautifulSoup, saves as JSON |
| `collect_papers.py` | Fetches full PDFs via Unpaywall/OpenAlex by DOI |
| `collect_abstracts.py` | (Legacy) Fetches PubMed abstracts by keyword query |
| `embed_and_upsert.py` | Validates, embeds, and upserts all staged JSONL into ChromaDB |
| `index_rag.py` | (Likely) Orchestrates the full pipeline |
| `audit_collection.py` | Generates the audit report with tier/mode matrix and metadata health |
| `backfill_legacy_metadata.py` | Normalizes metadata from older collection runs |
| `load_signal_mappings.py` | (Planned) Loads signal mapping templates |
| `verify_session_urls.py` | Checks URL accessibility for session sources |
| `_cleanup_test.py` | Test/cleanup utility |