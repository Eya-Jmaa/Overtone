# Overtone — Detailed Project Description

> **Status:** Live snapshot of the codebase as of 2026-08-03.
> This document replaces the older, stale project docs (`PROJECT_ARCHITECTURE_REPORT.md`, `PROJECT_HANDOFF.md`, `PIPELINE.md`) which predate the Gemini LLM migration, the RAG wiring, the live WebSocket voice loop, the webcam emotion pipeline, and the Tunisian Derja STT integration.

---

## 1. What This Project Is

**Overtone** is a full-stack, real-time, multimodal communication-coaching web application. Users practice difficult conversations (negotiations, interviews, boundary-setting, emotional regulation, sport-performance mindset) with an AI coach that **listens, watches, answers, and speaks back**.

The product supports three immersion modes:

| Mode | Persona |
|------|---------|
| `psy` | Empathetic psychology coach — emotional intelligence, self-awareness, relationships |
| `professional` | Sharp career coach — negotiation, feedback, interviews |
| `sport` | Sport performance coach — mindset, motivation, resilience |

Each coaching session can be conducted as:
- **Text chat** (batch LLM replies via HTTP)
- **Voice conversation** (live WebSocket audio, transcribed with STT, replies streamed as text + spoken audio via TTS)
- **Video conversation** (voice + throttled webcam frames analyzed in real time for facial expression, gaze, self-touch, head motion)

After a session, the user can end it and get a **coaching report**: an LLM-written debrief grounded in measured metrics (session length, filler rate) and evidence-based techniques retrieved from a 603-document knowledge base (RAG).

---

## 2. Tech Stack

### Backend (`backend/`)
- **Framework:** FastAPI + Uvicorn
- **ORM / DB:** SQLAlchemy + SQLite (WAL mode, 15s busy timeout — tuned for the long-lived WebSocket DB session)
- **Auth:** JWT access tokens (15 min) + rotating httponly refresh cookies (7 days), passlib/bcrypt password hashing, Google OAuth 2.0
- **Email:** Gmail SMTP (smtplib) for 6-digit verification codes
- **LLM:** Google Gemini (`gemini-2.5-flash`) via the `google-genai` SDK — model name is config-driven
- **STT:** faster-whisper (multilingual, CPU int8) **+** LinTO/Vosk Tunisian Derja model (`linagora/linto-asr-ar-tn-0.1`)
- **TTS:** Kokoro-82M served locally via Kokoro-FastAPI (OpenAI-compatible `/v1/audio/speech`)
- **Video analysis:** MediaPipe Tasks (FaceLandmarker + HandLandmarker) + EmotiEffLib (ONNX, EfficientNet-B0, 8-class AffectNet)
- **RAG:** ChromaDB + `intfloat/multilingual-e5-base` (603 chunks)
- **Config:** pydantic-settings (`.env`)

### Frontend (`frontend/`)
- **Framework:** React 19 + Vite 8
- **State:** Zustand stores (auth, conversations, messages, theme, toast, drafts)
- **Routing:** React Router v7 with protected routes
- **Real-time:** Native WebSocket client with auto-reconnect + exponential backoff
- **Audio:** Single shared `getUserMedia` stream (reference-counted `micStream.js`), shared `AudioContext`, gapless Web-Audio TTS output player, real-amplitude input analyser
- **VAD:** `@ricky0123/vad-web` (voice activity detection with dual-API fallback)
- **Webcam:** `useWebcam` hook + `frameCapture` util — downscaled JPEG frames streamed to the backend at ~2fps
- **UI:** Dark editorial aesthetic (ink/bone/gold design tokens), Fraunces/Inter/JetBrains Mono fonts, theme-aware (light/dark)

---

## 3. Architecture at a Glance

