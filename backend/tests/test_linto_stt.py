"""Unit tests for linto_stt.py — the Tunisian Derja Vosk/Kaldi STT engine."""
import io
import json
import os
import sys
import types
import unittest
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings  # noqa: E402


def _make_fixture_wav_bytes(seconds: float = 0.5, sr: int = 16000) -> bytes:
    """Short synthetic mono 16-bit PCM WAV fixture (not real speech) — enough to exercise decode/chunk/recognizer plumbing end-to-end."""
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    tone = (0.2 * np.sin(2 * np.pi * 220 * t) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(tone.tobytes())
    return buf.getvalue()


class FakeKaldiRecognizer:
    """Mimics vosk.KaldiRecognizer just enough to test our plumbing: reports one endpointed result once it has accumulated a full chunk, a partial otherwise, and a fixed final result."""

    def __init__(self, model, sample_rate):
        self.model = model
        self.sample_rate = sample_rate
        self._fed = 0
        self._returned_final = False

    def SetWords(self, on):
        self._words_on = on

    def AcceptWaveform(self, chunk: bytes) -> bool:
        self._fed += len(chunk)
        if not self._returned_final and self._fed >= 4000:
            self._returned_final = True
            return True
        return False

    def Result(self) -> str:
        return json.dumps({"text": "sahet"})

    def PartialResult(self) -> str:
        return json.dumps({"partial": "sahe"})

    def FinalResult(self) -> str:
        return json.dumps({"text": "ya sidi"})


class FakeVoskModule(types.ModuleType):
    def __init__(self):
        super().__init__("vosk")
        self.loaded_paths = []

    def SetLogLevel(self, level):
        pass

    def Model(self, path):
        self.loaded_paths.append(path)
        return object()

    def KaldiRecognizer(self, model, sample_rate):
        return FakeKaldiRecognizer(model, sample_rate)


class LintoSttTestCase(unittest.TestCase):
    def setUp(self):
        self._saved_backend = settings.derja_stt_backend
        self._saved_path = settings.derja_stt_model_path
        settings.derja_stt_backend = "vosk"
        settings.derja_stt_model_path = os.path.dirname(os.path.abspath(__file__))

        self._fake_vosk = FakeVoskModule()
        self._saved_module = sys.modules.get("vosk")
        sys.modules["vosk"] = self._fake_vosk

        sys.modules.pop("services.linto_stt", None)
        import services.linto_stt as linto_stt

        self.linto_stt = linto_stt

    def tearDown(self):
        settings.derja_stt_backend = self._saved_backend
        settings.derja_stt_model_path = self._saved_path
        if self._saved_module is not None:
            sys.modules["vosk"] = self._saved_module
        else:
            sys.modules.pop("vosk", None)
        sys.modules.pop("services.linto_stt", None)

    def test_decode_to_pcm16_shape(self):
        pcm16 = self.linto_stt._decode_to_pcm16(_make_fixture_wav_bytes())
        self.assertIsInstance(pcm16, bytes)
        self.assertGreater(len(pcm16), 0)
        self.assertEqual(len(pcm16) % 2, 0, "must be whole int16 samples")

    def test_transcribe_returns_expected_shape_and_non_empty_text(self):
        result = self.linto_stt.transcribe(
            _make_fixture_wav_bytes(seconds=1.0), language="ar", detect=True
        )

        for field in ("transcript", "detected_language", "confidence", "engine", "segments"):
            self.assertTrue(hasattr(result, field), f"missing field {field}")

        self.assertEqual(result.engine, "linto-vosk")
        self.assertEqual(result.detected_language, "ar")
        self.assertIsInstance(result.transcript, str)
        self.assertGreater(len(result.transcript), 0, "expected non-empty transcript")
        self.assertIsInstance(result.segments, list)

    def test_transcribe_uses_a_fresh_recognizer_per_call(self):
        """Recognizer state is per-utterance — never a shared/global instance."""
        created = []
        original = self.linto_stt.LintoStreamingSession

        class CountingSession(original):
            def __init__(self, model=None):
                super().__init__(model)
                created.append(self)

        self.linto_stt.LintoStreamingSession = CountingSession
        try:
            self.linto_stt.transcribe(_make_fixture_wav_bytes())
            self.linto_stt.transcribe(_make_fixture_wav_bytes())
        finally:
            self.linto_stt.LintoStreamingSession = original

        self.assertEqual(len(created), 2)
        self.assertIsNot(created[0]._rec, created[1]._rec)

    def test_transcribe_short_audio_returns_empty_result(self):
        result = self.linto_stt.transcribe(b"\x00" * 10)
        self.assertEqual(result.transcript, "")
        self.assertEqual(result.confidence, 0.0)
        self.assertEqual(result.engine, "linto-vosk")

    def test_streaming_session_partial_and_final(self):
        session = self.linto_stt.LintoStreamingSession()
        chunk = b"\x00\x00" * 3000
        got = session.accept_chunk(chunk)
        self.assertIsInstance(got, dict)
        self.assertIn("text", got)
        self.assertIsInstance(session.partial(), dict)
        final = session.final()
        self.assertIn("text", final)


if __name__ == "__main__":
    unittest.main(verbosity=2)
