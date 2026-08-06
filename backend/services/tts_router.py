"""TTS routing — pick the voice engine for the session's language."""
import logging
from dataclasses import dataclass
from typing import Optional, Protocol

from config import settings
from services.tts_service import clean_for_tts, get_kokoro_client

log = logging.getLogger("coach.tts")


@dataclass
class SynthesisResult:
    audio: Optional[bytes]
    engine: str
    voice: Optional[str]
    language: str
    degraded: bool = False
    reason: str = ""


class TTSEngine(Protocol):
    name: str

    def available(self, language: str) -> bool: ...

    async def synthesize(self, text: str, language: str) -> SynthesisResult: ...


class KokoroEngine:
    """Kokoro-82M via Kokoro-FastAPI. Serves en/fr only in the pinned image."""

    name = "kokoro"

    def voice_for(self, language: str) -> Optional[str]:
        return {
            "en": settings.tts_voice_en,
            "fr": settings.tts_voice_fr,
        }.get(language)

    def available(self, language: str) -> bool:
        return bool(self.voice_for(language))

    async def synthesize(self, text: str, language: str) -> SynthesisResult:
        voice = self.voice_for(language)
        if not voice:
            return SynthesisResult(
                None, self.name, None, language,
                reason=f"Kokoro has no voice for {language!r}",
            )

        cleaned = clean_for_tts(text)
        if not cleaned:
            return SynthesisResult(None, self.name, voice, language, reason="empty text")

        try:
            response = await get_kokoro_client().audio.speech.create(
                model="kokoro",
                voice=voice,
                input=cleaned,
                response_format=settings.kokoro_response_format,
            )
            return SynthesisResult(response.read(), self.name, voice, language)
        except Exception as e:
            log.warning("[tts] kokoro failed (%s/%s): %s", language, voice, e)
            return SynthesisResult(None, self.name, voice, language, reason=str(e))


class SilmaEngine:
    """Arabic/Derja TTS."""

    name = "silma"

    @property
    def _provider(self) -> str:
        return (settings.silma_provider or "").strip().lower()

    def available(self, language: str) -> bool:
        if language != "ar":
            return False
        if self._provider == "local":
            return True
        if self._provider == "http":
            return bool(settings.silma_base_url)
        return False

    @property
    def is_fine_tuned(self) -> bool:
        return self._provider == "local" or bool(settings.silma_voice)

    async def synthesize(self, text: str, language: str) -> SynthesisResult:
        if not self.available(language):
            return SynthesisResult(
                None, self.name, None, language,
                reason="SILMA not configured (set SILMA_PROVIDER=local or http)",
            )

        cleaned = clean_for_tts(text)
        if not cleaned:
            return SynthesisResult(None, self.name, None, language, reason="empty text")

        if self._provider == "local":
            return await self._synthesize_local(cleaned, language)
        return await self._synthesize_http(cleaned, language)

    async def _synthesize_local(self, cleaned: str, language: str) -> SynthesisResult:
        import asyncio
        from services.tts_service import synthesize_silma_local

        try:
            audio = await asyncio.to_thread(synthesize_silma_local, cleaned)
        except Exception as e:
            log.warning("[tts] silma (local) failed: %s", e)
            return SynthesisResult(None, self.name, "local", language, reason=str(e))

        if not audio:
            return SynthesisResult(
                None, self.name, "local", language,
                reason="local SILMA inference returned no audio (see logs)",
            )
        return SynthesisResult(audio, self.name, "local", language)

    async def _synthesize_http(self, cleaned: str, language: str) -> SynthesisResult:
        degraded = not self.is_fine_tuned
        if degraded:
            log.warning(
                "[tts] SILMA_VOICE unset — synthesizing Arabic with un-fine-tuned "
                "MSA accent (Derja quality degraded, but language is correct)"
            )

        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(
                api_key="not-used",
                base_url=settings.silma_base_url,
                timeout=settings.silma_timeout_seconds,
            )
            response = await client.audio.speech.create(
                model="silma",
                voice=settings.silma_voice or "default",
                input=cleaned,
                response_format=settings.kokoro_response_format,
            )
            return SynthesisResult(
                response.read(), self.name, settings.silma_voice or "default",
                language, degraded=degraded,
                reason="un-fine-tuned MSA accent" if degraded else "",
            )
        except Exception as e:
            log.warning("[tts] silma (http) failed: %s", e)
            return SynthesisResult(None, self.name, None, language, reason=str(e))


_kokoro = KokoroEngine()
_silma = SilmaEngine()


class TTSRouter:
    """Routes on the SESSION's active_language."""

    def __init__(self):
        self.kokoro = _kokoro
        self.silma = _silma

    async def synthesize(self, text: str, active_language: str) -> SynthesisResult:
        language = (active_language or settings.lang_default).lower()

        if language == "ar":
            if self.silma.available(language):
                result = await self.silma.synthesize(text, language)
                if result.audio:
                    return result
                log.warning("[tts] SILMA produced no audio: %s", result.reason)
            return SynthesisResult(
                None, "none", None, language,
                reason=(
                    "No Arabic voice available: Kokoro image ships none and SILMA "
                    "is not configured. Reply delivered as text only."
                ),
            )

        if self.kokoro.available(language):
            return await self.kokoro.synthesize(text, language)

        log.warning("[tts] no engine for language %r; no audio", language)
        return SynthesisResult(
            None, "none", None, language, reason=f"no voice configured for {language!r}"
        )


_router: Optional[TTSRouter] = None


def get_tts_router() -> TTSRouter:
    global _router
    if _router is None:
        _router = TTSRouter()
    return _router


async def synthesize_for_language(text: str, active_language: str) -> Optional[bytes]:
    """Convenience wrapper matching tts_service.tts_synthesize's shape."""
    return (await get_tts_router().synthesize(text, active_language)).audio