```
┌────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React 19 + Vite)                 │
│                                                                │
│  Auth pages  ·  ConversationPage  ·  VoiceMode (full-screen)   │
│  ·  ReportPage ·  Sidebar ·  NewConversationPage               │
│                                                                │
│  Zustand stores · audioEngine (gapless TTS + analysers)        │
│  · micStream (ref-counted) · wsClient (auto-reconnect)         │
│  · useWebcam / useVAD / useAudioRecorder                       │
└───────────────┬──────────────────────────────┬─────────────────┘
                │ HTTP (JSON)                 │ WebSocket
                ▼                             ▼
┌────────────────────────────────────────────────────────────────┐
│                      BACKEND (FastAPI)                          │
│                                                                │
│  /auth/*       — email verification, JWT, Google OAuth          │
│  /conversations* — CRUD, messages, scenarios, end, report       │
│  /transcribe/  — batch Whisper STT                             │
│  /audio/*      — upload + serve user recordings                 │
│  /ws/conversation/{id} — live voice/video turn pipeline         │
│                                                                │
│  SERVICES                                                       │
│  llm_service (Gemini + RAG)        tts_router → Kokoro/SILMA    │
│  stt_router → faster-whisper / linto_stt (Derja)                │
│  face_analyzer (MediaPipe + EmotiEffLib)                        │
│  fusion (cross-modal signal fusion)                             │
│  language_service (hysteresis resolver)                         │
│  report_service (LLM debrief + measured metrics)                │
│  rag_engine (ChromaDB retrieval)                                │
└───────────────┬──────────────────────────────┬─────────────────┘
                │                             │
                ▼                             ▼
     Google Gemini 2.5 Flash        Kokoro-82M (Docker, TTS)
     (LLM)                          faster-whisper / LinTO-Vosk (STT)
                                    MediaPipe + EmotiEffLib (video)
                                    ChromaDB (RAG, 603 chunks)
```

---

## 4. The Live Voice Turn Pipeline (WebSocket)

This is the heart of the product. Everything below runs through `backend/routers/ws.py` plus the shared `services/turn_service.py`.

```
User holds push-to-talk (or VAD detects speech)
  → frontend MediaRecorder (250ms timeslices, audio/webm) sends binary chunks over WS
  → backend SessionState buffers: header_chunk (WebM init) + recent_chunks (bounded deque, ~4s) + full audio_buffer
  → every ~500ms, if not busy: GREEDY (beam=1) Whisper pass over header + recent → {"partial_transcript"}
  → user releases / VAD end → {"end_turn"}

end_turn handler:
  1. Cancel any in-flight coach turn (barge-in) + tell client to flush TTS audio
  2. STT via stt_router.transcribe_turn():
       - active_language="ar"  → Derja engine (LinTO/Vosk if installed) else Whisper pinned "ar"
       - active_language=en/fr → faster-whisper pinned
       → returns {transcript, detected_language, confidence, engine}
  3. Kick off VERBATIM second decode for filler counting (background, ~1.5s, doesn't block turn)
  4. LanguageResolver.resolve(detected, confidence, transcript) → session's active_language
       - hysteresis: same new language must win N consecutive turns (default 2) confidently
       - Arabic-family codes (ar/ary/arz/acm/apc/fa/ur) collapse to "ar"
       - if switched and certain → send {"language"} frame so the UI can show it
  5. Build [live signals] line once:
       fusion.fuse(latest_video_signal, last_voice_signal) → video expression / eye contact /
       self-touch / engagement + voice hesitant/fluent + incongruence flags
  6. Spawn cancellable turn_task (so the receive loop stays free for barge-in):
       process_user_turn_stream():
         - history query (read-only, no write txn yet — SQLite lock discipline)
         - LLM stream: get_coach_response_stream(Gemini) on a worker thread; deltas bridged
           to the event loop via asyncio.Queue, so the FIRST token arrives in ~hundreds of ms
         - sentences_from_deltas() buffers deltas into complete sentences (handles
           abbreviations/decimals so it never splits mid-sentence)
         - each sentence → {assistant_delta} text frame  AND  pushed into an ordered
           TTS pipeline (concurrent synth, capped at 3, ordered send)
         - TTS routed by session language (kokoro en/fr; SILMA seam for ar — see §6)
         - audio bytes sent as raw binary WS frames; first one flips state to "speaking"
         - {"assistant_done"} when all sentences produced + audio sent
       attach filler_count to the just-committed user message (tiny standalone UPDATE)
```

