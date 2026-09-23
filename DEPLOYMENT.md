# Deploying Overtone (AI-Coach) — production + hardening guide

Repository: https://github.com/Eya-Jmaa/Overtone

Target shape: **one container** holding the whole FastAPI backend and all in-process
models, on a host with real RAM. Frontend static on Vercel. Public signup.

Why not the "thin backend + GPU endpoint" split: `main.py` warms Whisper, ChromaDB +
sentence-transformers, MediaPipe/OpenCV face analysis, the ONNX expression model and
SILMA TTS *in-process* (`main.py:41-48`). There is no HTTP seam to extract. Splitting
them is a multi-day refactor of `stt_router.py`, `emotion_model.py`, `face_analyzer.py`
and it adds serverless cold starts to every voice turn. Do it later if traffic ever
justifies it.

Budget: **~$15-25/mo** (host) + Gemini usage + $0 for Supabase/Upstash/Vercel/Cloudflare
free tiers.

---

## Part 0 — Fix these before you expose anything

These are real findings in the current code, not generic advice. Ordered by how badly
they bite on a public URL.

### 0.1 — Cookies are sent insecure and will break cross-site

`backend/routers/auth.py:33-42` and again at `:340-348` set `secure=False`. Over HTTPS
with the frontend on `app.yourdomain.com` and the API on `api.yourdomain.com`, the
browser will simply **drop** the refresh cookie — `samesite="lax"` does not send on a
cross-site XHR. Your refresh flow will silently fail in production.

Add to `config.py`:

```python
    cookie_secure: bool = True
    cookie_samesite: str = "none"   # "lax" only works if API and app share a site
    cookie_domain: str = ""         # e.g. ".yourdomain.com"
```

Then in `auth.py`, replace both hardcoded cookie blocks with one helper that reads
those settings. Locally you set `COOKIE_SECURE=false` / `COOKIE_SAMESITE=lax` in `.env`;
production keeps the defaults. Note `samesite="none"` **requires** `secure=True` — the
browser rejects the pair otherwise.

Also duplicate `_set_refresh_cookie` into the Google callback instead of re-writing the
cookie by hand at `:340`; two copies of this logic is how one of them stays wrong.

### 0.2 — `/auth/send-code` is an open email relay

`auth.py:121-161` sends a real Gmail SMTP message to any address posted to it, with no
rate limit and no captcha. On a public URL this gets your Gmail account suspended within
hours, and makes you a spam vector. **Highest-priority fix.** See Part 3.

### 0.3 — `/auth/login` has no brute-force protection

`auth.py:221-226`. Unlimited password guesses per account. `verify-code` correctly caps
at 5 attempts (`MAX_CODE_ATTEMPTS`), but login has nothing.

### 0.4 — Uploads are unbounded and read fully into memory

`routers/transcribe.py:50-52` and `routers/audio.py:50-52` both do `await audio.read()`
with no size check, then hand the result to Whisper. A single 500 MB POST is an OOM;
a few concurrent ones are a free CPU-exhaustion DoS, since Whisper decoding is
unbounded work per request. Content-type is checked, but content-type is client-supplied
and proves nothing.

### 0.5 — The WebSocket audio buffer is unbounded

`routers/ws.py:203`: `session_state.audio_buffer += chunk`, with no cap and no per-user
connection limit. One authenticated client streaming garbage bytes fills the process
heap. There is also no cap on turns per conversation, so a scripted loop can run your
Gemini key dry. Cap all three.

### 0.6 — Every user's audio is written to disk on every turn

`routers/ws.py:750-756` unconditionally writes each turn to
`backend/data/debug_audio/last_turn.webm`. That is debug scaffolding: it fills the disk
and stores user voice recordings you did not tell them you were keeping. Gate it behind
a `DEBUG_SAVE_AUDIO=false` setting, defaulting off.

### 0.7 — `/audio/{filename}` serves recordings with no authentication

`routers/audio.py:73-83` has a path-traversal guard but **no `Depends(get_current_user)`**
and no ownership check. Anyone holding a URL — or crawling one out of a browser history,
a proxy log, or a shared screenshot — gets another user's recording. UUID filenames are
obscurity, not access control. Add auth plus a check that the file belongs to a
conversation owned by the caller.

