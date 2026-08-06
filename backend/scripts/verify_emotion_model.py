"""verify_emotion_model.py — standalone smoke test for services/emotion_model.py, independent of the FastAPI app/router wiring."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    os.environ.setdefault("EMOTION_PROVIDER", "xlsr")

    from services.emotion_model import analyze_emotion, SAMPLE_RATE, MAX_SAMPLES

    if len(sys.argv) > 1:
        clip_path = sys.argv[1]
        if not os.path.exists(clip_path):
            raise SystemExit(f"No file at {clip_path}")
        print(f"Analyzing {clip_path} ...")
        with open(clip_path, "rb") as f:
            audio_input = f.read()
        synthetic = False
    else:
        print("No clip given — synthesizing a test tone (plumbing check only, "
              "label will not be meaningful) ...")
        t = np.linspace(0, MAX_SAMPLES / SAMPLE_RATE, MAX_SAMPLES, dtype=np.float32)
        audio_input = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        synthetic = True

    result = analyze_emotion(audio_input, sr=SAMPLE_RATE)

    if result is None:
        raise SystemExit(
            "analyze_emotion() returned None — check EMOTION_PROVIDER=xlsr is "
            "set and EMOTION_MODEL_PATH points at a downloaded checkpoint "
            "(run setup_emotion_model.py), then check stderr above for the "
            "logged load/inference error."
        )

    print("\n--- Result ---")
    print(f"emotion:    {result['emotion']}" + ("  (synthetic tone — ignore)" if synthetic else ""))
    print(f"confidence: {result['confidence']:.3f}")
    print("all_probabilities:")
    for label, prob in sorted(result["all_probabilities"].items(), key=lambda kv: -kv[1]):
        print(f"  {label:>10}: {prob:.3f}")
    print("--------------")
    return 0


if __name__ == "__main__":
    sys.exit(main())