### Key WS protocol frames

| Direction | Type | Payload |
|-----------|------|---------|
| Client → Server | binary | WebM audio chunk (250ms) |
| Client → Server | `start_turn` | Begin new turn (barge-in cancels coach speech) |
| Client → Server | `end_turn` | Finalize turn → transcript → LLM → TTS |
| Client → Server | `video_frame` | Base64 downscaled JPEG webcam frame |
| Server → Client | `partial_transcript` | Live disposable Whisper partial |
| Server → Client | `state` | `listening` / `processing` / `speaking` |
| Server → Client | `assistant_delta` | Streamed LLM sentence |
| Server → Client | binary | TTS audio bytes (MP3 from Kokoro) |
| Server → Client | `assistant_done` | Turn complete |
| Server → Client | `language` | Active-language switch notification |
| Server → Client | `stop_audio` | Barge-in: flush TTS immediately |
| Server → Client | `error` | Error frame |

---

## 5. Language Routing (Code-Switch Resistance)

Tunisian Derja is heavily code-switched ("normalement نمشي demain" is ordinary speech). The project solves this with a **single per-session language source of truth**:

- **`services/language_service.py`** — `LanguageResolver` holds the session's `active_language` and updates it once per completed turn via hysteresis:
  - Turn-level (one decision per utterance, not per word/chunk)
  - Dominant-language (the bulk of the turn wins, not a single token)
  - Sticky — a switch requires the **same** new language to win **confidently** for `lang_switch_sustain_turns` (default 2) **consecutive** turns
  - Arabic-collapsing — `ar,ary,arz,acm,apc,fa,ur` all map to `ar`, because Whisper frequently labels short Derja clips as nearby-family codes
- **STT** reads it (`stt_router.transcribe_turn`), **LLM** reads it (`_language_directive` — including a Derja-specific directive that allows natural light French/English code-switching while keeping Arabic as the base), **TTS** reads it (`tts_router.synthesize`).

The text-chat path (`process_user_turn`) fills the same gap with `langdetect` (`detect_text_language`) plus a fallback to the coach's last reply for short follow-ups.

---

## 6. What's Wired and Working Today (2026-08-03)

### ✅ Tunisian Derja STT — **WIRED** (`services/linto_stt.py` + `services/stt_router.py`)

The `"vosk"` backend anticipated by `DerjaEngine` is now **implemented**:

- **Model:** `linagora/linto-asr-ar-tn-0.1` — a Kaldi TDNN + Tunisian code-switching LM, packaged for Vosk. CC BY 4.0, arxiv:2504.02604.
- **Loading:** lazy, process-wide `vosk.Model` singleton (mirrors the `WhisperModel` singleton in `routers/transcribe.py`).
- **Decode:** webm/opus → 16 kHz mono PCM16 via `librosa.load` (`_decode_to_pcm16`); fed to `KaldiRecognizer` in ~4 KB chunks.
- **Streaming-ready:** `LintoStreamingSession` wraps one `KaldiRecognizer` per utterance with `accept_chunk()` / `partial()` / `final()` — a future caller with genuine per-chunk audio can drive it incrementally. Today `transcribe()` is the turn-level wrapper `stt_router` calls (buffered whole-turn audio, internally chunked).
- **Activation:** off by default. Set `DERJA_STT_BACKEND=vosk` + `DERJA_STT_MODEL_PATH=backend/models/linto-asr-ar-tn/vosk-model` in `.env` after running `backend/scripts/setup_linto_model.py`.
- **Fallback:** if unconfigured/throws, Arabic routes to faster-whisper pinned to `"ar"` (MSA-level quality, logged honestly).
- **Tests:** `backend/tests/test_linto_stt.py` + `test_stt_router_dispatch.py` (28 total, stdlib unittest, fake `vosk` module — no model/package needed).

