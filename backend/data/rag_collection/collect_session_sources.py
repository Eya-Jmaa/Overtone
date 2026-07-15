"""
Collect session-guide sources for EchoCoach RAG.

Downloads PDF and HTML sources, validates/extracts text, chunks it, and stages
JSONL documents for embed_and_upsert.py.
"""

import hashlib
import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
from tqdm import tqdm

from sources_config import SOURCES

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "raw_pdfs"
STAGE_DIR = BASE_DIR / "staged_chunks"
RAW_DIR.mkdir(exist_ok=True)
STAGE_DIR.mkdir(exist_ok=True)

REQUEST_DELAY_SECONDS = 2
MAX_RETRIES = 2
MAX_ATTEMPTS = MAX_RETRIES + 1
BACKOFF_SECONDS = 5
MIN_FILE_BYTES = 2000
RETRY_STATUS_CODES = {403, 429, 500, 502, 503, 504}
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_with_retry(url: str) -> tuple[requests.Response | None, str | None]:
    """Fetch a URL with browser-like headers, redirects, timeout, and retries."""
    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            time.sleep(REQUEST_DELAY_SECONDS)
            resp = requests.get(url, headers=REQUEST_HEADERS, timeout=30, allow_redirects=True)
            if resp.status_code in RETRY_STATUS_CODES and attempt < MAX_ATTEMPTS:
                last_error = f"HTTP {resp.status_code}"
                print(f"  [attempt {attempt}/{MAX_ATTEMPTS}] retryable status: {resp.status_code}")
                time.sleep(BACKOFF_SECONDS)
                continue
            resp.raise_for_status()
            return resp, None
        except Exception as exc:
            last_error = str(exc)
            print(f"  [attempt {attempt}/{MAX_ATTEMPTS}] failed: {exc}")
            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_SECONDS)
    return None, last_error


def validate_and_save_pdf(resp: requests.Response, dest: Path) -> tuple[bool, str | None]:
    content = resp.content
    content_type = resp.headers.get("Content-Type", "")
    if len(content) < MIN_FILE_BYTES:
        return False, f"file too small ({len(content)} bytes)"
    if not content.startswith(b"%PDF"):
        return False, f"missing %PDF magic bytes; content-type={content_type!r}"
    if "pdf" not in content_type.lower() and "octet-stream" not in content_type.lower():
        print(f"  warning: PDF magic bytes found but Content-Type is {content_type!r}")
    dest.write_bytes(content)
    return True, None


def download_pdf(url: str, dest: Path) -> tuple[bool, str | None, int | None]:
    resp, error = fetch_with_retry(url)
    if not resp:
        return False, error, None
    ok, validation_error = validate_and_save_pdf(resp, dest)
    return ok, validation_error, resp.status_code


def extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(pages)


