"""Decode streamed audio containers to raw PCM for sample-accurate slicing.

The live voice path needs to transcribe "everything the user has said since
sample N". Slicing the WebM byte stream itself does not work: cluster timestamps
are absolute, so handing Whisper `header + later clusters` yields a stream that
still claims to start at t=0 with a long silent gap — it decodes slowly and
transcribes badly. Decoding to PCM first makes the slice exact and cheap.
"""
import io
import logging

import numpy as np

log = logging.getLogger("coach.stt")

SAMPLE_RATE = 16000


def decode_to_pcm16k(audio: bytes) -> np.ndarray:
    """Encoded audio container -> mono float32 @ 16 kHz. Empty array on failure."""
    if not audio:
        return np.zeros(0, dtype=np.float32)

    try:
        import av

        with av.open(io.BytesIO(audio)) as container:
            if not container.streams.audio:
                return np.zeros(0, dtype=np.float32)
            stream = container.streams.audio[0]
            resampler = av.audio.resampler.AudioResampler(
                format="fltp", layout="mono", rate=SAMPLE_RATE
            )
            parts = []
            for frame in container.decode(stream):
                for resampled in resampler.resample(frame):
                    parts.append(resampled.to_ndarray().reshape(-1))
            # Flush whatever the resampler is still holding.
            for resampled in resampler.resample(None):
                parts.append(resampled.to_ndarray().reshape(-1))

        if parts:
            return np.concatenate(parts).astype(np.float32)
    except Exception as e:
        log.debug("[stt] pyav decode failed, falling back to librosa: %s", e)

    try:
        import librosa

        wav, _ = librosa.load(io.BytesIO(audio), sr=SAMPLE_RATE, mono=True)
        return wav.astype(np.float32)
    except Exception as e:
        log.warning("[stt] could not decode audio to PCM: %s", e)
        return np.zeros(0, dtype=np.float32)
