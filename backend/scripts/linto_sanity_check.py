"""linto_sanity_check.py — standalone smoke test for the LinTO/Vosk model, independent of the app's config/router wiring."""
import json
import os
import sys
import wave

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MODEL_DIR = os.path.join(BACKEND_DIR, "models", "linto-asr-ar-tn")
DEFAULT_SAMPLE_WAV = os.path.join(DEFAULT_MODEL_DIR, "sample.wav")


def _find_model_dir() -> str:
    if not os.path.isdir(DEFAULT_MODEL_DIR):
        raise SystemExit(
            f"No model directory at {DEFAULT_MODEL_DIR}. Run "
            "backend/scripts/setup_linto_model.py first."
        )
    for name in sorted(os.listdir(DEFAULT_MODEL_DIR)):
        full = os.path.join(DEFAULT_MODEL_DIR, name)
        if os.path.isdir(full) and name.startswith("vosk-model"):
            return full
    raise SystemExit(
        f"No unpacked vosk-model* directory under {DEFAULT_MODEL_DIR}. Run "
        "backend/scripts/setup_linto_model.py first."
    )


def main() -> int:
    try:
        import vosk
    except ImportError:
        raise SystemExit("vosk is not installed. `pip install vosk` (see requirements.txt).")

    wav_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SAMPLE_WAV
    if not os.path.exists(wav_path):
        raise SystemExit(
            f"No sample clip at {wav_path}. Pass a WAV path, or run "
            "setup_linto_model.py to fetch the model card's sample.wav."
        )

    model_dir = _find_model_dir()
    print(f"Loading model from {model_dir} ...")
    vosk.SetLogLevel(-1)
    model = vosk.Model(model_dir)

    with wave.open(wav_path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise SystemExit(
                f"{wav_path} must be mono 16-bit PCM (got "
                f"{wf.getnchannels()}ch / {wf.getsampwidth() * 8}bit). "
                "Convert it first, e.g. with ffmpeg -ac 1 -sample_fmt s16."
            )
        sample_rate = wf.getframerate()
        rec = vosk.KaldiRecognizer(model, sample_rate)
        rec.SetWords(True)

        print(f"Transcribing {wav_path} ({sample_rate} Hz) ...")
        parts = []
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                if result.get("text"):
                    parts.append(result["text"])
        final = json.loads(rec.FinalResult())
        if final.get("text"):
            parts.append(final["text"])

    transcript = " ".join(p for p in parts if p).strip()
    print("\n--- Transcript ---")
    print(transcript or "(empty)")
    print("------------------")
    return 0


if __name__ == "__main__":
    sys.exit(main())
