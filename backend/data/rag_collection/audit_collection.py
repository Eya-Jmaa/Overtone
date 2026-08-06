"""Read-only audit of the `coaching_kb` ChromaDB collection."""
import json
import os
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone

import chromadb

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "chroma_db"))
COLLECTION_NAME = "coaching_kb"
REPORT_PATH = os.path.join(SCRIPT_DIR, "staged_chunks", "audit_report.json")

KNOWN_TIERS = ["technique", "article", "abstract", "session_guide", "signal_mapping"]
KNOWN_MODES = ["psy", "professional", "sport", "all"]
KNOWN_LANGUAGES = ["en", "fr", "ar"]

MISSING_MODE_THRESHOLD = 30


def pct(n, total):
    return round(100.0 * n / total, 2) if total else 0.0


def bucket_value(value, known, missing_label="missing", other_label="other"):
    if value is None or value == "":
        return missing_label
    if value in known:
        return value
    return other_label


def main():
    print(f"Connecting to PersistentClient at: {DB_PATH}")
    client = chromadb.PersistentClient(path=DB_PATH)
    collection = client.get_collection(name=COLLECTION_NAME)

    result = collection.get(include=["metadatas", "documents"])
    ids = result["ids"]
    metadatas = result["metadatas"] or []
    documents = result["documents"] or []
    total = len(ids)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "collection": COLLECTION_NAME,
        "db_path": DB_PATH,
        "total_documents": total,
    }

    print("\n" + "=" * 60)
    print("TOTAL")
    print("=" * 60)
    print(f"Total document count: {total} (expected ~257 based on last upsert)")

    tier_counts = Counter()
    missing_tier = 0
    for md in metadatas:
        tier = (md or {}).get("tier")
        if not tier:
            missing_tier += 1
            tier_counts["(missing)"] += 1
        else:
            tier_counts[tier] += 1

    print("\n" + "=" * 60)
    print("BY TIER")
    print("=" * 60)
    for tier, count in sorted(tier_counts.items(), key=lambda x: -x[1]):
        print(f"  {tier:20s} {count:5d}  ({pct(count, total)}%)")
    if missing_tier:
        print(f"  FLAG: {missing_tier} documents missing 'tier' field")
    else:
        print("  No documents missing 'tier' field.")

    mode_counts = Counter()
    missing_mode = 0
    for md in metadatas:
        mode = (md or {}).get("mode")
        if not mode:
            missing_mode += 1
            mode_counts["(missing)"] += 1
        else:
            mode_counts[mode] += 1

    print("\n" + "=" * 60)
    print("BY MODE")
    print("=" * 60)
    for mode, count in sorted(mode_counts.items(), key=lambda x: -x[1]):
        print(f"  {mode:20s} {count:5d}  ({pct(count, total)}%)")
    if missing_mode:
        print(f"  FLAG: {missing_mode} documents missing 'mode' field")
    else:
        print("  No documents missing 'mode' field.")

    matrix = defaultdict(Counter)
    all_tiers = set()
    all_modes = set()
    for md in metadatas:
        md = md or {}
        tier = md.get("tier") or "(missing)"
        mode = md.get("mode") or "(missing)"
        matrix[tier][mode] += 1
        all_tiers.add(tier)
        all_modes.add(mode)

    tier_order = [t for t in KNOWN_TIERS if t in all_tiers] + sorted(all_tiers - set(KNOWN_TIERS))
    mode_order = [m for m in KNOWN_MODES if m in all_modes] + sorted(all_modes - set(KNOWN_MODES))

    print("\n" + "=" * 60)
    print("TIER x MODE MATRIX")
    print("=" * 60)
    col_w = 12
    header = f"{'tier':18s}" + "".join(f"{m:>{col_w}s}" for m in mode_order) + f"{'TOTAL':>{col_w}s}"
    print(header)
    print("-" * len(header))
    matrix_dict = {}
    for tier in tier_order:
        row_total = 0
        row_dict = {}
        row = f"{tier:18s}"
        for mode in mode_order:
            c = matrix[tier].get(mode, 0)
            row_dict[mode] = c
            row_total += c
            row += f"{c:>{col_w}d}"
        row += f"{row_total:>{col_w}d}"
        print(row)
        matrix_dict[tier] = row_dict
    col_totals = {mode: sum(matrix[t].get(mode, 0) for t in tier_order) for mode in mode_order}
    footer = f"{'TOTAL':18s}" + "".join(f"{col_totals[m]:>{col_w}d}" for m in mode_order) + f"{total:>{col_w}d}"
    print("-" * len(header))
    print(footer)

    source_counts = Counter()
    missing_source = 0
    for md in metadatas:
        source = (md or {}).get("source")
        if not source:
            missing_source += 1
        else:
            source_counts[source] += 1

    print("\n" + "=" * 60)
    print("BY SOURCE (top 15)")
    print("=" * 60)
    for source, count in source_counts.most_common(15):
        print(f"  {source:40s} {count:5d}  ({pct(count, total)}%)")
    print(f"  Total unique sources: {len(source_counts)}")
    if missing_source:
        print(f"  FLAG: {missing_source} documents missing 'source' field")
    else:
        print("  No documents missing 'source' field.")

    lang_counts = Counter()
    for md in metadatas:
        lang = bucket_value((md or {}).get("language"), KNOWN_LANGUAGES)
        lang_counts[lang] += 1

    print("\n" + "=" * 60)
    print("BY LANGUAGE")
    print("=" * 60)
    for lang, count in sorted(lang_counts.items(), key=lambda x: -x[1]):
        print(f"  {lang:20s} {count:5d}  ({pct(count, total)}%)")

    key_counts = Counter()
    for md in metadatas:
        md = md or {}
        for k, v in md.items():
            if v not in (None, ""):
                key_counts[k] += 1
        for k in md.keys():
            key_counts.setdefault(k, key_counts[k])

    all_keys = set()
    for md in metadatas:
        all_keys.update((md or {}).keys())

    print("\n" + "=" * 60)
    print("METADATA HEALTH CHECK")
    print("=" * 60)
    inconsistent_keys = []
    health = {}
    for key in sorted(all_keys):
        populated = key_counts.get(key, 0)
        p = pct(populated, total)
        health[key] = {"populated": populated, "pct": p}
        flag = "" if p >= 100.0 else "  <-- FLAG: inconsistent"
        print(f"  {key:20s} {populated:5d}/{total} ({p}%){flag}")
        if p < 100.0:
            inconsistent_keys.append(key)
    if not inconsistent_keys:
        print("  All metadata keys populated on 100% of documents.")

    lengths = [len(d) for d in documents if d is not None]
    print("\n" + "=" * 60)
    print("CHUNK SIZE DISTRIBUTION (character count)")
    print("=" * 60)
    chunk_stats = {}
    if lengths:
        under_100 = sum(1 for l in lengths if l < 100)
        over_3000 = sum(1 for l in lengths if l > 3000)
        chunk_stats = {
            "min": min(lengths),
            "max": max(lengths),
            "mean": round(statistics.mean(lengths), 1),
            "median": statistics.median(lengths),
            "under_100_chars": under_100,
            "over_3000_chars": over_3000,
        }
        print(f"  Min:    {chunk_stats['min']}")
        print(f"  Max:    {chunk_stats['max']}")
        print(f"  Mean:   {chunk_stats['mean']}")
        print(f"  Median: {chunk_stats['median']}")
        print(f"  Chunks < 100 chars (possibly junk):        {under_100}")
        print(f"  Chunks > 3000 chars (possibly not chunked): {over_3000}")
    else:
        print("  No documents with text content found.")

    print("\n" + "=" * 60)
    print("GAPS")
    print("=" * 60)
    gaps = {
        "low_document_modes": [],
        "zero_document_tiers": [],
        "empty_mode_tier_combos": [],
        "sport_has_article_tier": None,
    }

    for mode in mode_order:
        if mode == "(missing)":
            continue
        count = col_totals.get(mode, 0)
        if count < MISSING_MODE_THRESHOLD:
            gaps["low_document_modes"].append({"mode": mode, "count": count})
    for entry in gaps["low_document_modes"]:
        print(f"  Mode '{entry['mode']}' has only {entry['count']} documents (< {MISSING_MODE_THRESHOLD})")

    for tier in KNOWN_TIERS:
        count = tier_counts.get(tier, 0)
        if count == 0:
            gaps["zero_document_tiers"].append(tier)
    for tier in gaps["zero_document_tiers"]:
        print(f"  Tier '{tier}' has ZERO documents")

    for tier in tier_order:
        if tier == "(missing)":
            continue
        for mode in mode_order:
            if mode == "(missing)":
                continue
            if matrix[tier].get(mode, 0) == 0:
                gaps["empty_mode_tier_combos"].append({"tier": tier, "mode": mode})
    if gaps["empty_mode_tier_combos"]:
        print("  Empty tier x mode combinations:")
        for combo in gaps["empty_mode_tier_combos"]:
            print(f"    - tier={combo['tier']!r}, mode={combo['mode']!r}")
    else:
        print("  No empty tier x mode combinations (among known tiers/modes).")

    sport_article_count = matrix.get("article", Counter()).get("sport", 0)
    gaps["sport_has_article_tier"] = sport_article_count > 0
    print(f"  Sport mode has article-tier content: {gaps['sport_has_article_tier']} "
          f"({sport_article_count} docs)")

    if not gaps["low_document_modes"] and not gaps["zero_document_tiers"] and not gaps["empty_mode_tier_combos"]:
        print("  No significant gaps detected.")

    report.update({
        "tier_counts": dict(tier_counts),
        "missing_tier_count": missing_tier,
        "mode_counts": dict(mode_counts),
        "missing_mode_count": missing_mode,
        "tier_mode_matrix": matrix_dict,
        "mode_order": mode_order,
        "tier_order": tier_order,
        "source_counts_top15": source_counts.most_common(15),
        "unique_source_count": len(source_counts),
        "missing_source_count": missing_source,
        "language_counts": dict(lang_counts),
        "metadata_key_health": health,
        "inconsistent_metadata_keys": inconsistent_keys,
        "chunk_size_stats": chunk_stats,
        "gaps": gaps,
    })

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 60)
    print(f"Full JSON report saved to: {REPORT_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()