### 0.8 — Interactive API docs are public

`main.py:52` leaves `/docs`, `/redoc` and `/openapi.json` open, publishing your full
route surface to anyone. In production:

```python
_is_prod = settings.environment == "production"
app = FastAPI(
    title="Overtone",
    lifespan=lifespan,
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
)
```

### 0.9 — Refresh tokens cannot be revoked

`services/security.py:33-39` mints stateless refresh JWTs; `auth.py:250-253` "logout"
only clears the cookie. A stolen refresh token stays valid for the full
`REFRESH_TOKEN_DAYS=7`, and you have no way to kill it. Add a `jti` claim and a Redis
denylist keyed on it (you are adding Redis anyway).

### 0.10 — SQLite will lose your data on every deploy

`config.py:25` defaults to `sqlite:///./ai_coach.db`, and `database.py:7-18` tunes it
with WAL. Container filesystems are ephemeral: every redeploy wipes all users and
conversations. Move to Postgres (Part 2). Keep the SQLite branch — it is what makes local
dev pleasant — the code already switches on `_is_sqlite`.

### 0.11 — Only one instance can ever run

`services/session_store.py:39-62` is a process-local dict keyed by connection id. Two
instances behind a load balancer means a user's WebSocket state lives on whichever box
they landed on. That is acceptable for now — just **pin the host to a single instance**
and know that this is the ceiling. Moving `SessionState` to Redis is not straightforward
(it holds live `asyncio.Task` and `FaceAnalyzer` objects, which do not serialize).

### 0.12 — Smaller things worth doing in the same pass

- `auth.py:104-105`: `Annotated[str, Header()]` is required, so a *missing*
  `Authorization` header returns **422**, not 401. Make it `str | None = None` and raise
  401 yourself.
- `ws.py:103`: the JWT rides in the query string (`?token=`), which lands in access logs
  and proxy logs. The 15-minute access-token lifetime limits the damage; make sure
  Cloudflare and your host are not logging full query strings.
- `backend/data/chroma_db/*.bin` are **tracked in git** despite being in `.gitignore`
  (they were committed before the ignore rule). Run `git rm -r --cached
  backend/data/chroma_db` so they stop producing binary diffs on every index rebuild.
- `main.py:33-34` runs `create_all` + `ensure_schema_upgrades()` at import time. It works,
  but on Postgres with more than one boot racing it, prefer Alembic. Not a blocker.

Good news from the audit: `.env` was **never committed** (verified against full git
history), password hashing is bcrypt with correct 72-byte truncation, ownership checks
are present on `conversations` and `messages` routes, and the audio path-traversal guard
is correct.

---

## Part 1 — Repo and environment prep

**1.1 Split env files.** `frontend/.env.local` gets only `VITE_API_URL` — everything in
it is public, it is compiled into the JS bundle. Never put a key there. Backend `.env`
holds all secrets. Both are correctly gitignored already (`.gitignore:16-20`).

**1.2 Add the new keys to `backend/.env.example`.** That file is your contract; every new
setting from Part 0 and Part 3 goes in it, with an empty value.

**1.3 Add an `environment` setting** to `config.py` (`"development"` / `"production"`) —
several fixes above branch on it.

**1.4 Generate a real JWT secret.** If yours came from a tutorial, rotate it now:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

**1.5 Make CORS and URLs configurable.** `main.py:54-60` already reads
`settings.frontend_url` — good. In production set `FRONTEND_URL=https://app.yourdomain.com`.
Keep `allow_origins` an explicit list; never `["*"]` with `allow_credentials=True`
(the browser rejects that combination anyway).

**1.6 Turn off the heavy optional providers for v1.** `EMOTION_PROVIDER`,
`SILMA_PROVIDER` and `DERJA_STT_BACKEND` all default to empty/disabled, and each pulls
1-2 GB of weights. Ship without them, confirm the deploy is healthy, then enable one at
a time and watch memory.

---

## Part 2 — Hosted Postgres and Redis

**2.1 Supabase.** Create a project, take the **connection pooler** URI (port 6543), not
the direct one — pooler survives container restarts better. Then:

```
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:6543/postgres?sslmode=require
```

Add `psycopg[binary]` to `requirements.txt`. `database.py:5` switches on
`"sqlite" in database_url`, so the Postgres path needs no code change. On first boot,
`create_all` builds the schema.

