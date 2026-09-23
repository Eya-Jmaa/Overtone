# Overtone: Progress & Outstanding Work

Status snapshot as of 2026-07-16. Complements [PIPELINE.md](PIPELINE.md) and [ARCHITECTURE.html](ARCHITECTURE.html) (architecture overviews) — this file tracks what's actually done vs. still stubbed/broken.

> **Read the newest section first.** Entries are append-only and dated; older sections are point-in-time snapshots that have **not** been rewritten. The 2026-07-15 snapshot below is stale on the LLM provider, RAG, and barge-in — see "Stale entries elsewhere in this file" in the 2026-07-16 entry for the specifics.

## Voice-mode latency: measured budget, Whisper small -> base (2026-08-04)

Reported symptom: replies in audio/video mode are slow. Measured the whole
turn on this box (6-core Ryzen 5 5600H, CPU-only torch, 15.4GB RAM with ~4.8GB
free), all models warm:

| Stage | Before | After | Share (before) |
|---|---|---|---|
| **STT (Whisper)** | **6.2s** | **1.9s** | **~70%** |
| RAG retrieval | 0.07s | 0.07s | ~1% |
| LLM -> first sentence | 0.75s | 0.75s | ~8% |
| Kokoro TTS, first sentence | 1.2-2.7s | 1.2-2.7s | ~21% |
| **-> first audio** | **~9s** | **~4s** | |

STT was the bottleneck, not the LLM. Changed `WHISPER_MODEL=small` -> `base`.

**Beware a measurement trap:** timing `get_coach_response_stream()` in a fresh
process reports ~22s for the LLM. That is RAG cold-loading its embedding model
*inside* the call, not the LLM. Warm, it is 0.75s. Always pre-warm
`rag_engine` before timing the LLM.

### Levers that do NOT work (measured — don't retry these)

- **`cpu_threads` on faster-whisper**: 0 -> 6.49s, 6 -> 6.24s, 12 -> **7.05s**.
  No win, and 12 is worse (hyperthread contention). Whisper's encoder runs a
  fixed 30-second mel window regardless of how short the turn is, so the cost
  is encoder-bound and fixed.
- **`beam_size=1`**: 6.75s -> 6.38s. Negligible, same reason.
- **`vad_filter`**: no effect.
- **Kokoro `response_format`**: mp3 median 1.23s vs wav 1.28s over 5 runs —
  noise, not signal. A single-shot comparison misleadingly showed wav ahead.
  Kept mp3 (3x smaller payload).
- **Kokoro streaming**: `stream:true` gives **TTFB 2.36s == full 2.36s** — the
  server synthesizes completely before sending a byte, so wiring up
  incremental playback in the frontend would gain nothing.
- **Kokoro container CPU**: already unlimited (`NanoCpus:0`), not starved.

Net: Kokoro has **no available speed lever** on this setup; model size is the
only thing that moves Whisper.

### Accuracy check on small -> base (with ground truth)

- **English** (`basic_ref_en.wav`, known transcript): `small` and `base`
  produced **identical** output, both matching the truth. No measurable loss.
- **Derja** (`silma_verify.wav`): both are wrong, and wrong in the same way —
  `كيفاش نجم نعاونك` garbles under both (`small`: "كيف يشنزن عنك", `base`:
  "كيف يشنج عنك"); `base` actually gets the hamza right in "أهلا". So the
  earlier "small is a big accuracy jump over base" note does **not** hold for
  Derja — neither is usable, and the fix there is the LinTO Derja STT path
  (`DERJA_STT_BACKEND=vosk`), not a larger Whisper.

