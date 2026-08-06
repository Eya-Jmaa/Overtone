"""setup_silma_tts.py — one-time download of the Tunisian Derja F5-TTS fine-tune (Eya-Jmaa/silma-tts-derja) for services/tts_service.py's local SILMA path."""
import os
import sys

import requests

REPO_URL = "https://huggingface.co/Eya-Jmaa/silma-tts-derja/resolve/main"
FILES = ["model.pt", "vocab.txt", "config.yaml"]

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
TARGET_DIR = os.path.join(MODELS_DIR, "silma-tts-derja")


def _remote_size(url: str) -> int:
    """Byte size of the file upstream, or 0 if the server won't say."""
    try:
        resp = requests.head(url, allow_redirects=True, timeout=30)
        resp.raise_for_status()
        return int(resp.headers.get("content-length", 0))
    except Exception:
        return 0


def _download_resumable(url: str, dest: str) -> None:
    resume_from = os.path.getsize(dest) if os.path.exists(dest) else 0
    headers = {"Range": f"bytes={resume_from}-"} if resume_from else {}
    mode = "ab" if resume_from else "wb"
    if resume_from:
        print(f"Resuming {url} -> {dest} from {resume_from / 1e6:.1f} MB")
    else:
        print(f"Downloading {url} -> {dest}")

    with requests.get(url, stream=True, timeout=30, headers=headers) as resp:
        if resp.status_code == 416:
            print(f"  already complete ({resume_from / 1e6:.1f} MB), nothing to resume.")
            return
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

    for fname in FILES:
        dest = os.path.join(TARGET_DIR, fname)
        url = f"{REPO_URL}/{fname}"

        if fname == "model.pt" and os.path.exists(dest):
            local = os.path.getsize(dest)
            remote = _remote_size(url)
            if remote and local == remote:
                print(f"{fname} already present and matches upstream, skipping.")
                continue
            if remote and local > remote:
                print(f"{fname} is {local / 1e6:.1f} MB but upstream is "
                      f"{remote / 1e6:.1f} MB — removing stale copy.")
                os.remove(dest)

        _download_resumable(url, dest)

    print("\nDone. Set in .env:")
    print("  SILMA_PROVIDER=local")
    print(f"  (weights cached at {TARGET_DIR}; SILMA_HF_REPO defaults to"
          " Eya-Jmaa/silma-tts-derja, no change needed)")
    print("\nSTILL NEEDED — this is a voice-cloning model, no default speaker:")
    print("  SILMA_REF_AUDIO_PATH=<path to a few clean seconds of the desired voice, wav>")
    print("  SILMA_REF_TEXT=<exact transcript of that clip>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