**2.2 Upstash Redis.** Create a database, copy the `rediss://` URL (TLS).
`redis` is already in `requirements.txt`.

```
REDIS_URL=rediss://default:PASSWORD@HOST:6379
```

**2.3 Migrating your dev data:** don't. Start clean in production. Your local SQLite has
test accounts and debug conversations that do not belong in a public database.

---

## Part 3 — Abuse controls (the part that actually protects you)

Three things cost you money or reputation if abused: **Gmail SMTP**, **Gemini tokens**,
and **CPU** (Whisper + face analysis). Put a limit in front of each.

**3.1 A Redis-backed limiter.** Create `backend/services/rate_limit.py` with a fixed-window
counter — `INCR` + `EXPIRE` on `rl:{scope}:{identity}:{window}`. Fail **open** on Redis
errors for read paths, and fail **closed** for `send-code` (if you cannot count emails,
do not send them).

Suggested limits:

| Route | Key | Limit |
|---|---|---|
| `POST /auth/send-code` | IP **and** email | 3/hour, 10/day |
| `POST /auth/login` | IP + email | 5 per 15 min, then exponential backoff |
| `POST /auth/refresh` | user | 60/hour |
| `POST /transcribe/` | user | 30/hour |
| `POST /audio/upload` | user | 30/hour |
| `WS /ws/conversation/*` | user | 2 concurrent, 5 new sessions/hour |
| Gemini-calling routes | user | 200 turns/day |

**3.2 Cap request bodies.** Add an ASGI middleware that rejects `Content-Length` over
~10 MB with **413** before the body is read, and separately cap the read in
`transcribe.py` / `audio.py`. Do both — `Content-Length` is client-supplied.

**3.3 Cap the WebSocket.** In `ws.py`: refuse audio once `len(audio_buffer)` exceeds
~15 MB (close with code 1009), cap `video_frame` payloads, and count turns per
connection against a hard ceiling. Also enforce the concurrent-connection cap per user
via a Redis key set on accept and cleared in the `finally` block at `:165-174`.

**3.4 Turnstile on signup.** Cloudflare Turnstile is free and beats a captcha for UX.
Verify the token server-side in `send_code` before touching SMTP. This is what stops
bots from burning your email quota; rate limits alone only slow them down.

**3.5 Cap Gemini spend.** Set a billing budget alert in Google Cloud, and enforce a
per-user daily turn budget in Redis so one account cannot drain the key.
`GEMINI_MAX_TOKENS=512` already bounds per-call output cost.

**3.6 Security headers.** Add a middleware setting `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
`Referrer-Policy: strict-origin-when-cross-origin`.

---

## Part 4 — Containerize and deploy the backend

**4.1 `backend/Dockerfile`.** Two things matter: system libraries for OpenCV/FFmpeg, and
**pre-downloading model weights at build time**. If you skip the pre-download, every cold
start fetches from Hugging Face — slow, and it fails whenever HF does.

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libgl1 libglib2.0-0 build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch — the default wheels drag in ~2GB of CUDA you cannot use.
COPY requirements.txt .
RUN pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt

COPY . .

# Bake the weights in so cold starts don't hit the network.
ENV HF_HOME=/app/.cache/huggingface
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')" \
 && python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('intfloat/multilingual-e5-base')"

ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --ws websockets"]
```

Note `--ws websockets` and **no `--workers`**: multiple workers would each hold their own
`SessionStore` and their own copy of every model. One process, one instance (see 0.11).

Also ship `backend/data/chroma_db/` into the image, or your RAG comes up empty — it is
gitignored, so add a build step that copies it in or rebuilds the index.

**4.2 Choose the host.** Fly.io `shared-cpu-4x` with 8 GB is the cheapest thing that
actually runs this (~$15-20/mo) and its WebSocket support is solid. A Hetzner CX32 VPS
(~€7/mo, 8 GB) is cheaper still if you are comfortable with Docker Compose + Caddy.
Railway and Render both work but get expensive at 8 GB.

`fly.toml`:

```toml
app = "overtone-api"
primary_region = "cdg"

[build]
  dockerfile = "backend/Dockerfile"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = false   # cold-starting 6GB of models would be brutal
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-4x"
  memory = "8gb"
```