Caveat: the Derja sample is synthetic (SILMA's own English-accented output),
not real human Derja. A proper comparison needs real recordings — treat the
Derja row as indicative, not conclusive.

### ⛔ Streaming STT and detect=False: investigated, REJECTED — they hallucinate

Both were evaluated as ways to cut the remaining STT cost. **Do not implement
either.** The measured ceiling is small and the failure mode is severe.

The saving available at `end_turn` on a 5.8s turn is only ~0.96s, and almost
all of it is language detection, not the transcription:

| Path | Time |
|---|---|
| Today (`detect=True`) | 1.97s |
| Minus language detection | 1.11s |
| Whisper on a 1.5s tail only (streaming's best case) | 1.01s |

So the entire commit-as-you-go machinery is worth **+0.10s** over just not
detecting. Whisper pays a fixed ~0.7s encoder pass on *any* call regardless of
tail length, and one final pass is unavoidable unless you truncate the end of
the user's sentence. Confirmed by cost-vs-length: 1s→0.68s, 4s→0.69s,
8s→0.91s, 16s→1.03s — nearly flat.

**Why `detect=False` / pinning is dangerous.** Pinning the language when it
disagrees with the speech does not degrade gracefully — it *invents fluent
text*. On the Derja clip (truth: `أهلا بيك، كيفاش نجم نعاونك اليوم؟`):

- `detect=True` → `أهلا بيك كيف يشنج عنك اليوم` (roughly right)
- pinned to `en` → **"Hello everyone, how are you doing today?"**

Entirely fabricated. This is the *default* path for this product: `lang_default
=en` and `lang_switch_sustain_turns=2`, so the first two Tunisian turns of every
session would be pinned to English. The coach would respond to a sentence the
user never said. `stt_router`'s existing comment already warns against pinning
for a related reason; this is the stronger reason.

**Why short-segment streaming is dangerous.** Whisper is unreliable on short
clips in both directions — it drops speech and it fabricates:

- 0.4s slice → `''`, 0.8s → `''`, 1.5s → `'ايه'` (real speech lost)
- a near-silent 12.7KB turn transcribed as `"You"` (classic artifact)
- a 0.5s clip sent the decoder into a repetition loop: **14.55s** for 0.5s of audio

Committing those incrementally bakes both failure modes into the final
transcript, which then feeds the LLM.

If STT latency must come down further, the honest options are a genuinely
streaming ASR (`linto_stt.LintoStreamingSession` already exposes
`accept_chunk()`/`partial()`/`final()` and is built for this, Derja-only), or
a GPU — not slicing Whisper into pieces it wasn't designed for.

Note the live `partial_transcript` loop in `handle_audio_chunk` is unaffected
and stays: those partials are disposable UI feedback, never committed to the
final transcript, which is exactly why they are safe.

## Derja TTS: EMA-stripped checkpoint + English reference clip (2026-08-04)

The `Eya-Jmaa/silma-tts-derja` checkpoint was re-uploaded upstream with
the EMA weights stripped, and a reference voice was finally settled on. Both
changes are now live; the local SILMA path loads and synthesizes end-to-end.

**Checkpoint.** `model.pt` went from ~2.6GB to **650,797,997 bytes** and now
contains exactly one top-level key, `model_state_dict` (308 tensors) — no
`ema_model_state_dict`. Verified by loading it directly. The old cached copy
was deleted and re-downloaded from scratch.

**`use_ema=False` is now mandatory, not a preference.** `_load_silma_model()`
passed `use_ema=True` (positionally, as the 7th arg to
`f5_tts.infer.utils_infer.load_model`); against the new checkpoint that reads
a key that no longer exists and fails the load. Now passed explicitly as a
keyword, along with the other tail args, so it can't silently shift position
again. `tts.use_ema` was set to match. This is the **only** place in the repo
that loads this checkpoint — confirmed by sweeping every `torch.load` /
`load_model(` call site; the other hits are the emotion model and the
unrelated `training/` scripts.

**Reference voice: F5-TTS's bundled ENGLISH clip.** F5-TTS is a voice-cloning
model with no default speaker, so this was the open blocker from the
2026-08-03 entry. The clip that won is `basic_ref_en.wav` from the installed
package's own examples, copied into `backend/data/tts_reference/` (256KB, NOT
gitignored, so it travels with the repo — it is not fetched from HF and must
physically exist on the deploy target). `SILMA_REF_TEXT` is its exact
transcript, "Some call me nature, others call me mother nature."

> ⚠️ **Known tradeoff, needs a product decision — do not "fix" in code.**
> The reference clip is English, so the coach's Derja carries an English
> accent and English prosody. This was chosen deliberately: every Tunisian
> Arabic candidate tried (raw dataset scans, voice-converted clips, denoised
> clips) sounded worse than the English reference, so intelligibility and
> stability beat accent authenticity. Resolving it properly means sourcing a
> clean single-speaker Tunisian clip of comparable recording quality — a
> content problem, not an engineering one. Flagged as a `TODO(product
> decision, not a bug)` in `services/tts_service.py`.

### Bugs found and fixed along the way

- **Concurrent model warmups raced on `torchvision`'s import.** `main.py`'s
  lifespan started a thread per model. Module import is not atomic, so the
  SILMA thread got a half-initialized `torchvision.transforms` while
  `face_analyzer` (EmotiEffLib) was importing it — `cannot import name
  'InterpolationMode' from partially initialized module`. **Deterministic,
  reproduced on every boot**, not a flake. It also outlived boot: `tts_service`
  latches its load failure and never retries, so losing this race meant no
  Arabic audio for the entire process lifetime *even though the checkpoint was
  fine*. The warmups now run sequentially on one shared thread — sum of load
  times instead of max, still entirely off the request path. Pre-existing; it
  was invisible before only because local SILMA had never been switched on.
- **`setup_silma_tts.py` couldn't be re-run.** Two problems: the
  "already downloaded" test was a hardcoded `> 2.5GB` floor, which the new
  650MB checkpoint fails *and* which would have kept a superseded file
  forever; and resuming a file that is already complete sends a Range at EOF,
  which HF answers with **416**, crashing the script (the old comment claimed
  this was a harmless no-op — it isn't). Now compares against upstream
  `content-length`, deletes a larger-than-upstream stale file rather than
  appending to (and corrupting) it, and treats 416 as "nothing to resume".
  Re-running is now a clean no-op.
- **`verify_silma_tts.py` crashed printing its own input** — Windows consoles
  are cp1252 and cannot encode Arabic, so a script whose entire purpose is
  Arabic synthesis died on `UnicodeEncodeError` before loading anything. Now
  forces UTF-8 on its own stdout/stderr.
- **`verify_silma_tts.py` must run from the repo root**, not `backend/` — its
  docstring said either. `SILMA_MODEL_DIR` defaults to the root-relative
  `backend/models/silma-tts-derja`, which is also how the server resolves it
  (`uvicorn --app-dir backend` from the root), so running from `backend/`
  looks for `backend/backend/...` and fails with a misleading "config.yaml
  missing — run setup_silma_tts.py first". Docstring corrected.

### Verification performed

- **Checkpoint keys** — loaded `model.pt` directly: `['model_state_dict']`
  only, 308 tensors, `ema_model_state_dict` absent. Confirms `use_ema=True`
  would now throw.
- **`setup_silma_tts.py`** — full re-download to a byte-exact match with
  upstream `content-length` (650,797,997), then re-run to confirm it exits 0
  as a no-op.
- **`verify_silma_tts.py`** — loaded config/vocab/checkpoint + vocoder and
  synthesized a Derja sentence end-to-end, cloning the English reference.
  105s for one batch on CPU (expected for F5-TTS diffusion). Output checked
  as real audio, not a valid-header-with-silence: **5.80s, 24kHz, peak 1.00,
  RMS 0.132, 89.9% of samples non-silent** →
  `backend/data/debug_audio/silma_verify.wav`.
- **Startup preload** — `warmup_silma_local()` (the exact function `main.py`'s
  lifespan calls) run with logging raised: model loaded, `_silma_load_error`
  is `None`, `use_ema` is `False`. On the live server the load is silent
  because `tts_service` logs success at `log.info` on the `coach.tts` logger,
  which the default root level (WARNING) drops — unlike `rag_engine`/
  `face_analyzer`, which `print()`. Failures *do* surface (they log at ERROR,
  which is how the torchvision race above was caught), and the running process
  shows no error with 2.4GB RSS.

### ⛔ Local SILMA is not viable for LIVE turns on this machine

Reported symptom: speaking Tunisian in a live session produced no audio at
all. Two separate causes, one fixed, one not fixable in code.

**Fixed — the warmup latch swallowed every turn during the load.**
`_ensure_silma_loaded()` set a single `_silma_load_attempted` flag *before*
running the load, so for the entire time the startup warmup was loading, every
turn took the "already attempted" branch and got `None` — no audio, nothing
logged, indistinguishable from a permanent failure. Startup is precisely when
someone is most likely to start a session, so this was the common path. "Load
in flight" and "load already failed" are now tracked separately: a turn
arriving mid-load still returns immediately (blocking a turn for minutes would
be worse) but says so in the log, and the next turn succeeds once the load
lands. Genuine failures are still latched, which is what the flag was for.

**Not fixable here — CPU synthesis is ~2 orders of magnitude too slow.**
Measured on this box, model already loaded:

| Text | Latency |
|---|---|
| `أهلا بيك.` (9 chars) | **88.2s** |
| `شنوة أحوالك اليوم؟` (18 chars) | **115.6s** |
| 48-char sentence | **193.3s** |

Plus ~51s one-time model load. A normal 2-3 sentence coaching reply is
therefore **5+ minutes** of synthesis, streamed sentence-by-sentence — the
turn is abandoned or barge-in cancels it long before any audio arrives. This
is not a bug to fix: `torch` here is a **CPU-only build (2.12.1+cpu)** and the
GPU is **AMD Radeon integrated** — `torch.cuda.is_available()` is `False` and
there is no CUDA device to switch to, so `_load_silma_model()`'s
`cuda if available else cpu` correctly picks CPU. F5-TTS is a diffusion model
with an ODE sampler; this is simply what it costs without a GPU.

Options, in the order they're worth considering:
1. **Run SILMA on a GPU host behind the existing `http` seam** —
   `SILMA_PROVIDER=http` + `SILMA_BASE_URL`. That path already exists and is
   untouched; it is what the seam was designed for.
2. **Leave `SILMA_PROVIDER` empty for live sessions** — Arabic stays
   text-only, exactly as before this work. The local path still verifies fine
   offline via `verify_silma_tts.py`.
3. **A faster Arabic TTS** for the realtime path.

Note the local checkpoint work is *not* wasted under any of these — it is the
same model/reference config, just executed somewhere with a GPU.

### Still open

- **Which of the three options above to take** — needs a decision; not made
  here, since `SILMA_PROVIDER=local` was set as requested.
- **The English accent on Derja output** — see the tradeoff callout above.
  Product decision.
- **First Tunisian turn still speaks English.** `lang_default=en` and
  `lang_switch_sustain_turns=2`, so `active_language` only flips to `ar` after
  two consecutive Arabic-dominant turns. Working as designed (the hysteresis
  is deliberate), but it means turn 1 of an Arabic session uses the English
  voice — worth confirming that's the intended UX.
- **Not judged by ear.** The output is confirmed to be real, non-silent 24kHz
  audio, but whether it is *intelligible Derja* is not something this session
  can assess — listen to `silma_verify.wav`.
- **Unrelated: the emotion checkpoint doesn't load on the server.**
  `EMOTION_MODEL_PATH=models/emotion_xlsr/xlsr_best.pt` is backend-relative,
  but the server runs from the repo root, so startup logs `[emotion]
  checkpoint not found`. Same root-vs-backend relative-path inconsistency
  described above for `SILMA_MODEL_DIR`. Pre-existing, untouched here.

## Custom speech-emotion + Derja TTS models integrated (2026-08-03)

Replaces the two remaining empty stubs — `emotion_model.py` and (the Arabic
half of) `tts_service.py`/`tts_router.py` — with two custom Hugging Face
models the project owner trained and published: `Eya-Jmaa/emotions_speech`
(speech emotion recognition) and `Eya-Jmaa/silma-tts-derja` (Tunisian
Derja TTS). **Both off by default** — no behavior change until
`EMOTION_PROVIDER=xlsr` / `SILMA_PROVIDER=local` are set and their setup
scripts have been run; existing callers (there were none for emotion; Kokoro
en/fr is untouched for TTS) see zero change otherwise.

### Reality check against the brief

The task described the *planned* placeholders, not what was actually in the
repo — worth recording since it means some brief assumptions didn't hold:
- `emotion_model.py` was **empty** (0 bytes), not "a ResNet18 ONNX model
  fine-tuned on RAVDESS/SAVEE/TESS". The actual reference-only training
  script (`backend/training/train_ravdess_emotion.py`) uses an
  EfficientNet-B2 + Wav2Vec2-base ensemble, and nothing in the live app calls
  it — `fusion.py`'s own docstring already said as much. There was no
  existing function signature to preserve, so a new one was designed:
  `analyze_emotion(audio, sr=16000) -> dict | None`.
- `tts_service.py` is Kokoro-82M (OpenAI-compatible local server), not
  Edge-TTS — `edge-tts` sits unused in `requirements.txt` (pre-existing, not
  touched here). `tts_router.py`'s `SilmaEngine` already anticipated an
  Arabic/Derja engine as a documented seam (same pattern as
  `stt_router.DerjaEngine`), so that's what got filled in.

### Emotion model (`Eya-Jmaa/emotions_speech`)

Model repo (weights only, no Space), public, no gating. Two files: `xlsr_best.pt`
(1.26GB, PyTorch checkpoint — this is the one actually used) and
`xlsr_emotion.onnx` (2.9MB). **The ONNX file is broken as published** — its
graph references external weight data (`xlsr_emotion.onnx.data`) that was
never uploaded to the repo (confirmed via `HfApi.repo_info(files_metadata=True)`:
only 5 files exist, no `.data` file). Loading it raises immediately.

`config.json` documents only I/O shape (7 classes, 16kHz, pad/crop to 4.0s,
backbone `facebook/wav2vec2-large-xlsr-53`) — not the classifier head. Rather
than guess, the head was **reverse-engineered from the broken ONNX file's own
graph structure**, which is fully readable without its missing weight data
(`onnx.load(path, load_external_data=False)` — node names, shapes, and the op
graph are separate from tensor values). This recovered the exact forward pass:
raw waveform → `Wav2Vec2Model` (24 layers, hidden=1024) with
`output_hidden_states=True` → a **learned per-layer weighted sum over all 25
hidden states** (not just the last layer — a SUPERB-style probe; confirmed via
the graph's `Concat`→`Mul`→`ReduceSum` nodes, weights applied raw with no
Softmax) → mean-pool over time → `LayerNorm(1024)→Linear(1024,384)→GELU→
LayerNorm(384)→Linear(384,128)→GELU→LayerNorm(128)` head, **plus** a separate
`proj_skip: Linear(1024,128)` applied to the same pooled vector and added in
before a final `Linear(128,7)` classifier (residual skip, not part of the
head `Sequential`). Reconstructed in `services/emotion_model.py`, then
verified by loading the real `xlsr_best.pt` into it:
**`load_state_dict` → 0 missing, 0 unexpected keys** — an exact match.

7 output classes: `neutral, happy, sad, angry, fearful, disgust, surprised`.
**No "calm" class** — the brief's originally-planned 8-class RAVDESS scheme
doesn't apply here. Nothing in the app currently consumes an 8-class scheme
(there was no caller at all), so no mapping layer was added; flag this if an
8-class UI/report field expecting "calm" gets built later.

Preprocessing matches the repo owner's own RAVDESS training script
(`training/emotion_model_service.py`/`train_ravdess_emotion.py`): raw
`librosa`-loaded float32 waveform straight into `Wav2Vec2Model`, **no**
`Wav2Vec2FeatureExtractor` normalization step. This is an assumption carried
over from that reference code, not independently re-derived — worth
confirming if predictions look off on real speech.

The checkpoint is downloaded once to a **local path**
(`EMOTION_MODEL_PATH`, default `backend/models/emotion_xlsr/xlsr_best.pt`) by
`backend/scripts/setup_emotion_model.py`, not fetched live via
`huggingface_hub` at request time — that downloader stalled twice (silently
stuck, no error) on this ~1.26GB file during development, and once dropped
the connection outright at 795MB (`IncompleteRead`). A plain
`requests.get(stream=True)` with `Range`-header resume (matching
`setup_linto_model.py`'s existing pattern) completed reliably both times.
Loaded lazily (or via `emotion_model.warmup()` in `main.py`'s lifespan hook,
same pattern as `rag_engine`/`face_analyzer`); load/inference failures are
caught and logged, `analyze_emotion()` returns `None` — fails open, never
crashes a turn, matching `fusion.py`'s honesty rule.

### Derja TTS (`Eya-Jmaa/silma-tts-derja`)

Model repo (weights only), public, no gating. Apache-2.0 base model +
CC BY 4.0 training data (LinTO Tunisian Audio Dataset — attribution required,
see the repo's model card). Fine-tune of SILMA TTS (F5-TTS v1.1.7 / DiT
architecture, `vocos` vocoder, 24kHz) on Tunisian Derja with Arabic/French
code-switching. Files: `model.pt` (2.6GB — **superseded, see the 2026-08-04
entry: the checkpoint was re-uploaded EMA-stripped at ~650MB**), `vocab.txt`
(char-level, one token per line), `config.yaml` (the exact Hydra training config — `dim=768,
depth=18, heads=12`, name `SilmaTTS_V1_Small` — **not** the same architecture
as any of F5-TTS's bundled presets, e.g. `F5TTS_v1_Base` is `dim=1024,
depth=22`).

**This is a voice-CLONING model, not a fixed-speaker one** — a real
architectural fact, not a config choice. Every synthesis call needs a
reference audio clip + that clip's exact transcript
(`SILMA_REF_AUDIO_PATH` / `SILMA_REF_TEXT`) to clone the voice from; there is
no default speaker. `SilmaEngine.synthesize()` returns no audio (logged
reason) until both are set — same fail-open contract as the rest of
`tts_router.py`.

Chose **local in-process inference** (`SILMA_PROVIDER=local`) per the brief's
default, implemented via the `f5-tts` PyPI package (matches "F5-TTS v1.1.7"
in the model card; confirmed on PyPI up to 1.1.22). The existing
`SilmaEngine` seam assumed an OpenAI-compatible HTTP server
(`SILMA_PROVIDER=http`, `settings.silma_base_url`) — that path is **kept
as-is, unchanged**, for anyone already running SILMA that way; `local` is
additive.

`f5-tts`'s own `F5TTS` class (`f5_tts.api`) turned out **not** to accept a
custom architecture directly — its `__init__` only takes a bundled preset
**name** (`OmegaConf.load(f5_tts/configs/{model}.yaml)`, a package-relative
lookup), so `F5TTS(model="F5TTS_v1_Base", ckpt_file=..., vocab_file=...)`
would silently build the wrong-shaped DiT network for our checkpoint. Found
this by reading the installed package's actual source
(`venv/Lib/site-packages/f5_tts/api.py`) after `inspect.signature()` alone
didn't reveal it. Worked around it in `tts_service._load_silma_model()` by
constructing `F5TTS` via `__new__` (skipping `__init__` entirely) and setting
the same attributes `__init__` would have, using
`f5_tts.infer.utils_infer.load_model`/`load_vocoder` directly against *our*
`config.yaml` — reuses `F5TTS.infer()`'s vetted logic (ref-audio
preprocessing, seeding, the actual diffusion call) unchanged.

`f5-tts` is a heavy dependency for what's needed here — its own requirements
pull in `gradio`, `wandb`, `bitsandbytes`, `datasets`, `google-cloud-storage`,
etc. (a research/demo repo, not a lean inference package). Noted in
`requirements.txt`; a from-scratch DiT+vocos inference implementation would
avoid this but is a substantially larger undertaking (F5-TTS is a
diffusion/flow-matching model with an ODE sampler, not a simple feedforward
classifier like the emotion model), not attempted here.

**Also required: FFmpeg, and specifically the *shared*-library Windows
build.** `torchaudio`'s audio loading path uses `torchcodec`, which needs
FFmpeg's shared `avcodec-*.dll`/`avformat-*.dll` etc. on `PATH` — the common
`winget install Gyan.FFmpeg` package installs the *static* full build (single
`ffmpeg.exe`, no DLLs), which does **not** satisfy this; `torchcodec`'s own
error message says so explicitly ("ensure you've installed the
'full-shared' version"). Needed the separate
`ffmpeg-release-full-shared` archive from gyan.dev. This isn't wired into any
install script (system dependency, not a pip package) — document it for
whoever deploys this.

Same local-path pattern as the emotion model: `SILMA_MODEL_DIR` (default
`backend/models/silma-tts-derja`), populated once by
`backend/scripts/setup_silma_tts.py` (same resumable-download approach — the
2.6GB `model.pt` also dropped its connection once mid-transfer; resume
picked it up).

### Verification performed

- `backend/scripts/verify_emotion_model.py`: loaded the real 1.26GB
  checkpoint into the reconstructed architecture —
  **`load_state_dict`: 0 missing, 0 unexpected keys**. Ran a synthetic test
  tone through the full forward pass (model load → preprocess → inference →
  softmax) with no errors; the tone's predicted label is meaningless
  (acknowledged in the script's own output) — a real speech clip is needed
  for an actual accuracy check, not attempted here.
- `backend/scripts/verify_silma_tts.py`: generated a synthetic English
  reference clip via Windows' built-in SAPI (`System.Speech.Synthesis`, no
  repo asset was available and none was available to record) and cloned it
  to synthesize a Derja sentence end-to-end — config/vocab/checkpoint
  loading, vocoder loading, reference-audio preprocessing, and diffusion
  sampling (77.6s for one batch on CPU, as expected for F5-TTS) all
  succeeded, producing a valid 3.38s/24kHz/non-silent WAV. **Sent to the
  user to judge intelligibility** — a synthetic English voice cloned into
  Derja speech is not something this session can judge by ear, and the
  reference clip's language/register doesn't match real deployment use
  (a real coach-voice reference clip is still needed before this is
  production-ready).

### Not done / needs the user's input

- **A real reference voice clip.** `SILMA_REF_AUDIO_PATH`/`SILMA_REF_TEXT`
  must point to a clean few-second recording of the actual desired coach
  voice + its exact transcript before this is usable for real sessions — the
  synthetic SAPI clip above was for pipeline verification only.
  *(Partly resolved in the 2026-08-04 entry — a real clip is now configured,
  but it is F5-TTS's bundled **English** sample, so the accent question is
  still open.)*
- **Emotion model accuracy on real speech** — only a synthetic tone was
  tested (see above); real-speech validation and the missing "calm" class
  are both worth a second look once this is wired into the live pipeline.
- **Not wired into `routers/ws.py`/`fusion.py`** — per the brief, this pass
  stops at standalone verification; live wiring (calling `analyze_emotion()`
  per turn, feeding it into `fusion.voice_signal()`) is a follow-up.
- Neither provider is wired into a Docker/deployment image — both need their
  setup script run manually once per environment (matching
  `setup_linto_model.py`'s existing convention), and SILMA additionally needs
  the FFmpeg shared build on the deploy target.

## Tunisian Derja STT: LinTO/Vosk engine wired behind the existing seam (2026-07-28)

Implements the `"vosk"` backend that `stt_router.DerjaEngine` already anticipated (its docstring called it out as a seam, `available()` already checked for the package + model path). **Off by default** — no behavior change until `DERJA_STT_BACKEND=vosk` is set and the model is downloaded; Arabic sessions keep using Whisper-pinned-"ar" until then.

- **`backend/services/linto_stt.py`** (new): loads `linagora/linto-asr-ar-tn-0.1` (Kaldi TDNN + bundled Tunisian code-switching LM, packaged for Vosk) as a lazy, process-wide `vosk.Model` singleton — same pattern as `routers/transcribe.py`'s `WhisperModel`. `_decode_to_pcm16()` converts the incoming webm/opus blob to 16kHz mono PCM16 via `librosa.load()` (same decode call already used in `training/emotion_model_service.py`, so no new decode dependency). `LintoStreamingSession` wraps one `KaldiRecognizer` per utterance — never shared across turns/sessions — exposing `accept_chunk()`/`partial()`/`final()` so a truly incremental caller can drive it directly later. `transcribe()` is the turn-level wrapper `stt_router` actually calls today: it still drives the recognizer through `AcceptWaveform()` in ~4000-byte chunks internally, it just receives the whole turn's audio at once because that's what `ws.py` currently buffers (nothing changed there — this is additive only). CPU only, no CUDA; runs on the `vosk-model.zip` variant (not `android-model.zip`, which is only relevant for on-device inference).
- **`backend/services/stt_router.py`**: `DerjaEngine.transcribe()` now delegates to `linto_stt.transcribe()` when `settings.derja_stt_backend == "vosk"`, instead of always raising `NotImplementedError`. `whisper_ft` (a fine-tuned Whisper checkpoint) is still the unimplemented half of the seam.
- **`backend/scripts/setup_linto_model.py`** (new, standalone): downloads and unpacks `vosk-model.zip` + the model card's `sample.wav` from Hugging Face into `backend/models/linto-asr-ar-tn/` (gitignored — weights aren't committed, matching how Kokoro's Docker image and Whisper's HF cache are also not committed). Not run automatically; a one-time manual step, printed at the end with the exact `.env` values to set.
- **`backend/scripts/linto_sanity_check.py`** (new, standalone): loads the model directly (no app config/router involved) and transcribes a WAV clip, printing the raw transcript for a manual/visual check that Derja output follows the project's mixed Arabic-script + inline-French-Latin-script convention (not something a test can assert).
- **Tests** (`backend/tests/test_linto_stt.py`, `backend/tests/test_stt_router_dispatch.py`): stdlib `unittest`, matching `test_language_resolver.py`'s no-test-dependency convention. `vosk` itself is faked (a stand-in module implementing `Model`/`KaldiRecognizer`/`Result`/`FinalResult`) so these run without the real package or the ~1GB model on disk; they check shape/plumbing (decode produces valid PCM16, `transcribe()` returns the same `TranscriptionResult` fields `WhisperEngine` does, each call gets its own recognizer), never transcript content. Dispatch tests use fake `STTEngine`s to confirm `active_language="ar"` routes to `derja` and `en`/`fr` route to `faster-whisper`, including the fallback-to-Whisper path when Derja is unavailable or throws. All 28 tests (18 pre-existing + 10 new) pass via `venv/Scripts/python.exe -m unittest discover -s tests -v`.
- **Dependency/config**: added `vosk` to `requirements.txt`; documented `DERJA_STT_BACKEND`/`DERJA_STT_MODEL_PATH` in `.env.example` (previously undocumented there despite existing in `config.py`); added `backend/models/linto-asr-ar-tn/` to `.gitignore`.
- **Attribution**: `linagora/linto-asr-ar-tn-0.1` is CC BY 4.0 (arxiv:2504.02604) — cited in `linto_stt.py`'s module docstring and `setup_linto_model.py`. No existing NOTICE/CREDITS file was found anywhere in the repo to add a citation to; this is the first one.
- **Not done, out of scope for this pass**: no true incremental (chunk-by-chunk) wiring into `ws.py`'s live turn loop — it still buffers a whole turn's webm before calling `transcribe_turn()` once, for both Whisper and Derja. `LintoStreamingSession` is built so that wiring is a small follow-up (feed `accept_chunk()` as WS frames arrive) rather than a rewrite, but doing it wasn't requested here and touching the live audio path deserves its own verification pass.

## Voice/video entry, VoiceMode exit, code input, architecture doc (2026-07-16)

Four UI/docs changes. No backend or protocol changes — the WS contract, turn pipeline, and audio paths are untouched.

### 1. Start a voice or video conversation without sending a text message first

Previously the only way into `VoiceMode` was the floating button on `ConversationPage`, which required an existing conversation — so a live session always started with a typed (or spoken-then-transcribed) first message. Now `NewConversationPage` has an **"or talk instead"** section with two buttons: *Start voice conversation* and *Start video conversation*.

- `handleStartLive(withVideo)` (`pages/NewConversationPage.jsx`) creates the conversation with the inline-selected mode, then navigates with router state `{ startLive: { video } }`. It reuses the same `createdConvRef` guard as `handleSend`, so a failed attempt doesn't orphan an empty conversation on retry.
- It calls `getAudioContext()` **inside the click**, because that's the user gesture that unlocks audio output — the navigation that follows is not one.
- `ConversationPage` consumes `location.state.startLive` in a dedicated effect (guarded by `startLiveHandledForRef` per conversation id), raises `VoiceMode`, and strips the state via `navigate(replace: true)` so a refresh or back-nav doesn't silently re-enter the takeover.
- `VoiceMode` gained an `autoVideo` prop. Turning the camera on is gated on `micStatus === 'ready'` — **not** mount — because `micStream.enableVideoTrack()` adds its track to the shared mic stream and returns `null` if that stream doesn't exist yet.

No greeting is needed to open the turn pipeline: the server sends `state: listening` on connect and only needs `start_turn`, so push-to-talk works on an empty conversation. The user simply speaks first (confirmed against `ws.py` — there is no server-initiated greeting on connect).

### 2. VoiceMode exit: a back button alongside the hangup

`VoiceMode` previously exited only via the red hangup button in the control pill (or Esc), which is easy to misread as "mute" and easy to hit by accident. Added a discreet **"← Back to chat"** at top-left; the red button stays as the deliberate **"End session"**.

> Both currently call the same `endSession()` teardown — the distinction is framing, not behaviour, because there is no server-side session-end concept yet (`ConvTopbar`'s `onEndSession` is still a `console.log` stub). If "end session" should do something distinct — e.g. `POST /conversations/{id}/end` and route to the report — that's a real difference worth wiring, and the button is now the obvious place for it.

### 3. Verification code input restyled (`components/auth/CodeInput.jsx`)

Kept the six-box layout; restyled it. Boxes are now 52×62 with a 12px radius and 26px monospace digits (was a cramped `aspectRatio: 1` grid), split **3 + 3** by a small separator so the code chunks the way it's read aloud. Added a caret hint on the next empty box, `autoComplete="one-time-code"` for OS autofill, per-box `aria-label`s, and a `role="alert"` error line with an icon.

**Notable change beyond styling:** focus state moved from imperative `onFocus`/`onBlur` writes to `el.style` into React state (`focusedIdx`). The caret hint makes the box's `border` change on every keystroke, so a re-render rewrites the `border` shorthand — which would fight inline styles set behind React's back. One source of truth avoids that class of bug entirely.

### 4. `ARCHITECTURE.html` (new, repo root)

A self-contained, themed explanation of the pipelines and every file's role: system map, auth, text turn, live voice turn (with the full WS frame table), RAG grounding, streaming TTS, and the offline KB build — plus file-role tables for backend and frontend and an honest "what is not wired yet" section. No external requests; verified for anchor integrity and no horizontal overflow at 375px and desktop.

### Verification performed

Frontend `npm run build` passes (the one warning, `authApi.register` undefined in `authStore.js`, is pre-existing and unrelated). `CodeInput` and `VoiceMode` were each mounted in a temporary scratch page against the real Vite dev server and inspected via the DOM: all three code-input states render correctly, typing advances focus, and `VoiceMode` renders both exits with "Back to chat" at top-left firing `onEnd`. **Not verified:** focus-ring appearance (the headless preview pane never fires focus events — `document.hasFocus()` is `false`), and the end-to-end live-session launch, which needs login + a running backend.

### Stale entries elsewhere in this file

Noticed while reading the code for the architecture doc; **not** corrected in place, flagged here. The snapshot below predates commits `a0fabc0`, `b4b677b`, and `1d96524`:

- The **models table** lists coaching replies as `hosted_vllm/Llama-3.1-70B-Instruct` via Esprit's Token Factory. `llm_service.py` now uses **Google Gemini** (`gemini-2.5-flash`) via the `google-genai` SDK.
- **`rag_engine.py` is listed as an empty stub** in both the models table and "Explicitly stubbed". It is now implemented (166 lines): a 603-chunk `coaching_kb` Chroma collection with `intfloat/multilingual-e5-base`, mode-filtered top-4 retrieval, injected by `llm_service._grounded_system_instruction()`, failing open.
- **"No server-initiated barge-in"** under "Known gaps" is fixed: `ws.py` has `send_stop_audio()` and `cancel_active_turn()`, and `start_turn` cancels an in-flight turn and notifies the client.
- `emotion_model.py`, `audio_features.py`, `nlp_analyzer.py`, `whisper_stt.py`, `routers/sessions.py` — **still genuinely empty (0 bytes)**, as described.

Also still live: the `TEMP` diagnostics in `ws.py` write every turn's raw audio to `backend/data/debug_audio/last_turn.webm` (untracked, and a file write on every single turn) and log buffer details on each `end_turn`; `VoiceMode.jsx` logs the captured audio track. Both are marked for removal in the source.

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
