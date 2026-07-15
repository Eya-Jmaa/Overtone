"""
Verify configured session-source URLs with the same headers as the collector.

Usage:
    python verify_session_urls.py --first 4
"""

import argparse

import requests

from collect_session_sources import REQUEST_HEADERS
from sources_config import SOURCES


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", type=int, default=0, help="Only check the first N sources")
    args = parser.parse_args()

    sources = SOURCES[:args.first] if args.first else SOURCES
    for src in sources:
        try:
            resp = requests.get(
                src["url"],
                headers=REQUEST_HEADERS,
                timeout=30,
                allow_redirects=True,
                stream=True,
            )
            body = resp.raw.read(5, decode_content=True)
            print(f"{src['source_name']}")
            print(f"  url: {src['url']}")
            print(f"  status: {resp.status_code}")
            print(f"  content_type: {resp.headers.get('Content-Type', '')}")
            print(f"  content_length: {resp.headers.get('Content-Length', 'unknown')}")
            print(f"  starts_pdf: {body.startswith(b'%PDF')}")
        except Exception as exc:
            print(f"{src['source_name']}")
            print(f"  url: {src['url']}")
            print(f"  error: {exc}")


if __name__ == "__main__":
    main()
