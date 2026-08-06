"""verify_silma_tts.py — standalone smoke test for the local SILMA (F5-TTS) Derja TTS path in services/tts_service.py, independent of the FastAPI app/router wiring."""
import os
import sys

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(BACKEND_DIR, "data", "debug_audio", "silma_verify.wav")


def main() -> int:
    os.environ.setdefault("SILMA_PROVIDER", "local")

    from config import settings

    if (settings.silma_provider or "").strip().lower() != "local":
        raise SystemExit("SILMA_PROVIDER must be 'local' (set it in .env or the shell).")
    if not settings.silma_ref_audio_path or not settings.silma_ref_text:
        raise SystemExit(
            "SILMA_REF_AUDIO_PATH and SILMA_REF_TEXT are both required — this is a "
            "voice-cloning model with no default speaker. Record a few clean "
            "seconds of the desired coach voice, transcribe it exactly, and set "
            "both in .env before running this script."
        )

    from services.tts_service import synthesize_silma_local

    text = sys.argv[1] if len(sys.argv) > 1 else "أهلا، كيفاش نجم نعاونك اليوم؟"
    print(f"Synthesizing: {text!r}")
    print(f"Reference audio: {settings.silma_ref_audio_path}")
    print(f"Reference text:  {settings.silma_ref_text!r}")
    print("(F5-TTS diffusion sampling — this can take real seconds on CPU) ...")

    audio = synthesize_silma_local(text)

    if audio is None:
        raise SystemExit(
            "synthesize_silma_local() returned None — check stderr above for the "
            "logged load/inference error (missing config.yaml/model.pt/vocab.txt, "
            "a bad ref clip path, or an F5-TTS API mismatch)."
        )

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(audio)

    print(f"\nOK — wrote {len(audio)} bytes to {OUT_PATH}")
    print("Listen to it to confirm it's intelligible Derja, not noise/silence.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