### ✅ Emotions from Camera — **WIRED** (`services/face_analyzer.py`, `routers/ws.py`)

The webcam emotion/body-language layer is live:

- **Models:** MediaPipe Tasks `FaceLandmarker` (478-point mesh, incl. iris points) + `HandLandmarker` (2 hands); EmotiEffLib `enet_b0_8_best_afew` (ONNX, EfficientNet-B0, 8-class AffectNet: Neutral, Happiness, Sadness, Surprise, Fear, Disgust, Anger, Contempt). Bundles auto-downloaded on first run to `backend/models/mediapipe/`.
- **Signals computed (headshot-only; no fabricated posture/gesture):**
  - **Expression** — majority vote over a rolling 5-frame buffer; CNN forward pass every N frames (config `face_expression_every_n=3`)
  - **Gaze / eye-contact** — iris-in-eye-socket geometry; ratio ≥ 0.65 counts as eye contact
  - **Self-touch** — hand landmark proximity to the face bbox
  - **Head motion** — vertical nose movement (nod/shrink-back)
  - **Engagement** (optional, off by default) — EmotiEffLib's 2-class Engaged/Distracted with a 128-frame feature window; needs tensorflow (not a default dep)
- **Transport:** frontend streams downscaled JPEG data URLs at ~2fps → WS `video_frame` → backend decodes (`cv2`), analyzes via a per-session `FaceAnalyzer` (smoothing buffers only; shared heavy models are process-wide singletons), and stashes the result on `SessionState.latest_video_signal`.
- **Injection:** once per turn, `fusion.summary_line()` produces a compact `[live signals] expression: happy (0.82) · eye contact: 94% · voice: fluent · ⚠ low eye contact` line that's injected into the Gemini prompt alongside guidance on how to use it (name anxiety gently once, don't quote back verbatim).
- **Throttle:** server-side floor `face_min_frame_interval_ms` (450ms) + drop-if-busy (latest-frame-wins) — a slow analysis pass can't queue a backlog.

### ✅ RAG Knowledge Base — **WIRED** (`services/rag_engine.py`, `services/llm_service.py`)

603 chunks in a ChromaDB `coaching_kb` collection (mode + `all` metadata), embedded offline with `intfloat/multilingual-e5-base` (dim 768, `passage:`/`query:` prefixes, L2-normalized). Every coaching turn and the coaching report retrieve mode-filtered top-4 / top-8 evidence-based techniques and inject them as grounding. **Fails open** — no KB, no result, turn proceeds ungounded.

### ✅ LLM — **WIRED** (`services/llm_service.py`)

Google Gemini `gemini-2.5-flash` via the `google-genai` SDK. Streaming (`generate_content_stream`) bridged to the event loop through a worker thread + `asyncio.Queue`. Three mode personas + a language directive + RAG grounding + optional live-signal directive. Clean error wrapping (429 → friendly rate-limit message; SDK errors → readable text). Report generation uses strict-JSON mode (`response_mime_type`).

### ✅ TTS (en/fr) — **WIRED** (`services/tts_service.py`, `services/kokoro_launcher.py`)

Kokoro-82M via Kokoro-FastAPI (`OpenAI-compatible` `/v1/audio/speech`). Auto-started as a Docker container on boot (best-effort, background thread). Text cleaning (`clean_for_tts`: markdown/emoji/code-block stripping, number and abbreviation expansion) is what stops the coach from sounding robotic. Sentence buffering (`sentences_from_deltas`) preserves prosody and drives the ordered, concurrent (max 3 in-flight) TTS pipeline — the coach starts speaking sentence 1 while sentence 2 is still being generated.

### ✅ Barge-in — **WIRED** (`routers/ws.py`)

`start_turn` cancels the in-flight coach turn, rolls back the SQLite write txn (releases the single-writer lock), and sends `stop_audio` so the client flushes TTS. The frontend's output player has a `stop()` that kills all scheduled buffer sources.

