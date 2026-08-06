"""PubMed Abstract Collector for EchoCoach RAG — Searches PubMed by keyword, downloads structured abstracts."""

import requests
import json
import time
import os
import argparse
from xml.etree import ElementTree as ET
from pathlib import Path


QUERIES = {
    "psy": [
        ("emotion_regulation", "emotion regulation cognitive reappraisal intervention", 8),
        ("emotion_regulation", "affect labeling emotion reduction fMRI", 5),
        ("nvc", "nonviolent communication efficacy outcomes", 5),
        ("attachment", "attachment style conflict resolution couples", 6),
        ("dbt", "DBT interpersonal effectiveness randomized", 5),
        ("active_listening", "active listening empathy therapeutic relationship", 5),
        ("gottman", "Gottman marital conflict prediction dissolution", 5),
        ("emotional_flooding", "emotional flooding physiological arousal conflict", 4),
        ("self_compassion", "self-compassion intervention wellbeing meta-analysis", 5),
    ],
    "professional": [
        ("negotiation", "BATNA negotiation outcomes experimental", 6),
        ("anchoring", "anchoring effect salary negotiation first offer", 5),
        ("assertiveness", "assertiveness training randomized controlled trial", 6),
        ("psych_safety", "psychological safety team performance Edmondson", 5),
        ("feedback", "feedback intervention performance Kluger DeNisi", 5),
        ("imposter", "imposter phenomenon workplace self-efficacy", 5),
        ("stress_decisions", "stress cortisol decision-making under pressure", 5),
        ("public_speaking", "public speaking anxiety intervention cognitive", 5),
    ],
    "sport": [
        ("self_talk", "self-talk sport performance meta-analysis", 6),
        ("self_talk", "instructional motivational self-talk athletes", 5),
        ("visualization", "mental imagery athletic performance PETTLEP", 6),
        ("anxiety", "pre-competition anxiety regulation athletes CSAI", 6),
        ("flow", "flow state sport optimal experience", 5),
        ("breathing", "breathing technique competitive anxiety athletes", 5),
        ("mindset", "growth mindset resilience athletes sport", 5),
        ("physiological_sigh", "cyclic sighing breathing stress reduction", 4),
    ],
}


def search_pubmed(query: str, max_results: int = 5) -> list[str]:
    """Search PubMed, return list of PMIDs."""
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    params = {
        "db": "pubmed",
        "term": query,
        "retmax": max_results,
        "retmode": "json",
        "sort": "relevance",
    }
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json().get("esearchresult", {}).get("idlist", [])


def fetch_abstracts(pmids: list[str]) -> list[dict]:
    """Fetch structured abstract data for a list of PMIDs."""
    if not pmids:
        return []

    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
    params = {
        "db": "pubmed",
        "id": ",".join(pmids),
        "rettype": "xml",
        "retmode": "xml",
    }
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    papers = []

    for article in root.findall(".//PubmedArticle"):
        try:
            medline = article.find("MedlineCitation")
            art = medline.find("Article")

            pmid = medline.findtext("PMID", "")
            title = art.findtext("ArticleTitle", "")

            abstract_el = art.find("Abstract")
            if abstract_el is not None:
                abstract_parts = []
                for at in abstract_el.findall("AbstractText"):
                    label = at.get("Label", "")
                    text = "".join(at.itertext()).strip()
                    if label:
                        abstract_parts.append(f"{label}: {text}")
                    else:
                        abstract_parts.append(text)
                abstract = " ".join(abstract_parts)
            else:
                abstract = ""

            author_list = art.find("AuthorList")
            authors = []
            if author_list is not None:
                for author in author_list.findall("Author"):
                    last = author.findtext("LastName", "")
                    fore = author.findtext("ForeName", "")
                    if last:
                        authors.append(f"{last} {fore}".strip())

            pub_date = art.find(".//PubDate")
            year = pub_date.findtext("Year", "") if pub_date is not None else ""
            if not year:
                medline_date = pub_date.findtext("MedlineDate", "") if pub_date is not None else ""
                year = medline_date[:4] if medline_date else ""

            journal = art.findtext(".//Title", "")

            doi = ""
            for eid in article.findall(".//ArticleId"):
                if eid.get("IdType") == "doi":
                    doi = eid.text or ""
                    break

            if abstract:
                papers.append({
                    "pmid": pmid,
                    "doi": doi,
                    "title": title,
                    "authors": authors[:5],
                    "year": year,
                    "journal": journal,
                    "abstract": abstract,
                    "pubmed_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                })
        except Exception as e:
            print(f"  ✗  Error parsing article: {e}")
            continue

    return papers


def collect_all(out_dir: str):
    """Run all queries and save abstracts as JSON files."""
    out_path = Path(out_dir)
    seen_pmids = set()
    stats = {"psy": 0, "professional": 0, "sport": 0}

    for mode, queries in QUERIES.items():
        mode_dir = out_path / mode
        mode_dir.mkdir(parents=True, exist_ok=True)

        for topic, query, max_results in queries:
            print(f"\n[{mode}/{topic}] Searching: {query}")

            pmids = search_pubmed(query, max_results)
            new_pmids = [p for p in pmids if p not in seen_pmids]
            seen_pmids.update(new_pmids)

            if not new_pmids:
                print(f"  - No new results (all duplicates)")
                continue

            print(f"  Found {len(new_pmids)} new papers")
            papers = fetch_abstracts(new_pmids)

            for paper in papers:
                paper["mode"] = mode
                paper["topic"] = topic
                paper["content_type"] = "research_abstract"

                filename = f"{mode}_{topic}_{paper['pmid']}.json"
                filepath = mode_dir / filename

                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(paper, f, indent=2, ensure_ascii=False)

                first_author = paper["authors"][0].split()[0] if paper["authors"] else "Unknown"
                print(f"  + {first_author} ({paper['year']}) — {paper['title'][:60]}...")
                stats[mode] += 1

            time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"Collection complete!")
    print(f"  psy:          {stats['psy']} abstracts")
    print(f"  professional: {stats['professional']} abstracts")
    print(f"  sport:        {stats['sport']} abstracts")
    print(f"  total:        {sum(stats.values())} abstracts")
    print(f"  saved to:     {out_path.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Collect PubMed abstracts for EchoCoach RAG")
    parser.add_argument("--out", default="./data/abstracts", help="Output directory")
    args = parser.parse_args()
    collect_all(args.out)
