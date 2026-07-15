# AI-Coach: Input → Processing → Output Pipeline

This document describes how user input enters the system, how it's processed, and how text/audio/video output is produced and delivered back to the user. It reflects the state of the code as of 2026-07-08.

## Stack overview

- **Backend**: Python FastAPI (`backend/main.py`), SQLAlchemy + SQLite, JWT auth, Google OAuth.
- **Frontend**: React 19 + Vite, Zustand stores, react-router.
- Several ML dependencies are declared in `backend/requirements.txt` (faster-whisper, torch/torchvision, onnxruntime, mediapipe, chromadb, sentence-transformers, edge-tts, openai) but not all are wired into working code yet — see "Planned but not implemented" below.

## 1. Input capture (frontend)

| Input type | Where | Notes |
|---|---|---|
| Text | `frontend/src/components/chat/InputBar.jsx` | Free-text box, submitted via `ConversationPage.jsx`'s `handleSend`. |
| Voice | `frontend/src/hooks/useAudioRecorder.js` | Uses `MediaRecorder`/`getUserMedia` to record webm audio; automatically calls `transcribeAudio()` on stop. |
| Webcam | `frontend/src/hooks/useWebcam.js` | Opens `getUserMedia({ video })` and exposes `captureFrame()` (canvas → JPEG blob). **Not currently consumed anywhere** — no emotion/video analysis is wired to it yet. |

API calls to the backend go through:
- `frontend/src/services/messageApi.js` — `sendMessage`, `transcribeAudio`, `uploadAudio`
- `frontend/src/services/convApi.js` — conversation CRUD
- `frontend/src/services/authApi.js` — auth

## 2. Backend routes

Registered in `backend/main.py`: `auth`, `conversations`, `messages`, `transcribe`, `audio` routers. (`routers/ws.py` exists but is currently empty/unused.)

- **`backend/routers/transcribe.py`** — `POST /transcribe/`
  Accepts an uploaded audio file (webm/wav/ogg/mp4/mpeg), writes it to a temp file, and runs `faster_whisper.WhisperModel("base", device="cpu", compute_type="int8")` to produce a transcript, returned as `{ transcript }`. (A GPU `large-v3-turbo` config is present but commented out.)

- **`backend/routers/audio.py`**
  - `POST /audio/upload` — saves the raw recorded audio blob to `backend/data/audio/{uuid}.ext`, optionally probes duration via an `ffprobe` subprocess.
  - `GET /audio/{filename}` — serves that file back (`FileResponse`, `audio/webm`). This is playback of the **user's own** recording, not synthesized speech.

- **`backend/routers/messages.py`** — `POST /conversations/{id}/messages`
  Saves the user's `Message` row (text + optional `audio_url`/duration), assembles the last 20 turns of history, calls `llm_service.get_coach_response()` for the assistant's reply, saves that reply, and (on the first turn) also calls `generate_title()`.

- **`backend/routers/conversations.py`**
  CRUD for conversations, scenario loading from `backend/data/scenarios/*.json`, and `POST /conversations/{id}/end` → `_generate_coaching_report()`. This report generator is currently a **placeholder**: it just counts messages and returns hardcoded strengths/growth text (see TODO comments in that file noting it should eventually call `llm_service.py`/`rag_engine.py`).

## 3. AI/model calls