`auto_stop_machines = false` matters: scale-to-zero plus multi-gigabyte model loading
means a 60-second first request.

**4.3 Set secrets in the platform, never in the image.**

```bash
fly secrets set JWT_SECRET=... GEMINI_API_KEY=... DATABASE_URL=... REDIS_URL=... GMAIL_APP_PASSWORD=...
```

**4.4 Add a real health check.** `main.py:71-73` returns `{"status":"ok"}` the moment the
process is up — but the models warm in a background thread (`main.py:41-48`), so `/`
returns OK while Whisper is still loading. Add `/healthz` that reports whether warmup
finished, and point the platform's health check at it.

**4.5 Deploy and watch memory.** `fly logs`. If it OOMs, first suspect is torch pulling
CUDA wheels — verify the CPU index URL took effect.

---

## Part 5 — Frontend on Vercel

**5.1** Root directory `frontend`, build `npm run build`, output `dist`.

**5.2** Environment variable: `VITE_API_URL=https://api.yourdomain.com`. Every service
file already reads it with a localhost fallback (`frontend/src/services/*.js:1`) — that
fallback is exactly why a missing variable fails silently in production. Verify the
built bundle contains your real API URL before you announce anything.

**5.3** Your `wsClient.js:1` derives the WS URL from the same variable. Confirm it
produces `wss://` (not `ws://`) from an `https://` base, or the browser blocks it as
mixed content.

---

## Part 6 — DNS, TLS, Cloudflare

**6.1** Add both CNAMEs at your registrar (or move nameservers to Cloudflare):
`app.yourdomain.com` → Vercel, `api.yourdomain.com` → your host. Register each as a
custom domain in the respective dashboard so certificates issue automatically.

**6.2** Proxy `api` through Cloudflare (orange cloud). Enable Bot Fight Mode, set SSL/TLS
to **Full (strict)**, and turn on Always Use HTTPS.

**6.3** WebSockets must be enabled in Cloudflare (Network tab — on by default on free).
If voice mode connects and immediately drops, this is the first thing to check.

**6.4** Add a WAF rate-limiting rule on `/auth/*` as a second layer. Cloudflare's limiter
runs at the edge, so it absorbs floods your app never sees.

**6.5** Update **Google OAuth**: the authorized redirect URI in Google Cloud Console must
become `https://api.yourdomain.com/auth/google/callback`, and `GOOGLE_REDIRECT_URI` must
match it byte-for-byte or the callback 400s.

---

## Part 7 — Pre-launch test pass

Run all of these against the real domain before sharing the link.

- [ ] Sign up with a fresh email → code arrives → complete signup → land logged in
- [ ] Sign out, sign back in, hard-refresh → **session survives** (this is the Part 0.1 cookie fix; it is the most likely thing to be broken)
- [ ] Google OAuth round-trip
- [ ] Start a voice session → transcript appears → coach replies with audio
- [ ] Barge-in (interrupt the coach) still works over `wss://`
- [ ] Camera/face analysis works over HTTPS (`getUserMedia` requires a secure context)
- [ ] Request `/auth/send-code` 4 times fast → 4th returns **429**
- [ ] 6 rapid failed logins → blocked
- [ ] `POST /transcribe/` with a 50 MB file → **413**, and memory does not spike
- [ ] `GET /api.yourdomain.com/docs` → **404**
- [ ] Fetch another user's `/audio/{uuid}` while logged out → **401** (Part 0.7)
- [ ] `curl` the API from an unlisted origin → CORS blocked
- [ ] Redeploy, then confirm your account and conversations are still there (Postgres, not SQLite)
- [ ] Gemini billing alert configured and confirmed by email
- [ ] `backend/data/debug_audio/` stays empty (Part 0.6)

---

## Suggested order of work

1. Part 0 fixes 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8 — code, locally, with tests
2. Part 2 — Postgres + Redis, verify locally against the hosted URLs
3. Part 3 — rate limiter + caps + Turnstile
4. Part 4 — Dockerfile, deploy, watch memory
5. Parts 5-6 — frontend, DNS, Cloudflare
6. Part 7 — full pass, then share

Parts 0 and 3 are the ones that stop this from being expensive. Everything else is
plumbing.
