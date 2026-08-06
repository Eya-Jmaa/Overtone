"""collect_pubmed_openaccess.py — Pulls open-access abstracts from PubMed Central via NCBI E-utilities, tagged by mode/tier the same way your existing 93 PubMed abstracts were."""

import json
import time
import hashlib
from pathlib import Path

import requests
from tqdm import tqdm

from sources_config import PUBMED_QUERIES

BASE_DIR = Path(__file__).resolve().parent
STAGE_DIR = BASE_DIR / "staged_chunks"
STAGE_DIR.mkdir(exist_ok=True)

NCBI_API_KEY = None
ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

REQUEST_DELAY = 0.4


def esearch_pmc(query: str, max_results: int) -> list[str]:
    params = {
        "db": "pmc",
        "term": f"{query} AND open access[filter]",
        "retmax": max_results,
        "retmode": "json",
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY
    resp = requests.get(ESEARCH_URL, params=params, timeout=20)
    resp.raise_for_status()
    return resp.json().get("esearchresult", {}).get("idlist", [])


def efetch_abstract(pmcid: str) -> dict | None:
    params = {"db": "pmc", "id": pmcid, "rettype": "abstract", "retmode": "xml"}
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY
    resp = requests.get(EFETCH_URL, params=params, timeout=20)
    resp.raise_for_status()
    xml_text = resp.text

    import re
    title_match = re.search(r"<article-title>(.*?)</article-title>", xml_text, re.DOTALL)
    abstract_match = re.search(r"<abstract.*?>(.*?)</abstract>", xml_text, re.DOTALL)

    if not abstract_match:
        return None

    def clean(s: str) -> str:
        return re.sub(r"<[^>]+>", " ", s).strip()

    title = clean(title_match.group(1)) if title_match else "Untitled"
    abstract = clean(abstract_match.group(1))

    if len(abstract) < 200:
        return None

    return {"title": title, "abstract": abstract, "pmcid": pmcid}


def make_doc_id(pmcid: str, mode: str) -> str:
    h = hashlib.sha1(f"{pmcid}-{mode}".encode()).hexdigest()[:12]
    return f"pubmed_{pmcid}_{h}"


def run():
    staged_path = STAGE_DIR / "pubmed_abstracts.jsonl"
    total = 0
    log = []

    with open(staged_path, "w", encoding="utf-8") as out_f:
        for q in tqdm(PUBMED_QUERIES, desc="Queries"):
            print(f"\nQuery: '{q['query']}' (mode={q['mode']})")
            try:
                ids = esearch_pmc(q["query"], q["max_results"])
            except Exception as e:
                print(f"  [FAILED] search failed: {e}")
                log.append({"query": q["query"], "status": "SEARCH_FAILED", "error": str(e)})
                continue

            print(f"  found {len(ids)} candidate PMCIDs")
            fetched = 0
            for pmcid in ids:
                time.sleep(REQUEST_DELAY)
                try:
                    record = efetch_abstract(pmcid)
                except Exception:
                    continue
                if not record:
                    continue

                doc = {
                    "id": make_doc_id(pmcid, q["mode"]),
                    "text": f"{record['title']}\n\n{record['abstract']}",
                    "metadata": {
                        "mode": q["mode"],
                        "tier": q["tier"],
                        "purpose": q["purpose"],
                        "language": "en",
                        "source_url": f"https://www.ncbi.nlm.nih.gov/pmc/articles/{pmcid}/",
                        "source_name": record["title"][:120],
                    },
                }
                out_f.write(json.dumps(doc, ensure_ascii=False) + "\n")
                fetched += 1
            total += fetched
            print(f"  [OK] staged {fetched} abstracts")
            log.append({"query": q["query"], "status": "OK", "fetched": fetched})

    print("\n" + "=" * 60)
    print(f"Total abstracts staged: {total}")
    print(f"Staged file: {staged_path}")
    with open(STAGE_DIR / "pubmed_collection_report.json", "w") as f:
        json.dump(log, f, indent=2)


if __name__ == "__main__":
    run()
