"""Unit tests for STTRouter's dispatch logic — routing by active_language, not STT correctness."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.stt_router import STTRouter, TranscriptionResult  # noqa: E402


class FakeEngine:
    def __init__(self, name, available=True):
        self.name = name
        self._available = available
        self.calls = []
        self.beams = []

    def available(self):
        return self._available

    def transcribe(self, audio, *, language, detect, beam_size=5):
        self.calls.append((language, detect))
        self.beams.append(beam_size)
        return TranscriptionResult(
            transcript=f"[{self.name}]", detected_language=language,
            confidence=0.9, engine=self.name,
        )


class DispatchTestCase(unittest.TestCase):
    def router(self, derja_available=True):
        router = STTRouter()
        router.whisper = FakeEngine("faster-whisper")
        router.derja = FakeEngine("derja", available=derja_available)
        return router

    def test_arabic_routes_to_derja_engine(self):
        router = self.router()
        result = router.transcribe_turn(b"x" * 200, "ar")
        self.assertEqual(result.engine, "derja")
        self.assertEqual(router.derja.calls, [("ar", True)])
        self.assertEqual(router.whisper.calls, [])

    def test_english_routes_to_whisper_engine(self):
        router = self.router()
        result = router.transcribe_turn(b"x" * 200, "en")
        self.assertEqual(result.engine, "faster-whisper")
        self.assertEqual(router.whisper.calls, [("en", True)])
        self.assertEqual(router.derja.calls, [])

    def test_french_routes_to_whisper_engine(self):
        router = self.router()
        result = router.transcribe_turn(b"x" * 200, "fr")
        self.assertEqual(result.engine, "faster-whisper")
        self.assertEqual(router.whisper.calls, [("fr", True)])
        self.assertEqual(router.derja.calls, [])

    def test_arabic_falls_back_to_whisper_when_derja_unavailable(self):
        router = self.router(derja_available=False)
        result = router.transcribe_turn(b"x" * 200, "ar")
        self.assertEqual(result.engine, "faster-whisper")
        self.assertEqual(router.whisper.calls, [("ar", True)])
        self.assertEqual(router.derja.calls, [])

    def test_beam_size_is_forwarded_to_the_engine(self):
        """The live path decodes at a different beam than the final pass."""
        router = self.router()
        router.transcribe_turn(b"x" * 200, "en", beam_size=1)
        router.transcribe_turn(b"x" * 200, "en")
        self.assertEqual(router.whisper.beams, [1, 5])

    def test_arabic_falls_back_to_whisper_when_derja_raises(self):
        router = self.router()

        def boom(audio, *, language, detect, beam_size=5):
            raise RuntimeError("engine exploded")

        router.derja.transcribe = boom
        result = router.transcribe_turn(b"x" * 200, "ar")
        self.assertEqual(result.engine, "faster-whisper")
        self.assertEqual(router.whisper.calls, [("ar", True)])


if __name__ == "__main__":
    unittest.main(verbosity=2)
