"""
RAG paper collector for EchoCoach.

Usage:
    python collect_papers.py --email you@example.com --input papers.csv --out ./data

Input CSV columns: doi, mode, topic
Output structure:
    ./data/{mode}/{topic}__{safe_doi}.pdf        (when a full PDF is found)
    ./data/{mode}/{topic}__{safe_doi}.json       (metadata, always written)
    ./data/collection_log.csv                    (status per DOI: pdf_ok / abstract_only / failed)

Strategy per DOI:
    1. Try Unpaywall (best legal OA PDF link)
    2. Fall back to OpenAlex (broader index, sometimes has OA url Unpaywall misses)
    3. If no PDF found anywhere, save metadata + abstract (from OpenAlex) as a .json
       so the paper can still be chunked for RAG with a synthesized fallback.
"""

import argparse
import csv
import json
import os
import re
import time
import urllib.request
import urllib.error

UNPAYWALL_BASE = "https://api.unpaywall.org/v2/{doi}?email={email}"
OPENALEX_BASE = "https://api.openalex.org/works/https://doi.org/{doi}"


def safe_filename(doi: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", doi)


def http_get_json(url: str, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "echo-coach-rag-collector/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_file(url: str, dest_path: str, timeout=30) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "echo-coach-rag-collector/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest_path, "wb") as f:
            f.write(resp.read())
        return True
    except Exception as e:
        print(f"    download failed: {e}")
        return False


def try_unpaywall(doi: str, email: str):
    try:
        data = http_get_json(UNPAYWALL_BASE.format(doi=doi, email=email))
    except Exception as e:
        print(f"    unpaywall lookup failed: {e}")
        return None
    if not data.get("is_oa"):
        return None
    best = data.get("best_oa_location") or {}
    pdf_url = best.get("url_for_pdf") or best.get("url")
    return {
        "pdf_url": pdf_url,
        "title": data.get("title"),
        "year": data.get("year"),
        "host_type": best.get("host_type"),
        "oa_status": data.get("oa_status"),
    }


def try_openalex(doi: str):
    try:
        data = http_get_json(OPENALEX_BASE.format(doi=doi))
    except Exception as e:
        print(f"    openalex lookup failed: {e}")
        return None
    oa = data.get("open_access", {}) or {}
    best_loc = data.get("best_oa_location") or {}
    pdf_url = best_loc.get("pdf_url") or (oa.get("oa_url") if oa.get("is_oa") else None)

    # Reconstruct abstract from OpenAlex's inverted index, if present
    abstract = None
    inv = data.get("abstract_inverted_index")
    if inv:
        positions = {}
        for word, idxs in inv.items():
            for i in idxs:
                positions[i] = word
        abstract = " ".join(positions[i] for i in sorted(positions))

    return {
        "pdf_url": pdf_url,
        "title": data.get("title"),
        "year": data.get("publication_year"),
        "abstract": abstract,
    }


def process_row(doi: str, mode: str, topic: str, out_dir: str, email: str, log_rows: list):
    doi = doi.strip()
    if not doi:
        return
    print(f"[{mode}/{topic}] {doi}")
    mode_dir = os.path.join(out_dir, mode)
    os.makedirs(mode_dir, exist_ok=True)
    base = f"{topic}__{safe_filename(doi)}"
    pdf_path = os.path.join(mode_dir, base + ".pdf")
    meta_path = os.path.join(mode_dir, base + ".json")

    meta = {"doi": doi, "mode": mode, "topic": topic}
    status = "failed"

    up = try_unpaywall(doi, email)
    pdf_url = up["pdf_url"] if up else None
    source = "unpaywall"

    if not pdf_url:
        oa = try_openalex(doi)
        if oa:
            pdf_url = oa.get("pdf_url")
            meta["abstract"] = oa.get("abstract")
            meta["title"] = meta.get("title") or oa.get("title")
            meta["year"] = meta.get("year") or oa.get("year")
            source = "openalex"

    if up:
        meta["title"] = meta.get("title") or up.get("title")
        meta["year"] = meta.get("year") or up.get("year")
        meta["oa_status"] = up.get("oa_status")

    if pdf_url:
        time.sleep(1)  # be polite to hosts
        ok = download_file(pdf_url, pdf_path)
        if ok:
            status = "pdf_ok"
            meta["pdf_source"] = source
            meta["pdf_url"] = pdf_url
        else:
            status = "abstract_only" if meta.get("abstract") else "failed"
    else:
        status = "abstract_only" if meta.get("abstract") else "failed"

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    log_rows.append({"doi": doi, "mode": mode, "topic": topic, "status": status})
    print(f"    -> {status}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="papers.csv")
    parser.add_argument("--out", default="./data")
    parser.add_argument("--email", required=True, help="Required by Unpaywall API")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    log_rows = []

    with open(args.input, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            process_row(row["doi"], row["mode"], row["topic"], args.out, args.email, log_rows)

    log_path = os.path.join(args.out, "collection_log.csv")
    with open(log_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["doi", "mode", "topic", "status"])
        writer.writeheader()
        writer.writerows(log_rows)

    ok = sum(1 for r in log_rows if r["status"] == "pdf_ok")
    abs_only = sum(1 for r in log_rows if r["status"] == "abstract_only")
    failed = sum(1 for r in log_rows if r["status"] == "failed")
    print(f"\nDone. {ok} full PDFs, {abs_only} abstract-only, {failed} failed.")
    print(f"Log written to {log_path}")


if __name__ == "__main__":
    main()