- **LLM (coaching replies + titles)** — `backend/services/llm_service.py`
  Uses the `openai` Python SDK pointed at a custom `base_url` (`https://tokenfactory.esprit.tn/api`, Esprit's OpenAI-compatible gateway), model `hosted_vllm/Llama-3.1-70B-Instruct`. API key comes from `settings.llm_api_key` in `backend/config.py`, loaded from `.env`. Exposes:
  - `get_coach_response(mode, history, user_message)` — per-mode system prompts (`psy`, `professional`, `sport`)
  - `generate_title()`

- **Speech-to-text** — `faster-whisper`, run locally/CPU (`int8`, `base` model) directly inside `routers/transcribe.py`. No external STT API is called.

### Planned but not implemented

These service files exist as empty placeholders, despite their dependencies being listed in `requirements.txt`:

- `backend/services/tts_service.py` — text-to-speech (would likely use `edge-tts`)
- `backend/services/whisper_stt.py`
- `backend/services/rag_engine.py` — retrieval-augmented generation (chromadb + sentence-transformers)
- `backend/services/emotion_model.py` / `audio_features.py` / `nlp_analyzer.py` — a trained ONNX emotion model (`models/emotion_cnn.onnx`) exists but nothing calls it
- `frontend/src/hooks/useTTSPlayer.js` — frontend TTS playback hook, also an empty stub

So today: no synthesized audio, no video output, and no RAG-augmented responses/reports — only the LLM text-reply loop is functional end-to-end.

## 4. Output generation & delivery

- **Text** — the assistant's `content` is returned as JSON from `POST /conversations/{id}/messages` and rendered by `frontend/src/components/chat/MessageBubble.jsx` / `MessageList.jsx`.
- **Audio** — no TTS-synthesized audio exists yet. The only audio output path is **playback of the user's own uploaded recording**, via `frontend/src/components/chat/AudioBubble.jsx`, which streams the file from `GET /audio/{filename}` (stored under `backend/data/audio/`).
- **Video** — none is generated. Webcam capture is client-side only and currently unconsumed.
- **Coaching reports** — `CoachingReportOut` schema (`backend/services/schemas.py`), rendered on `frontend/src/pages/ReportPage.jsx` via `GET /conversations/{id}/report`, backed by the `CoachingReport` model in `backend/services/db_models.py`. Content is currently placeholder-only (see §2).

## 5. Streaming vs. batch

Every stage of this pipeline currently **waits for the input to fully finish before processing it** — nothing is streamed incrementally. In practice this means: no live/partial transcripts, no token-by-token reply rendering, and the UI just shows a "thinking" indicator until the whole round-trip completes.

| Stage | Behavior | Evidence |
|---|---|---|
| Audio recording | **Batch** | `useAudioRecorder.js` calls `recorder.start()` with no `timeslice` argument, so `ondataavailable` only fires once `stop()` is called — the blob is assembled entirely in `onstop`, then handed to `transcribeAudio()` in one shot. No chunks are emitted or uploaded while recording is in progress. |
| Audio upload | **Batch** | `messageApi.js` (`transcribeAudio`/`uploadAudio`) builds one `FormData` with the complete blob and issues a single `fetch(...)` — not a chunked/streamed upload. Backend side, `transcribe.py` (`tmp.write(await audio.read())`) and `audio.py` (`content = await audio.read()`) both read the entire file before doing anything with it. |
| Transcription | **Batch** | `transcribe.py` runs `model.transcribe(tmp_path, beam_size=5)` over the whole saved file, joins all segments together, and returns one JSON `{ transcript }` — no partial results are streamed back as Whisper processes the audio. |
| LLM call | **Batch** | `llm_service.py` calls `client.chat.completions.create(...)` without `stream=True`, so it blocks until the full completion is ready and returns `response.choices[0].message.content` as one complete string. |
| Backend → frontend | **Batch** | `routers/messages.py` awaits the full LLM string, saves it to the DB, and returns a single ordinary JSON response (`response_model=list[MessageItemOut]`) — no `StreamingResponse`, SSE, or chunked transfer is used anywhere. |
| Frontend rendering | **Batch** | `ConversationPage.jsx` awaits the full `sendMessage()` promise (which itself just does `res.json()`) while showing a generic "thinking" `AIStatus` indicator; `MessageList` renders the assistant's message only once that promise resolves — there's no token-by-token/typewriter rendering or `EventSource` usage. |

If low-latency, "streaming" UX (live partial transcripts, token-by-token replies) is desired later, the concrete changes needed are: pass a `timeslice` to `MediaRecorder.start()` and stream chunks up via WebSocket (the empty `routers/ws.py` looks like it was scaffolded for exactly this); use Whisper's streaming/segment-by-segment API instead of a single `transcribe()` call; pass `stream=True` to the OpenAI-compatible client and forward deltas via `StreamingResponse`/SSE; and switch the frontend to consume that stream incrementally (e.g. `EventSource` or reading a `ReadableStream` body) instead of `await res.json()`.

## End-to-end summary

```
mic / text input (frontend)
   -> optional Whisper transcription (POST /transcribe/) + raw audio upload (POST /audio/upload)
   -> POST /conversations/{id}/messages (FastAPI)
   -> llm_service.get_coach_response() -> OpenAI-compatible call to Llama-3.1-70B (Token Factory)
   -> assistant text reply persisted to DB and returned
   -> rendered in chat UI (MessageBubble / AudioBubble for the user's own recording playback)
```

TTS synthesis, webcam/emotion analysis, and RAG-augmented coaching/reporting are scaffolded (dependencies installed, empty service files, DB schema in place) but **not yet implemented**.