def extract_html_text(html: str, url: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
        tag.decompose()

    page_title = soup.title.get_text(" ", strip=True) if soup.title else url
    main = (
        soup.find("article")
        or soup.find("main")
        or soup.find("div", {"role": "main"})
        or soup.find("div", class_="article")
        or soup.body
        or soup
    )

    parts = []
    for el in main.find_all(["h1", "h2", "h3", "p", "li"]):
        text = " ".join(el.get_text(" ", strip=True).split())
        if len(text) >= 30:
            parts.append(text)
    return "\n\n".join(parts), page_title


def download_html(url: str, dest: Path) -> tuple[bool, str | None, int | None, str, str | None]:
    resp, error = fetch_with_retry(url)
    if not resp:
        return False, error, None, "", None
    content_type = resp.headers.get("Content-Type", "")
    if "html" not in content_type.lower() and "text/plain" not in content_type.lower():
        print(f"  warning: HTML source returned Content-Type {content_type!r}")
    dest.write_text(resp.text, encoding="utf-8")
    text, page_title = extract_html_text(resp.text, resp.url)
    return True, None, resp.status_code, text, page_title


def chunk_text(text: str, chunk_tokens: int, overlap: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    step = max(chunk_tokens - overlap, 1)
    for start in range(0, len(words), step):
        chunk_words = words[start:start + chunk_tokens]
        if len(chunk_words) < 30:
            continue
        chunks.append(" ".join(chunk_words))
        if start + chunk_tokens >= len(words):
            break
    return chunks


def safe_id_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value.lower()).strip("_")[:120]


def make_doc_id(source_name: str, chunk_index: int, chunk_text: str) -> str:
    h = hashlib.sha1(f"{source_name}-{chunk_index}-{chunk_text[:80]}".encode("utf-8")).hexdigest()[:12]
    return f"session_{safe_id_part(source_name)}_{chunk_index}_{h}"


def load_source_text(src: dict, dest: Path) -> tuple[bool, str, str, int | None, str | None]:
    source_type = src.get("source_type") or (
        "html" if src["url"].rstrip("/").endswith((".html", ".htm")) else "pdf"
    )
    if dest.exists() and dest.stat().st_size >= MIN_FILE_BYTES:
        print("  already downloaded, skipping fetch")
        if source_type == "pdf":
            return True, extract_pdf_text(dest), src["source_name"], None, None
        if source_type == "html":
            text, page_title = extract_html_text(dest.read_text(encoding="utf-8"), src["url"])
            return True, text, page_title, None, None

    if source_type == "pdf":
        ok, error, status_code = download_pdf(src["url"], dest)
        if not ok:
            return False, "", src["source_name"], status_code, error
        return True, extract_pdf_text(dest), src["source_name"], status_code, None

    if source_type == "html":
        ok, error, status_code, text, page_title = download_html(src["url"], dest)
        if not ok:
            return False, "", src["source_name"], status_code, error
        return True, text, page_title or src["source_name"], status_code, None

    return False, "", src["source_name"], None, f"unsupported source_type={source_type!r}"


def run():
    staged_path = STAGE_DIR / "session_sources.jsonl"
    results_log = []
    total_chunks = 0

    with open(staged_path, "w", encoding="utf-8") as out_f:
        for src in tqdm(SOURCES, desc="Sources"):
            dest = RAW_DIR / src["filename"]
            source_type = src.get("source_type", "pdf")
            print(f"\nFetching: {src['source_name']}")

            try:
                ok, text, effective_source_name, status_code, error = load_source_text(src, dest)
            except Exception as exc:
                ok, text, effective_source_name, status_code, error = False, "", src["source_name"], None, str(exc)

            if not ok:
                results_log.append({
                    "source": src["source_name"],
                    "status": "FAILED_DOWNLOAD",
                    "url": src["url"],
                    "http_status": status_code,
                    "error": error,
                })
                print(f"  [FAILED] after {MAX_ATTEMPTS} attempts - {error}")
                continue

            if len(text.strip()) < 500:
                results_log.append({
                    "source": src["source_name"],
                    "status": "EMPTY_TEXT",
                    "url": src["url"],
                    "http_status": status_code,
                })
                print("  [FAILED] extracted text suspiciously short - likely scanned/image PDF, needs OCR")
                continue

            chunks = chunk_text(text, src["chunk_tokens"], src["chunk_overlap"])
            for i, chunk in enumerate(chunks):
                metadata = {
                    "mode": src["mode"],
                    "tier": src["tier"],
                    "purpose": src["purpose"],
                    "language": src["language"],
                    "source_url": src["url"],
                    "source_name": effective_source_name,
                    "source": effective_source_name,
                    "source_type": source_type,
                }
                doc = {
                    "id": make_doc_id(effective_source_name, i, chunk),
                    "text": chunk,
                    "metadata": metadata,
                }
                out_f.write(json.dumps(doc, ensure_ascii=False) + "\n")
            total_chunks += len(chunks)

            results_log.append({
                "source": effective_source_name,
                "status": "OK",
                "chunks": len(chunks),
                "url": src["url"],
                "http_status": status_code,
            })
            print(f"  [OK] {len(chunks)} chunks staged")

    print("\n" + "=" * 60)
    print("COLLECTION SUMMARY")
    print("=" * 60)
    ok = [r for r in results_log if r["status"] == "OK"]
    failed = [r for r in results_log if r["status"] != "OK"]
    print(f"Sources succeeded: {len(ok)}/{len(results_log)}")
    print(f"Total new chunks staged: {total_chunks}")
    print(f"Staged file: {staged_path}")
    if failed:
        print("\nFailed sources:")
        for r in failed:
            status = r.get("http_status")
            status_text = f" HTTP {status}" if status else ""
            print(f"  - {r['source']} [{r['status']}]{status_text} {r['url']}")

    with open(STAGE_DIR / "collection_report.json", "w", encoding="utf-8") as f:
        json.dump(results_log, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    run()
