"""setup_emotion_model.py — one-time download of the speech emotion recognition checkpoint (Eya-Jmaa/emotions_speech, wav2vec2-large-xlsr-53 fine-tune) for services/emotion_model.py."""
import os
import sys

import requests

REPO_URL = "https://huggingface.co/Eya-Jmaa/emotions_speech/resolve/main"
CKPT_URL = f"{REPO_URL}/xlsr_best.pt"

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
TARGET_DIR = os.path.join(MODELS_DIR, "emotion_xlsr")
CKPT_PATH = os.path.join(TARGET_DIR, "xlsr_best.pt")


def _download_resumable(url: str, dest: str) -> None:
    resume_from = os.path.getsize(dest) if os.path.exists(dest) else 0
    headers = {"Range": f"bytes={resume_from}-"} if resume_from else {}
    mode = "ab" if resume_from else "wb"
    if resume_from:
        print(f"Resuming {url} -> {dest} from {resume_from / 1e6:.1f} MB")
    else:
        print(f"Downloading {url} -> {dest}")

    with requests.get(url, stream=True, timeout=30, headers=headers) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0)) + resume_from
        written = resume_from
        with open(dest, mode) as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                written += len(chunk)
                if total:
                    print(f"\r  {written / 1e6:.1f} / {total / 1e6:.1f} MB", end="")
        print()


def main() -> int:
    os.makedirs(TARGET_DIR, exist_ok=True)

    if os.path.exists(CKPT_PATH) and os.path.getsize(CKPT_PATH) > 1_200_000_000:
        print(f"Checkpoint already present at {CKPT_PATH}, skipping download.")
    else:
        _download_resumable(CKPT_URL, CKPT_PATH)

    print("\nDone. Set in .env:")
    print("  EMOTION_PROVIDER=xlsr")
    print(f"  (checkpoint cached at {CKPT_PATH}; EMOTION_HF_REPO defaults to"
          " Eya-Jmaa/emotions_speech, no change needed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
