"""setup_linto_model.py — one-time download/unpack of the LinTO Tunisian Derja ASR model (linagora/linto-asr-ar-tn-0.1) for the "vosk" DERJA_STT_BACKEND."""
import os
import sys
import zipfile

import requests

HF_BASE = "https://huggingface.co/linagora/linto-asr-ar-tn-0.1/resolve/main"
MODEL_ZIP_URL = f"{HF_BASE}/vosk-model.zip"
SAMPLE_WAV_URL = f"{HF_BASE}/sample.wav"

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
TARGET_DIR = os.path.join(MODELS_DIR, "linto-asr-ar-tn")
ZIP_PATH = os.path.join(TARGET_DIR, "vosk-model.zip")
SAMPLE_WAV_PATH = os.path.join(TARGET_DIR, "sample.wav")


def _download(url: str, dest: str) -> None:
    print(f"Downloading {url} -> {dest}")
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        written = 0
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                written += len(chunk)
                if total:
                    print(f"\r  {written / 1e6:.1f} / {total / 1e6:.1f} MB", end="")
        print()


def main() -> int:
    os.makedirs(TARGET_DIR, exist_ok=True)

    unpacked_root = None
    if os.path.isdir(TARGET_DIR) and any(
        name.startswith("vosk-model") and os.path.isdir(os.path.join(TARGET_DIR, name))
        for name in os.listdir(TARGET_DIR)
    ):
        print(f"Model already unpacked under {TARGET_DIR}, skipping download.")
    else:
        _download(MODEL_ZIP_URL, ZIP_PATH)
        print(f"Unpacking {ZIP_PATH} -> {TARGET_DIR}")
        with zipfile.ZipFile(ZIP_PATH) as zf:
            zf.extractall(TARGET_DIR)
        os.unlink(ZIP_PATH)

    if not os.path.exists(SAMPLE_WAV_PATH):
        try:
            _download(SAMPLE_WAV_URL, SAMPLE_WAV_PATH)
        except requests.HTTPError as e:
            print(f"Note: sample.wav not fetched ({e}); sanity-check script will need its own clip.")

    for name in sorted(os.listdir(TARGET_DIR)):
        full = os.path.join(TARGET_DIR, name)
        if os.path.isdir(full) and name.startswith("vosk-model"):
            unpacked_root = full
            break

    print("\nDone. Set in .env:")
    print("  DERJA_STT_BACKEND=vosk")
    print(f"  DERJA_STT_MODEL_PATH={unpacked_root or TARGET_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
