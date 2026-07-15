# AI-Coach: Progress & Outstanding Work

Status snapshot as of 2026-07-15. Complements [PIPELINE.md](PIPELINE.md) (architecture overview) — this file tracks what's actually done vs. still stubbed/broken. Substantially rewritten this pass: TTS, real token streaming, and an immersive voice mode have all landed since the last update.

## Fixed: "database is locked" on create/delete conversation (2026-07-15)

Root cause was **not** duplicate processes (a stray second `uvicorn` instance was found and killed along the way, but that was a red herring/separate issue) — it was that `turn_service.process_user_turn`/`process_user_turn_stream` called `db.add(user_msg); db.flush()` **before** calling the LLM. `flush()` opens a real SQLite write transaction, and since the LLM call (`llm_service.py`, no timeout configured) could take many seconds or hang indefinitely on a slow/unresponsive endpoint, that write transaction — and SQLite's single writer lock — stayed open for the entire duration of the call. Any other write (creating/deleting a conversation) failed with "database is locked" for as long as that request was in flight, and a truly hung LLM call could block the write lock forever (also explaining why the server sometimes wouldn't shut down cleanly on Ctrl+C — the blocking call runs in a worker thread that can't be cancelled from outside).

Fixed by:
1. **`turn_service.py`**: reordered both `process_user_turn` and `process_user_turn_stream` so the history query happens first (read-only, doesn't block writers), the LLM call happens with no write transaction open at all, and the user message + assistant message are only added/committed together at the very end, once the LLM has actually responded. The write transaction is now short and only opens once, right before commit.
2. **`llm_service.py`**: added `timeout=30.0, max_retries=1` to the `OpenAI` client — previously unbounded, so a hung gateway call had no ceiling.
3. **`database.py`**: SQLite WAL mode + 15s `busy_timeout` (still worth keeping as defense in depth for genuine brief contention, even though it wasn't the root cause of the *unbounded* hangs).
4. **`routers/ws.py`**: fixed a `RuntimeError` from calling `websocket.receive()` again after a disconnect message, and added `db.rollback()` in the turn-processing exception handler so an errored voice turn can't leave the long-lived per-connection session sitting on an uncommitted transaction.

## Models used

| Purpose | Model | Where configured | Notes |
|---|---|---|---|
| Coaching replies + conversation titles | `hosted_vllm/Llama-3.1-70B-Instruct` | `backend/services/llm_service.py` | Served via an OpenAI-compatible gateway at `base_url="https://tokenfactory.esprit.tn/api"` (Esprit's "Token Factory"), auth'd with `settings.llm_api_key`. `temperature=0.7`, `top_p=0.9`, `max_tokens=512`. Three mode-specific system prompts (`psy`/`professional`/`sport`). Title generation reuses the model with `max_tokens=15`, `temperature=0.4`. |
| Speech-to-text | `faster-whisper`, model/device/compute-type now driven by `config.py` (`whisper_model="base"`, `whisper_device="cpu"`, `whisper_compute_type="int8"` by default) | `backend/routers/transcribe.py` (`_get_model()`, module-level singleton shared with `ws.py`) | **Two distinct passes, tuned differently**: live partials use `beam_size=1` (greedy) for speed since they're disposable and re-run constantly; the final/batch transcript uses `beam_size=5` for accuracy. Live passes also use `condition_on_previous_text=False` and `vad_filter=True` (`min_silence_duration_ms=300`) to avoid drift/hallucination on short windows. |
| Text-to-speech | **Kokoro-82M**, served locally via **Kokoro-FastAPI** (OpenAI-compatible `/v1/audio/speech`) | `backend/services/tts_service.py`, `backend/services/kokoro_launcher.py`, `config.py` (`kokoro_*` settings) | Voice `af_bella`, format `mp3`. Called with `AsyncOpenAI(base_url=settings.kokoro_base_url)`. `kokoro_launcher.ensure_kokoro_running()` auto-starts the Kokoro Docker container (`ghcr.io/remsky/kokoro-fastapi-cpu:latest`) on backend boot via the `docker` CLI (best-effort, never fatal — runs on a background thread so a first-run image pull doesn't block uvicorn). |
| Emotion / body-language analysis | **None implemented** | `backend/services/emotion_model.py` (empty stub) | ONNX model file (`models/emotion_cnn.onnx`) exists but unused; `mediapipe`/`torch`/`onnxruntime` unused. |
| RAG / retrieval-augmented coaching | **None implemented** | `backend/services/rag_engine.py` (empty stub) | `chromadb`/`sentence-transformers` unused. |

## Pipeline descriptions

### 1. Batch text chat
```
InputBar -> ConversationPage.handleSend -> messageStore.send()
  [optimistic user bubble shown immediately, guarded against cross-conversation bleed]
  -> POST /conversations/{id}/messages (sync route, runs in FastAPI's threadpool so it
     can't block the event loop / WS path during the blocking LLM call)
  -> turn_service.process_user_turn(defer_title=True): save user Message, build history,
     call llm_service.get_coach_response() (non-streaming), save assistant Message, commit
  -> response returned immediately; if this was the first turn, title generation is
     kicked off as a FastAPI BackgroundTask (generate_title_for_conversation, its own
     DB session) instead of blocking this response on a second LLM call
  -> messageStore reconciles optimistic bubble with real messages
  -> MessageBubble renders with a "write-out" animation for the just-arrived assistant
     reply (animateId prop, ConversationPage tracks the last assistant message id)
```

### 2. Batch full-recording voice message (normal chat mic button, not immersive Voice Mode)
```
mic press -> useAudioRecorder.js: acquireMicStream() (shared, ref-counted — see below)
  -> MediaRecorder(audio-only tracks, timeslice=250ms)
  -> on stop(): releaseMicStream() + full blob assembled + POST /transcribe/ (whisper,
     beam_size=5) for the message text. stop() now returns a Promise that resolves with
     {blob, transcript, duration} only once transcription finishes (no more setTimeout race)
  -> ConversationPage.handleAudioSend: optimistic bubble shown immediately using a local
     blob: URL, THEN uploadAudio() (POST /audio/upload) and sendMessage() run, then
     replaceOptimisticMessages() swaps in the real DB-backed messages
  -> playback via AudioBubble streaming GET /audio/{filename}
```

### 3. Live voice streaming + spoken replies (WebSocket) — used both by the inline mic (VAD-driven) and by full-screen Voice Mode (push-to-talk)
```
useAudioRecorder / VoiceMode's own recorder: MediaRecorder(timeslice=250ms) on the SAME
  shared mic stream; each chunk pushed live over the WS as a binary frame (skipped
  entirely while coachSpeakingRef is true, to avoid feeding the coach's own voice back in)
useVAD.js (@ricky0123/vad-web, client-side) OR push-to-talk button in VoiceMode
  -> {"type":"start_turn"} / {"type":"end_turn"} JSON control frames

Backend WS /ws/conversation/{id} (ws.py):
  -> buffers chunks in session_store.py's SessionState: header_chunk (WebM init segment,
     kept for the whole mic session) + recent_chunks (bounded deque, ~4s trailing window,
     for partials) + full audio_buffer (whole turn, for the final pass)
  -> every ~500ms, if nothing already in flight: greedy (beam_size=1) windowed whisper
     pass over header + recent_chunks -> {"type":"partial_transcript"} (disposable)
  -> on end_turn: accurate (beam_size=5) whisper pass over the FULL turn buffer ->
     final_transcript text is handed straight into the turn pipeline (not sent to the
     client as its own event in the current code — the client already optimistically
     shows its own partial/typed text as the "sent" message)
  -> turn_service.process_user_turn_stream(): saves the user message, then streams LLM
     deltas TRUE token-by-token (see "LLM streaming is now real" below)
  -> tts_service.sentences_from_deltas() buffers deltas into complete sentences (buffering
     word-by-word kills prosody) while being careful not to false-trigger on abbreviations
     ("Dr.", "e.g.") or decimals ("2.5")
  -> each complete sentence is (a) sent immediately as {"type":"assistant_delta"} text AND
     (b) handed to an ordered pipeline: tts_synthesize() (Kokoro) tasks are kicked off
     concurrently (capped at 3 in flight via asyncio.Semaphore) as soon as each sentence is
     ready, queued in ORDER, and a consumer task awaits+sends each one's audio bytes as
     soon as it's ready and its turn comes up. This overlaps LLM generation, TTS synthesis,
     and network send, so the coach can start speaking sentence 1 while sentence 2 is
     still being generated/synthesized.
  -> audio bytes sent as raw binary WS frames; first one flips state to "speaking"
  -> {"type":"assistant_done"} once all sentences are produced and their audio sent;
     state returns to "listening"

Frontend: wsClient auto-detects binary frames from JSON control frames and emits them as
  "audio_frame" events. ConversationPage forwards each into the SINGLETON gapless output
  player (audioEngine.js) instead of the old per-chunk `new Audio()` queue (useTTSPlayer,
  now unused/dead code — see below). The player schedules decoded buffers back-to-back on
  the AudioContext timeline so there's no gap between TTS sentences, and exposes a live
  amplitude analyser that VoiceMode's animated orb reads directly.
```

### 4. Immersive Voice Mode (new: `frontend/src/components/voice/VoiceMode.jsx` + `VoiceOrb.jsx`)
A full-screen takeover (launched from a floating button on `ConversationPage`) with a canvas-rendered animated "blob"/orb (`VoiceOrb.jsx`) that morphs per state (`connecting`/`listening`/`thinking`/`speaking`) and reacts to **real** audio amplitude — mic input level while listening, TTS output level while speaking (both read from `audioEngine.js` analysers, not a fake animation). Supports push-to-talk (hold a button, `start_turn`/`end_turn`), mic mute, and a video-call-style layout that lazily adds a camera track to the same shared `MediaStream` (`micStream.js`'s `enableVideoTrack()`) only when toggled on — voice-only use never prompts for camera access. Reuses the same WS client and output player as `ConversationPage`, so there is exactly one audio path regardless of which UI is driving it.

## Shared infrastructure added

- **`frontend/src/services/micStream.js`** — single ref-counted `getUserMedia` for the whole app. Normal chat's recorder acquires/releases per-turn (mic indicator turns off between turns, as before); `VoiceMode` holds a ref for its whole lifetime so the orb has a continuous analyser without re-prompting. Video is added lazily to the same stream rather than opening a second capture.
- **`frontend/src/services/audioEngine.js`** — one shared `AudioContext`; an input analyser tap for mic level, and a singleton "Tier-B" gapless output player (Web Audio scheduled buffers, not `<audio>` tags) that both `ConversationPage` (feeds it) and `VoiceMode` (observes it for the orb) share.
- **`frontend/src/hooks/useTTSPlayer.js`** — the original "Tier-A" `new Audio()` queue-based player. **Now dead code**: `ConversationPage` was switched to `audioEngine.js`'s gapless player and no longer imports this hook. Worth deleting rather than leaving as an unused parallel implementation.

## Known gaps / not yet correct

- **No server-initiated barge-in.** The frontend has a `stop_audio` WS event handler wired up (`ConversationPage.jsx`, `wsClient.on("stop_audio", ...)` → stops the output player) but **nothing on the backend ever sends `stop_audio`** (`grep` across `backend/` confirms zero occurrences). Combined with the client suppressing outgoing mic chunks entirely while `coachSpeakingRef.current` is true, the user currently *cannot* interrupt the coach mid-reply by speaking — their audio isn't even sent to the server during playback. If interrupt-to-speak is a goal, this needs: server-side detection of an incoming turn during an active TTS stream, an explicit `stop_audio` emission, and the client no longer fully suppressing mic chunks while `speaking`.
- **`useVAD.js` has two competing implementations of the same fallback logic** (tries the new `MicVAD.new()` API, falls back to an older `vad()` function import) inside one `try/catch` — reasonable defensively, but worth confirming which one actually resolves in this project's installed `@ricky0123/vad-web` version so the fallback path isn't silently dead/untested code.
- **`routers/ws.py`'s DB session lifetime**: one `db: Session` (`next(get_db())`) is held open for the entire WebSocket connection, unlike the per-request sessions HTTP routes use. Fine for the current single-worker/SQLite setup; worth revisiting if concurrency issues appear.
- **Windowed transcription tuning is a first pass**: `TRANSCRIPTION_WINDOW_MS=500`, `RECENT_CHUNKS_MAXLEN=16` (~4s), not load-tested against longer utterances or heavier accents.
- **Audio-upload latency still precedes the optimistic bubble in the *batch* voice path only** — actually now fixed for both: `handleAudioSend` shows the optimistic bubble using a local `blob:` URL immediately, before `uploadAudio`/`sendMessage` resolve. (Superseded item from the previous version of this doc — confirmed fixed on reading `ConversationPage.jsx:296-306`.)
- **`useTTSPlayer.js` is dead code** post-switch to `audioEngine.js` — see above; low priority cleanup.

## Resolved since the last update (previously listed as gaps)

- ~~LLM reply isn't actually streaming token-by-token~~ — **Fixed.** `process_user_turn_stream` (`turn_service.py`) now runs the blocking OpenAI-SDK generator on a worker thread and bridges each delta to the event loop via `asyncio.Queue` + `loop.call_soon_threadsafe`, so the first token reaches the client within a few hundred ms instead of after the full reply. The old code's `list(get_coach_response_stream(...))` (which fully buffered the generator before yielding anything) is gone.
- ~~`assistant_message_id` hardcoded placeholder~~ — **Moot.** `assistant_done` no longer carries a `message_id` at all; the frontend just calls `loadMessages()` to refresh from the DB. Simpler, though it does mean a full message-list re-fetch after every voice turn rather than a targeted patch.
- ~~Partial-transcription latency bug (growing buffer, no in-flight guard)~~ — **Fixed** (this was addressed in the previous session and remains in place: bounded `recent_chunks` deque + `transcribing` guard flag).

## Explicitly stubbed / not implemented (pre-existing, unrelated to the streaming/TTS work)

- `backend/services/rag_engine.py` — retrieval-augmented generation (chromadb + sentence-transformers), empty stub
- `backend/services/emotion_model.py`, `audio_features.py`, `nlp_analyzer.py` — emotion/body-language analysis, empty stubs; ONNX model file on disk but unused
- `backend/services/whisper_stt.py` — unused; whisper is called directly from `transcribe.py`/`ws.py` instead
- Webcam frame consumption for body-language analysis — `VoiceMode.jsx` has an explicit `>>> WIRE (later)` comment at the point where webcam frames would need to start streaming out; nothing consumes them yet
- Coaching reports (`_generate_coaching_report()` in `backend/routers/conversations.py`) — placeholder only: counts messages, hardcoded strengths/growth text; not wired to `llm_service` or `rag_engine`

## Suggested next steps, in priority order

1. Decide whether interrupt-to-speak (barge-in) is in scope; if so, wire server-side `stop_audio` emission and stop fully suppressing mic chunks during TTS playback.
2. Delete `useTTSPlayer.js` (dead code) once confirmed nothing still imports it.
3. Load-test windowed transcription tuning (window size, beam size) against realistic speech.
4. Verify which `@ricky0123/vad-web` API path (`MicVAD.new()` vs. legacy `vad()`) is actually active in `useVAD.js` and simplify if the fallback is unreachable.
5. RAG-augmented coaching/reports and emotion/body-language analysis remain the two big unimplemented features from the original project goals.