### ✅ Coaching Reports — **WIRED** (`services/report_service.py` + `routers/conversations.py`)

`POST /conversations/{id}/end` generates and persists (once, idempotently) an LLM-written debrief: summary, went-well moments, improvement moments with named RAG techniques + priorities, practice drill, and a score grid. **Honesty rules:** only *measured* metrics (session length, filler rate from verbatim voice turns) get numbers; everything else is either labelled `"llm"` (model judgment of wording) or `null` (UI shows "Not yet measured"). The report is generated with the session's mode + language directive, so a Derja session gets a Derja report.

### ✅ Voice metrics: filler counting

The verbatim second decode (`count_fillers_verbatim` in `ws.py`) recovers disfluencies (Whisper's default normalization removes them) with a special prompt, counts filler words (`um/uh/like/you know/...`), and stores `Message.filler_count`. `fusion.voice_signal()` converts count + word count to a `filler_rate` + `hesitant` boolean, feeding the report's measured filler-rate score and the cross-modal incongruence check.

### ✅ Frontend UX

- **Full-screen VoiceMode** — a quiet room takeover with a canvas-rendered orb that morphs per state and reacts to *real* audio amplitude (mic analyser while you speak, TTS analyser while the coach speaks), push-to-talk (button or Space), mute (M), video toggle (V), "Back to chat", and "End session". Video is added lazily to the shared mic stream (no second `getUserMedia`).
- **New conversation page** — inline mode picker and "Start voice conversation" / "Start video conversation" entries that jump straight into a live session (no first text message needed).
- **Normal chat page** — text + batch voice messages (STT via `/transcribe/`) + live VAD-driven voice turns + webcam self-view.
- **Reconnect UX** — the orb shows attempt counts; `WsClient` auto-reconnects with exponential backoff.
- **Offline resilience** — pending messages queue and auto-resend on `online` (messageStore).

---

## 7. STILL A SEAM, NOT YET WIRED — The Place for a Tunisian TTS Model

**The single biggest remaining gap is Arabic/Derja spoken replies.** Today the coach *writes* Arabic/Derja fine, but an Arabic session gets **no spoken audio** — by design, per the module docstring: *"never fall back to an English voice for Arabic"* (an English voice reading Arabic text produces confident gibberish, which is worse than silence). The reply always streams as text; only audio is withheld.

### Where it plugs in

**`backend/services/tts_router.py`** already defines the seam:

```python
class SilmaEngine:
    """Arabic/Derja TTS — SEAM, not yet installed.
    Expects an OpenAI-compatible speech endpoint at settings.silma_base_url...
    Set SILMA_VOICE to a fine-tuned Derja voice; leaving it empty while base_url is
    set means un-fine-tuned MSA, which the router serves as `degraded=True`..."""
```

The routing logic is already complete:

```
language == "ar"
  ├─ silma.available()  (silma_base_url set) → silma.synthesize()
  │     ├─ SILMA_VOICE set        → fine-tuned Derja voice (intended quality)
  │     └─ SILMA_VOICE empty      → un-fine-tuned MSA accent → degraded=True (warned, still correct language)
  └─ else → no audio + explicit reason (never an English voice)
```

### What "wiring a Tunisian TTS model" means concretely

1. **Get a Derja-capable voice model.** Options:
   - **Fine-tune SILMA** (a small Arabic/Moroccan TTS — F5 diffusion based) on Tunisian Derja speech data → an OpenAI-compatible endpoint.
   - Alternatively, any OpenAI-compatible speech endpoint (`/v1/audio/speech`) that accepts `model` + `voice` + `input` + `response_format` can be pointed to with two `.env` lines:
     ```
     SILMA_BASE_URL=http://localhost:5050/v1     # or whatever serves the model
     SILMA_VOICE=your_fine_tuned_derja_voice
     ```
     (the `SilmaEngine.synthesize` already uses `client.audio.speech.create(model="silma", voice=..., input=..., response_format=settings.kokoro_response_format)`).
2. **No frontend change needed** — the WS pipeline already streams whatever bytes `synthesize_for_language()` returns; the gapless output player already plays them.
3. **Config already present** in `config.py`: `silma_base_url`, `silma_voice`, `silma_timeout_seconds` (60s, because F5 diffusion is slow on CPU).
4. **Keep the `degraded` flag** — `SynthesisResult` carries `degraded` + `reason` so ops can see when Arabic audio is "correct language but MSA accent" vs "fine-tuned Derja".

---

## 8. STILL EMPTY STUBS — The Place for Speech-Based Emotions

The `Message` model already has columns for them (`emotion`, `pitch`, `energy`, `filler_count`, `assertiveness`), the DB schema is ready, and there are trained/research artifacts + training notebooks on disk — but the **runtime services are still 0-byte files**:

| File | Status | Purpose |
|------|--------|---------|
| `backend/services/emotion_model.py` | **0 bytes (stub)** | Load `models/emotion_cnn.onnx` via onnxruntime; classify vocal emotion from audio |
| `backend/services/audio_features.py` | **0 bytes (stub)** | librosa-based pitch, energy, tempo, pause detection from audio waveforms |
| `backend/services/nlp_analyzer.py` | **0 bytes (stub)** | spaCy pipeline for sentiment, key phrases, communication patterns |
| `backend/services/whisper_stt.py` | **0 bytes (stub)** | faster-whisper wrapper (transcription currently lives in `routers/transcribe.py` directly) |

### What exists to build on

- **`backend/training/emotion_model_service.py`** — a complete, ready-to-copy **production inference service** (drop-in for `backend/services/emotion_model.py`):
  - `EmotionPredictor` with **FAST** mode (ONNX EfficientNet → ~50 ms CPU, real-time per-chunk) and **ACCURATE** mode (Wav2Vec2 + CNN ensemble → ~250 ms, post-session report)
  - 8 emotion labels: `neutral, calm, happy, sad, angry, fearful, disgust, surprised`
  - `extract_spectrogram()` (3-channel mel + MFCC + delta-MFCC → 224×224), `softmax`, TTA (`predict_with_tta`)
  - Usage docstring shows exactly how to insert it into `services/emotion_model.py`
- **`backend/training/train_emotion_cnn.ipynb`**, `train_expression_classifier.ipynb`, `evaluate_models.ipynb` — training/eval notebooks
- **`backend/models/emotion_cnn.onnx`** — the trained ONNX artifact (currently unused)
- **`backend/training/models/`** — additional trained artifacts (e.g. RAVDESS-based aggression model)
- **`models/emotion_cnn.onnx`** at repo root referenced in the training service

### Where they plug in

1. **Live per-turn:** in `ws.py`'s `end_turn` handler (or `turn_service`), alongside the existing filler-count pass:
   - Run `EmotionPredictor.predict_fast(turn_audio)` on the same webm bytes → `emotion`, `confidence`, `all_probabilities`
   - Persist to `Message.emotion` (and run `audio_features` for `pitch`/`energy` → persist those columns)
2. **Fusion:** `services/fusion.py` already accepts an optional `voice` signal dict. Today it only gets `{filler_rate, hesitant}` from the filler count. A vocal-emotion model would extend this to e.g. `{emotion, anger_score, confidence, filler_rate, ...}` — the `[live signals]` summary line and the incongruence checks (masked anxiety: fluent speech + anxious expression) get richer automatically.
3. **Report:** `report_service.py` `_measured_metrics()` would gain real `emotion` / `assertiveness` / `pitch` / `energy` entries with `basis: "measured"` instead of `null`.
4. **LLM prompt:** the `[live signals]` line feeds the Gemini prompt already; vocal-emotion signals would flow through unchanged.

### One caution from the existing code

`fusion.py`'s docstring makes the honesty rule explicit: *only combine signals that are actually measured*. Until `emotion_model.py` is actually wired and producing real predictions, the code deliberately shows `Not yet measured` rather than inventing a flattering zero. The wiring work is exactly: copy `emotion_model_service.py` → `services/emotion_model.py`, call `predict_fast()` / `predict_accurate()` at the right spots, persist + fuse + report.

---

## 9. Known Remaining Gaps (Honest List)

| Area | Status | Where |
|------|--------|-------|
| Arabic/Derja TTS (spoken replies) | **Seam exists, engine not installed** | `services/tts_router.py` `SilmaEngine` ← §7 |
| Vocal emotion / pitch / energy / assertiveness | **Empty stubs, artifacts + training service ready** | `services/emotion_model.py`, `audio_features.py`, `nlp_analyzer.py` ← §8 |
| True incremental (chunk-by-chunk) `LintoStreamingSession` in `ws.py` | Built and tested, **not yet driven per-chunk** — ws still buffers a whole turn | `services/linto_stt.py` docstring |
| `sessions.py` router | 0 bytes — session lifecycle lives in `conversations.py` `/end` | `backend/routers/sessions.py` |
| `whisper_stt.py` service | 0 bytes — transcription called directly from `routers/transcribe.py` / `ws.py` | `backend/services/whisper_stt.py` |
| Scenario-aware system prompts | Scenario JSONs exist + endpoints serve them; conversation creation doesn't pass scenario into the LLM prompt | `backend/data/scenarios/*.json`, `llm_service.py` |
| TEMP diagnostics | `ws.py` writes every turn's raw audio to `backend/data/debug_audio/last_turn.webm`; `VoiceMode.jsx` logs the audio track — marked for removal in source | `routers/ws.py` end_turn |
| Engagement classifier | Opt-in, off by default (needs tensorflow + 128-frame window) | `config.face_engagement_enabled` |
| `useTTSPlayer.js` | Dead code since the switch to `audioEngine.js` gapless player | `frontend/src/hooks/useTTSPlayer.js` |
| `authStore.register()` | Calls a nonexistent `authApi.register()` — dead code path (registration uses direct `sendCode`/`verifyCode`/`completeSignup` in `Register.jsx`) | `frontend/src/stores/authStore.js` |

---

## 10. How to Run

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows
pip install -r requirements.txt
# copy .env.example → .env and fill in secrets
# optional: download the LinTO Derja model
python scripts/setup_linto_model.py
# then in .env:
#   DERJA_STT_BACKEND=vosk
#   DERJA_STT_MODEL_PATH=backend/models/linto-asr-ar-tn/vosk-model
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### Tests
```bash
cd backend
venv\Scripts\python.exe -m unittest discover -s tests -v
# 28 tests: language resolver, Linto/Vosk STT shape+plumbing, STT router dispatch
```

---

## 11. File Map (Backend)

| File | Role |
|------|------|
| `main.py` | FastAPI app; lifespan warmup threads (Kokoro, RAG, face models); mounts all routers |
| `config.py` | pydantic-settings — every tunable (STT/TTS/Language/Video/LLM/RAG) in `.env` |
| `database.py` | SQLAlchemy engine, WAL + busy_timeout for SQLite, `get_db` |
| `routers/auth.py` | Email-verification signup, JWT login/refresh/logout, Google OAuth |
| `routers/conversations.py` | Conversation CRUD, `/end` → report, scenarios list/get |
| `routers/messages.py` | Text-chat message turn (sync route → threadpool so the blocking LLM call never freezes the loop) |
| `routers/transcribe.py` | Batch Whisper STT (`/transcribe/`); shared `_get_model()` singleton |
| `routers/audio.py` | Upload + serve user recordings |
| `routers/ws.py` | **Live voice/video turn pipeline** — buffering, partials, end_turn, video frames, barge-in, TTS stream |
| `services/stt_router.py` | STT engine selection by session language; `DerjaEngine` → vosk or whisper fallback |
| `services/linto_stt.py` | **Tunisian Derja STT** — Vosk/Kaldi, streaming session, webm→PCM decode |
| `services/tts_router.py` | TTS selection by session language; **SILMA seam for Arabic** |
| `services/tts_service.py` | Kokoro client + text cleaning + sentence buffering |
| `services/llm_service.py` | Gemini client, personas, language/Derja directives, RAG grounding, live-signal guidance, streaming, report JSON |
| `services/rag_engine.py` | ChromaDB retrieval (mode-filtered), context block builder, fails open |
| `services/language_service.py` | Hysteresis language resolver; Arabic-alias collapsing; text detection via langdetect |
| `services/face_analyzer.py` | **Webcam emotion/body language** — MediaPipe landmarks + EmotiEffLib; per-session smoothing |
| `services/fusion.py` | Cross-modal voice+video fusion, incongruence flags, `[live signals]` summary |
| `services/report_service.py` | Coaching report: transcript w/ timestamps, measured metrics, RAG techniques, LLM debrief |
| `services/turn_service.py` | Shared turn logic (batch + streaming), SQLite lock discipline, title generation |
| `services/session_store.py` | Per-connection `SessionState` (audio buffers, video signal, language state, turn task) |
| `services/emotion_model.py` | **EMPTY STUB** — see `training/emotion_model_service.py` for the ready implementation |
| `services/audio_features.py` | **EMPTY STUB** — pitch/energy/assertiveness extraction |
| `services/nlp_analyzer.py` | **EMPTY STUB** — spaCy text analysis |
| `services/whisper_stt.py` | **EMPTY STUB** — whisper wrapper |
| `scripts/setup_linto_model.py` | One-time LinTO/Vosk model download |
| `scripts/linto_sanity_check.py` | Eyeball check that Derja output follows the mixed-script convention |
| `training/emotion_model_service.py` | **Ready-to-copy production emotion inference service** (FAST + ACCURATE modes) |
| `tests/` | 28 tests (language resolver + linto + STT dispatch) |

## 12. File Map (Frontend)

| File | Role |
|------|------|
| `App.jsx` | Bootstrap session (authStore) + theme init, then RouterProvider |
| `router.jsx` | Route table with `ProtectedRoute` guard |
| `pages/NewConversationPage.jsx` | Mode picker, hero composer, "Start voice/video conversation" |
| `pages/ConversationPage.jsx` | Chat UI: text/audio/video input, WS wiring, optimistic messages, VoiceMode launcher, webcam |
| `pages/ReportPage.jsx` | Coaching report renderer (score grid, sections, drill, sources) |
| `pages/Login.jsx` / `Register.jsx` / `OAuthSuccess.jsx` | Auth |
| `components/voice/VoiceMode.jsx` | Full-screen immersive takeover; push-to-talk, mute, video, orb, reconnect |
| `components/voice/VoiceOrb.jsx` | Canvas orb — real-amplitude react, reduced-motion aware, theme-aware |
| `components/chat/*` | InputBar, MessageList, MessageBubble, AIStatus, WebcamPanel, WaveformViz, etc. |
| `services/wsClient.js` | WebSocket client — JSON/binary detection, auto-reconnect w/ backoff, video_frame |
| `services/audioEngine.js` | Shared `AudioContext`, input analyser, **gapless** output player (onStart/onEnd subscriptions) |
| `services/micStream.js` | Ref-counted shared mic stream; lazy `enableVideoTrack()` |
| `utils/frameCapture.js` | Shared webcam → downscaled JPEG data-URL capture |
| `stores/*` | Zustand: auth, conv, message (offline queue), theme, toast, draft |
| `hooks/useVAD.js` | VAD boundary detection (dual-API fallback) |
| `hooks/useAudioRecorder.js` | MediaRecorder with 250ms timeslice, batch transcription, streaming chunks |
| `hooks/useWebcam.js` | Camera + throttled frame streaming |

---

*This document reflects the codebase at commit `1d96524` and later uncommitted work, and should be kept in sync as the remaining seams (§7 Arabic TTS, §8 speech emotions) get filled.*