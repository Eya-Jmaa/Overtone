"""Blog Article Scraper for EchoCoach RAG — Scrapes free, public articles from known coaching/psychology sources."""

import requests
import json
import time
import re
import os
import argparse
from pathlib import Path
from urllib.parse import urlparse

try:
    from newspaper import Article as NewsArticle
    HAS_NEWSPAPER = True
except ImportError:
    HAS_NEWSPAPER = False
    print("! newspaper3k not installed — falling back to BeautifulSoup only")
    print("  pip install newspaper3k  for better article extraction")

from bs4 import BeautifulSoup


ARTICLES = {
    "psy": [
        ("https://www.gottman.com/blog/the-four-horsemen-recognizing-criticism-contempt-defensiveness-and-stonewalling/",
         "four_horsemen", "Gottman Four Horsemen overview"),
        ("https://www.gottman.com/blog/softening-startup/",
         "soft_startup", "Gottman soft startup technique"),
        ("https://www.gottman.com/blog/repair-is-the-secret-weapon/",
         "repair_attempts", "Gottman repair attempts"),
        ("https://www.gottman.com/blog/the-magic-relationship-ratio-according-to-science/",
         "relationship_ratio", "5:1 positive to negative ratio"),
        ("https://www.cnvc.org/learn-nvc/what-is-nvc",
         "nvc_overview", "NVC overview from CNVC"),
        ("https://www.verywellmind.com/emotion-regulation-skills-training-425374",
         "emotion_regulation", "Emotion regulation skills overview"),
        ("https://www.verywellmind.com/what-is-active-listening-3024343",
         "active_listening", "Active listening guide"),
        ("https://www.verywellmind.com/what-is-attachment-theory-2795337",
         "attachment", "Attachment theory overview"),
    ],
    "professional": [
        ("https://www.pon.harvard.edu/daily/batna/translate-your-batna-to-the-current-deal/",
         "batna", "BATNA in practice"),
        ("https://www.pon.harvard.edu/daily/salary-negotiations/",
         "salary_negotiation", "Salary negotiation strategies"),
        ("https://www.ccl.org/articles/leading-effectively-articles/closing-the-gap-between-intent-and-impact/",
         "sbi_feedback", "SBI feedback model"),
        ("https://www.mindtools.com/arand3e/assertiveness",
         "assertiveness", "Assertiveness guide"),
        ("https://www.mindtools.com/a5f0lzk/conflict-resolution",
         "conflict_resolution", "Conflict resolution overview"),
        ("https://kilmanndiagnostics.com/overview-thomas-kilmann-conflict-mode-instrument-tki/",
         "tki_model", "Thomas-Kilmann conflict modes"),
    ],
    "sport": [
        ("https://appliedsportpsych.org/resources/resources-for-athletes/",
         "athlete_resources", "AASP athlete mental performance resources"),
    ],
}


def extract_article(url: str) -> dict | None:
    """Extract article text and metadata from a URL."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        if HAS_NEWSPAPER:
            article = NewsArticle(url)
            article.download()
            article.parse()

            if len(article.text) > 200:
                return {
                    "title": article.title,
                    "text": article.text,
                    "url": url,
                    "domain": urlparse(url).netloc,
                    "authors": article.authors or [],
                }

        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "lxml")

        for tag in soup.find_all(["nav", "header", "footer", "aside",
                                   "script", "style", "iframe"]):
            tag.decompose()

        main = (soup.find("article") or
                soup.find("main") or
                soup.find("div", class_=re.compile(r"(content|article|post|entry)")) or
                soup.find("body"))

        if main is None:
            return None

        paragraphs = main.find_all("p")
        text = "\n\n".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 30)

        if len(text) < 200:
            return None

        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else url

        return {
            "title": title,
            "text": text,
            "url": url,
            "domain": urlparse(url).netloc,
            "authors": [],
        }

    except Exception as e:
        print(f"  FAILED: {e}")
        return None


def slugify(text: str, max_len: int = 50) -> str:
    """Convert text to a safe filename slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")
    return text[:max_len]


def collect_articles(out_dir: str):
    """Scrape all listed articles and save as JSON."""
    out_path = Path(out_dir)
    stats = {"psy": 0, "professional": 0, "sport": 0}
    failed_urls = []

    for mode, urls in ARTICLES.items():
        mode_dir = out_path / mode
        mode_dir.mkdir(parents=True, exist_ok=True)

        for url, topic, description in urls:
            print(f"\n[{mode}/{topic}] {description}")
            print(f"   {url}")

            article = extract_article(url)

            if article is None:
                print(f"  FAILED: Could not extract content")
                failed_urls.append((mode, topic, url, description))
                continue

            data = {
                "title": article["title"],
                "url": article["url"],
                "domain": article["domain"],
                "authors": article["authors"],
                "text": article["text"],
                "mode": mode,
                "topic": topic,
                "description": description,
                "content_type": "web_article",
                "char_count": len(article["text"]),
                "word_count": len(article["text"].split()),
            }

            slug = slugify(article["title"])
            filename = f"{mode}_{topic}_{slug}.json"
            filepath = mode_dir / filename

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f"  OK ({data['word_count']} words): {filename}")
            stats[mode] += 1

            time.sleep(1)

    print(f"\n{'='*60}")
    print(f"Article collection complete!")
    for mode, count in stats.items():
        print(f"  {mode}: {count} articles")
    print(f"  total: {sum(stats.values())} articles")
    print(f"  saved to: {out_path.resolve()}")

    if failed_urls:
        print(f"\nFAILED URLS ({len(failed_urls)}) — replacements needed:")
        for mode, topic, url, desc in failed_urls:
            print(f"  [{mode}/{topic}] {desc}")
            print(f"    {url}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape articles for EchoCoach RAG")
    parser.add_argument("--out", default="./data/articles", help="Output directory")
    args = parser.parse_args()
    collect_articles(args.out)
