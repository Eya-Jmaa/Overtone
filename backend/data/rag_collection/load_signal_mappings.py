"""load_signal_mappings.py — Converts your hand-filled signal_mappings.yaml into staged JSONL docs, same format as the other collectors, so embed_and_upsert.py can treat all tiers uniformly."""

import sys
import json
import hashlib
from pathlib import Path

import yaml

BASE_DIR = Path(__file__).resolve().parent
STAGE_DIR = BASE_DIR / "staged_chunks"
STAGE_DIR.mkdir(exist_ok=True)


def make_doc_id(entry_id: str) -> str:
    h = hashlib.sha1(entry_id.encode()).hexdigest()[:8]
    return f"signal_{entry_id}_{h}"


def run(yaml_path: str):
    yaml_file = Path(yaml_path)
    if not yaml_file.is_absolute():
        yaml_file = BASE_DIR / yaml_file

    with open(yaml_file, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    mappings = data.get("mappings", [])
    staged_path = STAGE_DIR / "signal_mappings.jsonl"
    written = 0

    with open(staged_path, "w", encoding="utf-8") as out_f:
        for entry in mappings:
            required = ["id", "mode", "signal_trigger", "interpretation", "do", "avoid"]
            missing = [k for k in required if not entry.get(k)]
            if missing:
                print(f"  skipping {entry.get('id', '?')} — missing fields: {missing}")
                continue

            text = (
                f"Signal: {entry['signal_trigger']}\n"
                f"Interpretation: {entry['interpretation'].strip()}\n"
                f"Do: {entry['do'].strip()}\n"
                f"Avoid: {entry['avoid'].strip()}"
            )

            doc = {
                "id": make_doc_id(entry["id"]),
                "text": text,
                "metadata": {
                    "mode": entry["mode"],
                    "tier": "signal_mapping",
                    "purpose": entry.get("purpose", "general"),
                    "language": entry.get("language", "en"),
                    "signal_trigger": entry["signal_trigger"],
                    "source_url": "",
                    "source_name": "hand-authored signal mapping",
                },
            }
            out_f.write(json.dumps(doc, ensure_ascii=False) + "\n")
            written += 1

    print(f"Staged {written} signal mappings -> {staged_path}")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "signal_mappings.yaml"
    run(path)
