# AI Coach — Project Handoff Document

> **Generated:** 2026-06-23 — **Last updated:** 2026-06-24  
> **Purpose:** Zero-context rebuild guide for another LLM or engineer.  
> **Repository root:** `ai-coach/` (monorepo: `backend/` + `frontend/`)

---

## 1. Project Overview

**AI Coach** (`coach.`) is a full-stack web application for practicing difficult conversations with an AI coaching partner. Users authenticate via email verification or Google OAuth, then create coaching sessions in one of three modes — **Psychology**, **Professional**, or **Sport** — each intended to drive a different AI persona and RAG knowledge base.

The **intended end state** is a real-time, multimodal coaching experience: the user speaks or types; audio is transcribed (Whisper), analyzed for emotion and NLP signals, enriched with scenario-specific RAG context, answered by an LLM (Anthropic Claude), synthesized to speech (Edge TTS), and scored in a post-session coaching report with charts.

**Current implementation status (as of 2026-06-24):**

| Area | Status |
|------|--------|
| Auth (email 3-step signup, login, refresh, Google OAuth) | **Implemented** (backend + frontend) |
| App shell (sidebar, conversation list, mode picker) | **Implemented** — real API, mock removed |
| Conversation REST API (`/conversations`, `/messages`) | **Implemented** — CRUD + message send wired |
| Chat UI (MessageList, InputBar, MessageBubble, AIStatus) | **Implemented** — text chat fully working |
| LLM coach responses | **Implemented** — OpenAI SDK → Token Factory (Llama-3.1-70B) |
| Auto-generated conversation titles | **Implemented** — LLM generates 3–5 word title after first exchange |
| Audio input (mic → Whisper STT) | **Implemented** — `useAudioRecorder` hook wired to `InputBar` |
| Coaching report | **Stub only** — placeholder "full report coming in M6" |
| ML pipeline (TTS, emotion, NLP, RAG) | **Empty service files** — dependencies installed but not wired |
| Scenario JSON data | **Files exist, all empty** |
| Docker deployment | **Incomplete** — `docker-compose.yml` references missing Dockerfiles |

Treat this repo as a **chat-complete application** — auth, conversations, and real-time LLM coaching work end-to-end. The remaining surface is audio output (TTS), emotion/NLP analysis, RAG, and the session report.

---

## 2. Folder Structure

```
ai-coach/
├── .dependency-cruiser.js          # JS dependency lint rules (root dev tooling)
├── .vscode/
│   └── settings.json               # VS Code Python env manager setting
├── package.json                    # Root devDependency: dependency-cruiser ^17.4.3
├── package-lock.json               # Lockfile for root npm package
├── README.md                       # Empty (no project readme yet)
├── PROJECT_HANDOFF.md              # This document
├── docker-compose.yml              # Compose stub (no Dockerfiles present)
│
├── backend/
│   ├── .env                        # Local secrets (gitignored) — DO NOT COMMIT
│   ├── .gitignore                  # Ignores .env, venv, __pycache__, *.db
│   ├── ai_coach.db                 # SQLite runtime DB (gitignored pattern)
│   ├── config.py                   # Pydantic Settings — all backend env vars
│   ├── database.py                 # SQLAlchemy engine, SessionLocal, get_db()
│   ├── main.py                     # FastAPI app entry — mounts auth router only
│   ├── requirements.txt            # Python dependencies (has duplicate entries)
│   │
│   ├── data/scenarios/             # Planned RAG scenario payloads (currently empty)
│   │   ├── boundary_setting.json
│   │   ├── conflict_resolution.json
│   │   ├── difficult_feedback.json
│   │   ├── job_interview.json
│   │   └── salary_negotiation.json
│   │
│   ├── models/
│   │   └── emotion_cnn.onnx        # Trained emotion classifier artifact (binary)
│   │
│   ├── routers/
│   │   ├── __init__.py             # Empty
│   │   ├── auth.py                 # Full auth + OAuth implementation
│   │   ├── conversations.py        # EMPTY — planned REST for conversations
│   │   ├── messages.py             # EMPTY — planned REST for messages
│   │   ├── sessions.py             # EMPTY — planned session lifecycle / reports
│   │   └── ws.py                   # EMPTY — planned WebSocket handler
│   │
│   ├── services/
│   │   ├── __init__.py             # Empty
│   │   ├── audio_features.py       # EMPTY — planned librosa feature extraction
│   │   ├── db_models.py            # User + PendingVerification SQLAlchemy models
│   │   ├── email_service.py        # Resend verification email sender
│   │   ├── emotion_model.py        # EMPTY — planned ONNX emotion inference
│   │   ├── llm_service.py          # EMPTY — planned Anthropic Claude client
│   │   ├── nlp_analyzer.py         # EMPTY — planned spaCy text analysis
│   │   ├── rag_engine.py           # EMPTY — planned ChromaDB + embeddings RAG
│   │   ├── schemas.py              # Pydantic request/response models (auth only)
│   │   ├── security.py             # bcrypt + JWT helpers
│   │   ├── tts_service.py          # EMPTY — planned edge-tts synthesis
│   │   └── whisper_stt.py          # EMPTY — planned faster-whisper STT
│   │
│   ├── training/                   # Jupyter notebooks for model training (empty cells)
│   │   ├── evaluate_models.ipynb
│   │   ├── train_emotion_cnn.ipynb
│   │   └── train_expression_classifier.ipynb
│   │
│   └── venv/                       # Local Python virtualenv (gitignored)
│
└── frontend/
    ├── .env.local                  # VITE_API_URL (gitignored via *.local)
    ├── .gitignore
    ├── eslint.config.js            # ESLint flat config for React
    ├── index.html                  # HTML shell + Google Fonts (has duplicate #root bug)
    ├── package.json                # React 19 + Vite 8 app dependencies
    ├── package-lock.json
    ├── postcss.config.js           # Tailwind + Autoprefixer
    ├── tailwind.config.js          # Tailwind content paths
    ├── vite.config.js              # Vite + React plugin
    ├── README.md                   # Default Vite template readme
    │
    ├── public/
    │   ├── favicon.svg             # Purple Vite-style favicon
    │   └── icons.svg               # Icon sprite/assets
    │
    └── src/
        ├── main.jsx                # React root mount
        ├── App.jsx                 # Bootstrap session + RouterProvider
        ├── App.css                 # Legacy Vite template styles (mostly unused)
        ├── index.css               # Design tokens + auth UI styles + Tailwind directives
        ├── router.jsx              # React Router v7 route definitions + auth guard
        │
        ├── assets/
        │   ├── hero.png
        │   ├── react.svg
        │   └── vite.svg
        │
        ├── layouts/
        │   └── AppLayout.jsx       # Sidebar + main content outlet
        │
        ├── pages/
        │   ├── Login.jsx           # Email/password + Google OAuth redirect
        │   ├── Register.jsx        # 3-step email verification signup
        │   ├── OAuthSuccess.jsx    # Parses OAuth token from URL hash
        │   ├── ConversationPage.jsx # Placeholder — chat coming M3
        │   └── ReportPage.jsx      # Placeholder — report coming M6
        │
        ├── stores/                 # Zustand global state
        │   ├── authStore.js        # Session bootstrap, login, logout
        │   ├── convStore.js        # Conversation list + create (mock-backed)
        │   └── messageStore.js     # EMPTY — planned chat message state
        │
        ├── services/               # HTTP / WS clients
        │   ├── authApi.js          # Auth REST client
        │   ├── convApi.js          # Conversation REST (mock mode ON)
        │   ├── reportApi.js        # EMPTY — planned report fetch
        │   └── wsClient.js         # EMPTY — planned WebSocket client
        │
        ├── hooks/                  # All EMPTY — planned realtime/audio hooks
        │   ├── useAudioRecorder.js
        │   ├── useConversation.js
        │   ├── useTTSPlayer.js
        │   └── useVAD.js           # Intended for @ricky0123/vad-web voice activity
        │
        └── components/
            ├── auth/
            │   ├── AmbientWave.jsx     # Canvas animated background on auth pages
            │   ├── AuthCard.jsx        # Split auth layout with rotating quotes
            │   ├── CodeInput.jsx       # 6-digit OTP input with paste support
            │   └── FieldInput.jsx      # Floating-label text input
            │
            ├── sidebar/
            │   ├── Sidebar.jsx         # Conversation list + user footer
            │   ├── ConvItem.jsx        # Nav link per conversation
            │   └── NewConvButton.jsx   # Mode picker modal → create conversation
            │
            ├── topbar/
            │   ├── Topbar.jsx          # Conversation title bar
            │   └── ModeTag.jsx         # psy / professional / sport badge
            │
            ├── chat/                   # ALL EMPTY — planned M3 chat UI
            │   ├── AIStatus.jsx
            │   ├── AudioPlayer.jsx
            │   ├── EndSessionButton.jsx
            │   ├── InputBar.jsx
            │   ├── MessageBubble.jsx
            │   ├── MessageList.jsx
            │   ├── TypingIndicator.jsx
            │   ├── VoiceButton.jsx
            │   └── WaveformBar.jsx
            │
            └── report/                 # ALL EMPTY — planned M6 report UI
                ├── CoachingSection.jsx
                ├── ReportSkeleton.jsx
                └── ScoreGrid.jsx
```

**Excluded from tree (generated / vendor):** `node_modules/`, `backend/venv/`, `frontend/dist/`, `__pycache__/`

---

## 3. Architecture

### 3.1 Layer diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BROWSER (React 19 + Vite)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pages          │  Stores (Zustand)         │  Services                     │
│  Login/Register │  authStore ✓              │  authApi  ──HTTP+cookies──┐   │
│  ConversationPage ✓ convStore ✓             │  convApi  ──HTTP (real)───┤   │
│  ReportPage stub│  messageStore ✓           │  wsClient (stub) ──WS─────┤   │
├─────────────────┴─────────────────────────────────────────────────────┤     │
│  Hooks: useAudioRecorder ✓ | useVAD ✗ | useTTSPlayer ✗ | useConversation ✗ │
│  Components: auth UI ✓ | sidebar ✓ | chat UI ✓ | report stubs              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                          REST /auth/*  │  /conversations  /messages
                          credentials:  │  include (refresh cookie)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (FastAPI + Uvicorn)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Routers                                                                    │
│    auth.py ✓          conversations.py ✓   messages.py ✓                  │
│    sessions.py ✗      ws.py ✗                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Services (domain logic)                                                    │
│    security ✓  email ✓  schemas ✓  db_models ✓                             │
│    llm_service ✓  whisper_stt ✗  audio_features ✗  emotion_model ✗       │
│    nlp_analyzer ✗  rag_engine ✗  tts_service ✗                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Persistence                                                                │
│    SQLAlchemy → SQLite (ai_coach.db)  |  Future: Redis, ChromaDB, S3     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  External APIs / Models                                                     │
│  Resend (email) ✓  |  Google OAuth ✓  |  Token Factory / Llama-3.1-70B ✓  │
│  faster-whisper (STT, dep installed) ✗  |  edge-tts ✗                     │
│  sentence-transformers + ChromaDB ✗  |  emotion_cnn.onnx ✗  |  spaCy ✗   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Legend:** ✓ = implemented and wired · ✗ = file exists but empty or not wired

### 3.2 Component connections

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| `App.jsx` | `authStore.bootstrap()` | in-process | Restore session via refresh cookie on load |
| `authApi.js` | `backend /auth/*` | HTTP JSON + cookies | Login, signup, refresh, logout, me |
| `ProtectedRoute` | `authStore.accessToken` | in-process | Gate `/app` and `/report/:id` routes |
| `Sidebar` | `convApi.listConversations` | HTTP (real) | Populate conversation list |
| `NewConvButton` | `convApi.createConversation` | HTTP (real) | Create session with mode; title=null so backend generates it |
| `ConversationPage` | `messageStore.send` → `convApi.sendMessage` | HTTP | Send user message, receive [userMsg, assistantMsg] |
| `ConversationPage` | `convStore.refreshConversation` | HTTP | Re-fetch conversation after first message to get AI-generated title |
| `InputBar` | `useAudioRecorder` → `POST /transcribe` | HTTP multipart | Record mic → Whisper STT → fill input box |
| `auth.py` | `email_service` → Resend | HTTPS | Send 6-digit verification codes |
| `auth.py` | Google OAuth endpoints | HTTPS | Social login |
| `main.py` | `database.Base.metadata.create_all` | sync | Auto-create SQLite tables on startup |
| `messages.py` | `llm_service.get_coach_response` | in-process | Generate coach reply (OpenAI SDK → Token Factory) |
| `messages.py` | `llm_service.generate_title` | in-process | Generate 3–5 word title from first exchange |
| *(planned)* `wsClient` | `ws.py` | WebSocket | Streaming audio/text coaching loop |
| *(planned)* `rag_engine` | ChromaDB + scenario JSON | in-process | Mode/scenario-specific retrieval |

### 3.3 Coaching modes

Defined in `frontend/src/components/topbar/ModeTag.jsx` and `NewConvButton.jsx`:

| Mode ID | Label | Intended use |
|---------|-------|--------------|
| `psy` | Psychology | Emotional wellbeing, self-awareness, relationships |
| `professional` | Professional | Career, workplace, negotiation, interviews |
| `sport` | Sport | Performance mindset, pre-competition focus |

Mode is chosen at conversation creation and **cannot be changed later** (enforced in UI copy; backend validation not yet implemented).

---

## 4. Data Flow

### 4.1 Authentication — email signup (implemented)

```
User enters email (Register step 1)
  → POST /auth/send-code { email }
  → Backend: upsert PendingVerification, hash 6-digit code (bcrypt)
  → email_service.send_code_email() via Resend (sandbox redirects to TEST_EMAIL)
  → User enters code (step 2)
  → POST /auth/verify-code { email, code }
  → Backend: verify hash, mark pending.verified=true, return signup_token (short JWT)
  → User sets name + password (step 3)
  → POST /auth/complete-signup { signup_token, name, password }
  → Backend: create User row, delete PendingVerification
  → Response: { user, accessToken } + Set-Cookie refresh_token (httponly, path=/auth)
  → Frontend: authStore.setSession → navigate /app
```

### 4.2 Authentication — login + session restore (implemented)

```
Login:
  POST /auth/login { email, password }
  → verify_password → issue access JWT (15 min) + refresh cookie (7 days)

App bootstrap (every page load):
  authStore.bootstrap()
  → POST /auth/refresh (cookie auto-sent, credentials: include)
  → New accessToken (+ user object returned by handler but see schema bug below)
  → Router renders /app if token present

Logout:
  POST /auth/logout → clears refresh cookie
```

### 4.3 Google OAuth (implemented)

```
GET /auth/google/login → redirect to Google consent
Google callback → GET /auth/google/callback?code=...
  → Exchange code for access_token (httpx)
  → Fetch userinfo
  → Upsert User by google_id or email
  → Redirect to FRONTEND_URL/oauth-success#token={accessJWT}
  → Set refresh cookie on response
OAuthSuccess page:
  → Parse token from hash → GET /auth/me with Bearer token
  → setSession → navigate /app
```

### 4.4 Conversation list (partial — mock only)

```
User lands on /app
  → Sidebar useEffect → convStore.loadConversations(accessToken)
  → convApi.listConversations (USE_MOCK=true → returns hardcoded MOCK_CONVS)
  → Render ConvItem links to /app/:id

New conversation:
  → User picks mode in modal
  → convApi.createConversation({ mode, scenario }) → mock creates local object
  → Navigate to /app/:id → ConversationPage shows placeholder
```

### 4.5 Intended coaching session flow (NOT implemented — target architecture)

```
1. User opens /app/:conversationId
2. Frontend opens WebSocket to /ws?token=... (wsClient.js — stub)
3. User speaks → useVAD detects speech → useAudioRecorder captures PCM/blob
4. Audio chunk sent over WS to backend ws.py
5. whisper_stt.transcribe(audio) → text
6. audio_features.extract(audio) + emotion_model.predict(audio) → prosody/emotion scores
7. nlp_analyzer.analyze(text) → sentiment, entities, discourse markers
8. rag_engine.retrieve(mode, scenario, text) → coaching context snippets from scenario JSON + ChromaDB
9. llm_service.generate(messages, context, mode) → coach reply text
10. tts_service.synthesize(reply) → audio bytes streamed back
11. Frontend: MessageList updates, AudioPlayer plays TTS, WaveformBar visualizes
12. On End Session → sessions router finalizes → NLP/ emotion aggregates → report JSON
13. Navigate /report/:id → ScoreGrid (recharts) + CoachingSection
```

---

## 5. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Backend framework** | FastAPI | Async-ready, Pydantic validation, OpenAPI, WebSocket support for planned realtime |
| **Database (current)** | SQLite via SQLAlchemy | Zero-config local dev; `check_same_thread=False` for FastAPI |
| **Auth tokens** | JWT access (header) + refresh (httponly cookie) | XSS-resistant refresh; short-lived access tokens |
| **Refresh rotation** | New refresh JWT on every `/auth/refresh` | Limits stolen refresh token window |
| **Email verification** | 3-step signup with `PendingVerification` table | Verify email before account exists; prevents orphan users |
| **Verification codes** | bcrypt-hashed 6-digit codes, 10 min TTL, 5 attempts | Rate-limit brute force without storing plaintext codes |
| **Email provider** | Resend with sandbox redirect to `TEST_EMAIL` | Dev-friendly; logs code to console on send failure |
| **OAuth** | Google only; links by `google_id` or email merge | Single social provider for MVP |
| **Password hashing** | passlib bcrypt | Industry standard; `bcrypt==4.0.1` pinned for passlib compat |
| **Frontend stack** | React 19 + Vite 8 + Zustand + React Router 7 | Modern SPA; minimal boilerplate; no Redux |
| **Styling** | Tailwind 3 + CSS custom properties (`--ink`, `--gold`) | Dark editorial aesthetic; legacy `--bg-*` aliases for sidebar |
| **Conversation API dev** | `USE_MOCK = true` in convApi.js | Unblocks M2 UI before backend routers exist |
| **Mode immutability** | Set at creation in UI | Simplifies RAG index selection per session |
| **ML stack (planned)** | faster-whisper + ONNX emotion + spaCy + ChromaDB + Claude + edge-tts | Local STT/emotion; cloud LLM; free TTS; vector RAG for scenarios |
| **Monorepo layout** | `backend/` + `frontend/` | Clear separation; docker-compose for joint run (incomplete) |
| **Dependency analysis** | dependency-cruiser at repo root | JS import graph linting (not wired to CI) |

---

## 6. Dependencies

### 6.1 Root (`package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| dependency-cruiser | ^17.4.3 (dev) | Analyze JS import graphs, detect circular deps |

### 6.2 Frontend (`frontend/package.json` — installed lock versions)

| Package | Declared | Purpose |
|---------|----------|---------|
| react | ^19.2.6 | UI library |
| react-dom | ^19.2.6 | DOM renderer |
| react-router-dom | ^7.18.0 | Client routing + auth guards |
| zustand | ^5.0.14 | Lightweight global state |
| @ricky0123/vad-web | ^0.0.30 | Browser voice-activity detection (not wired yet) |
| lucide-react | ^1.21.0 | Icon set (minimal usage so far) |
| recharts | ^3.8.1 | Report charts (not wired yet) |
| vite | ^8.0.12 (dev) | Dev server + bundler |
| @vitejs/plugin-react | ^6.0.1 (dev) | React Fast Refresh |
| tailwindcss | ^3.4.17 (dev) | Utility CSS |
| postcss | ^8.4.49 (dev) | CSS pipeline |
| autoprefixer | ^10.4.20 (dev) | Vendor prefixes |
| eslint | ^10.3.0 (dev) | Linting |
| @eslint/js | ^10.0.1 (dev) | ESLint recommended rules |
| eslint-plugin-react-hooks | ^7.1.1 (dev) | Hooks lint rules |
| eslint-plugin-react-refresh | ^0.5.2 (dev) | HMR export lint |
| globals | ^17.6.0 (dev) | Browser global definitions for ESLint |
| @types/react | ^19.2.14 (dev) | React type hints (JS project) |
| @types/react-dom | ^19.2.3 (dev) | ReactDOM type hints |

### 6.3 Backend (`backend/requirements.txt` + venv installed versions)

**Declared in requirements.txt** (note: file lists `fastapi`, `uvicorn`, `sqlalchemy`, etc. **twice** — dedupe on install):

| Package | In requirements.txt | Installed in venv | Purpose |
|---------|--------------------|--------------------|---------|
| fastapi | yes (×2) | 0.137.2 | HTTP API framework |
| uvicorn[standard] | yes (×2) | 0.49.0 | ASGI server |
| python-multipart | yes (×2) | 0.0.32 | Form/file uploads |
| websockets | yes | 16.0 | WS protocol support |
| sqlalchemy | yes (×2) | 2.0.51 | ORM |
| passlib[bcrypt] | yes (×2) | 1.7.4 | Password hashing |
| bcrypt | `<4.1` (×1) | 4.0.1 | passlib bcrypt backend |
| python-jose[cryptography] | yes (×2) | 3.5.0 | JWT encode/decode |
| httpx | yes | 0.28.1 | Async HTTP (Google OAuth) |
| resend | yes | 2.32.2 | Transactional email |
| pydantic-settings | yes | 2.14.1 | Settings from `.env` |
| python-dotenv | yes | 1.2.2 | Env file loading |
| pydantic | (transitive) | 2.13.4 | Request/response models |
| email-validator | (transitive) | 2.3.0 | `EmailStr` validation |
| faster-whisper | yes | installed (2026-06-24) | Local speech-to-text |
| librosa | yes | installed (2026-06-24) | Audio feature extraction |
| torch | yes | installed (2026-06-24) | Training / optional inference |
| torchvision | yes | installed (2026-06-24) | Vision models for training notebooks |
| onnxruntime | yes | installed (2026-06-24) | Run emotion_cnn.onnx |
| mediapipe | yes | installed (2026-06-24) | Face/pose expression (planned) |
| chromadb | yes | installed (2026-06-24) | Vector store for RAG |
| sentence-transformers | yes | installed (2026-06-24) | Text embeddings for RAG |
| openai | yes (`>=1.0.0`) | 2.43.0 | OpenAI SDK — used for Token Factory (Llama) |
| edge-tts | yes | installed (2026-06-24) | Microsoft Edge TTS |
| spacy | yes | installed (2026-06-24) | NLP pipeline |
| redis | yes | installed (2026-06-24) | Caching / pub-sub (planned) |
| boto3 | yes | installed (2026-06-24) | AWS S3 (planned audio storage) |
| numpy | yes | installed (2026-06-24) | Numerical arrays for ML |

---

## 7. Per-File Spec

### 7.1 Root

#### `.dependency-cruiser.js`
- **Purpose:** Configure dependency-cruiser rules (no-circular, no-orphans, no-dev-dep in prod, etc.)
- **Inputs:** JS/TS import graph
- **Outputs:** CLI reports when running `npx depcruise`
- **Key logic:** Standard generated config; ignores `node_modules`

#### `docker-compose.yml`
- **Purpose:** Run backend:8000 + frontend:5173 with volume mounts
- **Inputs:** `ANTHROPIC_API_KEY` env (only var listed)
- **Outputs:** Two services (build contexts `./backend`, `./frontend`)
- **Key logic:** **Broken** — no Dockerfiles exist in those directories

#### `package.json` / `package-lock.json`
- **Purpose:** Root npm project for dependency-cruiser only

#### `README.md`
- **Purpose:** Empty placeholder

---

### 7.2 Backend core

#### `backend/config.py`
- **Purpose:** Central typed configuration via `pydantic_settings.BaseSettings`
- **Inputs:** `.env` file + environment variables (case-insensitive)
- **Outputs:** Singleton `settings` object
- **Key logic:** Required secrets: `jwt_secret`, Google OAuth trio, `resend_api_key`, `test_email`; defaults for SQLite URL, token TTLs, URLs
- **2026-06-24:** `anthropic_api_key` renamed to `llm_api_key` (Token Factory key)

#### `backend/database.py`
- **Purpose:** SQLAlchemy engine + session factory + FastAPI dependency
- **Inputs:** `settings.database_url`
- **Outputs:** `engine`, `SessionLocal`, `Base`, `get_db()` generator
- **Key logic:** SQLite gets `check_same_thread=False`

#### `backend/main.py`
- **Purpose:** FastAPI application factory / entrypoint
- **Inputs:** Imports routers, settings
- **Outputs:** `app` with CORS + routers + health check `GET /`
- **Key logic:** `Base.metadata.create_all(bind=engine)` on import; mounts `auth`, `conversations`, `messages`, `transcribe` routers; `sessions` and `ws` still not mounted

#### `backend/requirements.txt`
- **Purpose:** Pip dependency manifest (needs deduplication and optional version pins)

---

### 7.3 Backend routers

#### `backend/routers/auth.py`
- **Purpose:** Complete authentication API
- **Inputs:** HTTP requests per endpoint; DB session; cookies
- **Outputs:** JSON responses + Set-Cookie for refresh token
- **Key logic:**
  - Constants: `REFRESH_COOKIE`, `CODE_TTL_MINUTES=10`, `SIGNUP_TOKEN_TTL_MINUTES=5`, `MAX_CODE_ATTEMPTS=5`
  - `get_current_user(Authorization: Bearer)` — reusable dependency for protected routes
  - Endpoints: `POST /auth/send-code`, `/verify-code`, `/complete-signup`, `/login`, `/refresh`, `/logout`, `GET /auth/me`, `GET /auth/google/login`, `GET /auth/google/callback`
  - Refresh rotates cookie; OAuth redirects with access token in URL fragment

#### `backend/routers/conversations.py`
- **Purpose:** CRUD for user conversations
- **Endpoints:** `GET /conversations` (list), `POST /conversations` (create), `GET /conversations/{id}` (detail + messages), `DELETE /conversations/{id}`
- **Key logic:** Mode validated against `{"psy", "professional", "sport"}`; `get_current_user` dependency on all routes; title is `Optional[str]` — pass `null` at creation so the LLM can generate it

#### `backend/routers/messages.py`
- **Purpose:** Persist chat messages and call LLM per conversation
- **Endpoints:** `GET /conversations/{id}/messages`, `POST /conversations/{id}/messages`
- **Key logic in `send_message`:**
  1. Verify ownership
  2. Set `is_first_message = not conv.title`
  3. Save user message, flush (get ID)
  4. Build last-20-message history
  5. `get_coach_response(mode, history, content)` — sync OpenAI call
  6. If `is_first_message`: call `generate_title(user_msg, assistant_text)`, fallback to `content[:60]`
  7. Save assistant message, commit
  8. Return `[user_msg, assistant_msg]`

#### `backend/routers/sessions.py` *(empty)*
- **Purpose (planned):** End session, trigger report generation, fetch report by id

#### `backend/routers/ws.py` *(empty)*
- **Purpose (planned):** WebSocket endpoint for bidirectional audio/text streaming

---

### 7.4 Backend services

#### `backend/services/db_models.py`
- **Purpose:** SQLAlchemy ORM models
- **Key models:**
  - `User`: `id` (uuid prefix `u_`), `email`, `name`, `password_hash` (nullable for Google-only), `is_verified`, `google_id`, `created_at`
  - `PendingVerification`: `email` PK, `code_hash`, `attempts`, `expires_at`, `verified`, `verified_at`, `created_at`

#### `backend/services/schemas.py`
- **Purpose:** Pydantic v2 models for auth I/O
- **Models:** `SendCodeIn`, `VerifyCodeIn`, `CompleteSignupIn`, `LoginIn`, `UserOut`, `AuthOut`, `RefreshOut`, `MessageOut`, `VerifyCodeOut`
- **Bug:** `RefreshOut` only declares `accessToken` but `auth.py` refresh handler also passes `user` (silently dropped by Pydantic)

#### `backend/services/security.py`
- **Purpose:** Password + JWT utilities
- **Functions:** `hash_password`, `verify_password`, `make_access_token`, `make_refresh_token`, `decode_token(token, expected_type) → user_id | None`

#### `backend/services/email_service.py`
- **Purpose:** Send styled HTML verification email via Resend
- **Inputs:** `to_email`, 6-digit `code`
- **Outputs:** Resend API call; console log if recipient redirected in sandbox

#### `backend/services/audio_features.py` *(empty)*
- **Purpose (planned):** librosa-based pitch, energy, tempo, pause detection from audio waveforms

#### `backend/services/emotion_model.py` *(empty)*
- **Purpose (planned):** Load `models/emotion_cnn.onnx` via onnxruntime; classify emotion labels from audio features

#### `backend/services/whisper_stt.py` *(empty)*
- **Purpose (planned):** faster-whisper transcription wrapper

#### `backend/services/nlp_analyzer.py` *(empty)*
- **Purpose (planned):** spaCy pipeline for sentiment, key phrases, communication patterns

#### `backend/services/rag_engine.py` *(empty)*
- **Purpose (planned):** Index `data/scenarios/*.json` into ChromaDB; retrieve by mode + query embedding

#### `backend/services/llm_service.py`
- **Purpose:** LLM coach responses via OpenAI SDK pointed at Token Factory
- **Provider:** `https://tokenfactory.esprit.tn/api` — model `hosted_vllm/Llama-3.1-70B-Instruct`
- **Functions:**
  - `get_coach_response(mode, history, user_message) → str` — synchronous; prepends system prompt per mode; keeps last 20 history turns; `max_tokens=512`
  - `generate_title(user_msg, assistant_reply) → str` — quick call asking for a 3–5 word title from the first exchange; `max_tokens=15`; strips surrounding quotes
- **System prompts:** Three personas keyed by `"psy"`, `"professional"`, `"sport"`; defaults to `"professional"` for unknown modes
- **2026-06-24:** Replaced Anthropic SDK with OpenAI SDK; `settings.llm_api_key` (was `anthropic_api_key`)

#### `backend/services/tts_service.py` *(empty)*
- **Purpose (planned):** edge-tts async synthesis to MP3/PCM bytes

---

### 7.5 Backend data & training

#### `backend/data/scenarios/*.json` *(all empty)*
- **Purpose (planned):** Structured scenario definitions for RAG — likely fields: `title`, `mode`, `context`, `persona`, `evaluation_rubric`, `opening_prompt`

#### `backend/models/emotion_cnn.onnx`
- **Purpose:** Pre-trained emotion classification model (binary artifact)
- **Usage:** To be loaded by `emotion_model.py` (not implemented)

#### `backend/training/*.ipynb` *(empty notebooks)*
- **Purpose:** Offline training/evaluation for emotion CNN and expression classifier

#### `backend/ai_coach.db`
- **Purpose:** SQLite database file created at runtime (users + pending_verifications tables)

---

### 7.6 Frontend entry & routing

#### `frontend/index.html`
- **Purpose:** HTML shell, Google Fonts (Fraunces, Inter, JetBrains Mono)
- **Bug:** Duplicate `<div id="root">` and duplicate script tag — remove one set

#### `frontend/src/main.jsx`
- **Purpose:** Mount React app with StrictMode; import global CSS

#### `frontend/src/App.jsx`
- **Purpose:** Session bootstrap gate then render router
- **Flow:** `bootstrap()` on mount → show "Restoring session…" until done → `RouterProvider`

#### `frontend/src/router.jsx`
- **Purpose:** Route table
- **Routes:**
  - Public: `/login`, `/register`, `/oauth-success`
  - Protected: `/app` (layout + index empty state + `:id` conversation), `/report/:id`
  - Fallback: `*` → `/login`

#### `frontend/vite.config.js`
- **Purpose:** Minimal Vite config with React plugin only (no API proxy configured)

---

### 7.7 Frontend state & API

#### `frontend/src/stores/authStore.js`
- **Purpose:** Auth state machine
- **State:** `user`, `accessToken`, `isLoading`, `isBootstrapping`, `error`, `registrationMessage`
- **Actions:** `bootstrap`, `login`, `register` (**broken** — calls missing `authApi.register`), `refresh`, `fetchMe`, `setSession`, `logout`

#### `frontend/src/stores/convStore.js`
- **Purpose:** Conversation list state
- **Actions:** `loadConversations(token)`, `createConversation({mode, title}, token)`, `deleteConversation(id, token)`, `setActive(id)`, `refreshConversation(id, token)`
- **`refreshConversation`:** Calls `convApi.getConversation(id, token)` and patches the matching entry in `conversations[]` — used to pick up the AI-generated title after the first message

#### `frontend/src/stores/messageStore.js`
- **Purpose:** Messages per conversation, sending state
- **State:** `messages[]`, `loading`, `sending`, `error`
- **Actions:** `loadMessages(token, convId)`, `send(token, convId, content)`, `clear()`
- **`send`:** Calls `sendMessage` API, appends both `[userMsg, assistantMsg]` to state on success

#### `frontend/src/services/authApi.js`
- **Purpose:** Auth HTTP client
- **Base URL:** `import.meta.env.VITE_API_URL || http://localhost:8000`
- **Always sends:** `credentials: "include"` for refresh cookie
- **Functions:** `sendCode`, `verifyCode`, `completeSignup`, `login`, `refreshToken`, `logout`, `getMe`, `googleLoginUrl`
- **Error handling:** Throws `Error(data.detail || status)`

#### `frontend/src/services/convApi.js`
- **Purpose:** Conversation HTTP client
- **Mock removed** — `USE_MOCK` flag eliminated; all calls hit real backend
- **Functions:** `listConversations`, `createConversation`, `getConversation`, `deleteConversation`

#### `frontend/src/services/reportApi.js` *(empty)*
- **Purpose (planned):** `GET /sessions/:id/report`

#### `frontend/src/services/wsClient.js` *(empty)*
- **Purpose (planned):** WebSocket connect, send audio chunks, receive transcript + TTS + status events

---

### 7.8 Frontend pages

#### `frontend/src/pages/Login.jsx`
- **Inputs:** email, password form; Google button
- **Outputs:** navigate `/app` on success
- **Uses:** `AuthCard`, `FieldInput`, `useAuthStore.login`

#### `frontend/src/pages/Register.jsx`
- **Inputs:** 3-step wizard (email → 6-digit code → name/password)
- **Outputs:** `completeSignup` → `setSession` → `/app`
- **Uses:** `CodeInput`, direct `authApi` calls, 30s resend cooldown

#### `frontend/src/pages/OAuthSuccess.jsx`
- **Inputs:** URL hash `#token=...`
- **Outputs:** `getMe(token)` → `setSession` → `/app`; strips hash from history

#### `frontend/src/pages/ConversationPage.jsx`
- **Inputs:** route param `:id`
- **Outputs:** `ConvTopbar` + `MessageList` + `InputBar` + `AIStatus`
- **Key logic:**
  - Loads messages on `id` change via `messageStore.loadMessages`
  - `handleSend`: if `messages.length === 0` (first message), calls `convStore.refreshConversation(Number(id), token)` after send to pick up AI-generated title
  - `modeLocked` once there are >1 messages
  - Mic toggle via `useAudioRecorder`; transcript appended to input box
  - `aiStatus`: `"thinking"` while sending/transcribing, `"listening"` while recording

#### `frontend/src/pages/ReportPage.jsx`
- **Inputs:** route param `:id`
- **Outputs:** Back button + placeholder "full report coming in M6"

---

### 7.9 Frontend components (implemented)

#### `AuthCard.jsx`
- Split layout: left ambient quote panel + right form; rotating quotes every 8s

#### `AmbientWave.jsx`
- Canvas 60fps sine-wave animation; mouse proximity brightens lines

#### `FieldInput.jsx` / `CodeInput.jsx`
- Auth form controls with floating labels and OTP paste support

#### `Sidebar.jsx`
- Loads conversations on token; shows user avatar initial + logout

#### `NewConvButton.jsx`
- Modal with 3 mode buttons; creates conversation and navigates

#### `ConvItem.jsx`
- NavLink to `/app/:id` with relative date formatting

#### `Topbar.jsx` / `ModeTag.jsx`
- Conversation header with mode badge; exports `MODE_CONFIG` constant

---

### 7.10 Frontend chat components

**Implemented:**

| File | Responsibility |
|------|----------------|
| `MessageList.jsx` | Scrollable transcript; shows scenario briefing card before first message (title + description, no persona/turns meta); collapsed briefing after first message; auto-scrolls unless user scrolled up |
| `MessageBubble.jsx` | User vs coach styling with timestamps |
| `InputBar.jsx` | Text input + send button + mic toggle; mode badge |
| `AIStatus.jsx` | "thinking" / "listening" status banner |
| `useAudioRecorder.js` | MediaRecorder API → `POST /transcribe` → transcript callback |

**Still stubs (empty files):**

| File | Intended responsibility |
|------|-------------------------|
| `VoiceButton.jsx` | Push-to-talk or toggle mic (superceded by InputBar mic for now) |
| `WaveformBar.jsx` | Live audio visualization |
| `AudioPlayer.jsx` | Play coach TTS responses |
| `TypingIndicator.jsx` | Coach "thinking" state (AIStatus covers this for now) |
| `EndSessionButton.jsx` | Trigger report flow |
| `ScoreGrid.jsx` | recharts radar/bar scores |
| `CoachingSection.jsx` | Narrative feedback sections |
| `ReportSkeleton.jsx` | Loading state for report |
| `useVAD.js` | Wrap @ricky0123/vad-web |
| `useTTSPlayer.js` | Queue and play audio blobs |
| `useConversation.js` | Orchestrate WS + stores for active chat |

---

### 7.11 Frontend styles

#### `frontend/src/index.css`
- **Purpose:** Design system + auth component classes
- **Tokens:** `--ink`, `--gold`, `--bone`, legacy `--bg-*` aliases
- **Classes:** `.field`, `.cta`, `.google-btn`, `.toast`, `.wordmark`, `.display`, `.auth-stagger`
- **Tailwind:** `@tailwind base/components/utilities` directives

#### `frontend/src/App.css`
- **Purpose:** Leftover Vite template styles (`.hero`, `#center`) — not imported by current App flow except if added later

---

## 8. Shared Types / Schemas

### 8.1 Backend Pydantic (`services/schemas.py`)

```python
SendCodeIn          { email: EmailStr }
VerifyCodeIn        { email: EmailStr, code: str (len 6) }
CompleteSignupIn    { signup_token: str, name: str (1-80), password: str (6-128) }
LoginIn             { email: EmailStr, password: str }
UserOut             { id: str, email: str, name: str, is_verified: bool }
AuthOut             { user: UserOut, accessToken: str }
RefreshOut          { accessToken: str }           # SHOULD also include user: UserOut
MessageOut          { message: str }
VerifyCodeOut       { signup_token: str, message: str }
```

### 8.2 Backend SQLAlchemy (`services/db_models.py`)

```python
User:
  id: str PK (default u_{uuid24})
  email: str unique indexed
  name: str
  password_hash: str | null
  is_verified: bool default True
  google_id: str | null unique
  created_at: datetime tz

PendingVerification:
  email: str PK
  code_hash: str
  attempts: int default 0
  expires_at: datetime tz
  verified: bool default False
  verified_at: datetime tz | null
  created_at: datetime tz
```

### 8.3 JWT payload shapes (not Pydantic — encoded in `security.py` / `auth.py`)

```python
Access/Refresh token: { sub: user_id, type: "access"|"refresh", exp: unix }
Signup token:         { email: str, type: "signup", exp: unix }
```

### 8.4 Frontend implicit types (JavaScript — no TypeScript)

**User object** (from API):
```javascript
{ id: string, email: string, name: string, is_verified: boolean }
```

**Conversation object** (mock + planned API):
```javascript
{
  id: string,           // e.g. "c_123" or "c_" + timestamp
  title: string,
  mode: "psy" | "professional" | "sport",
  createdAt: number,    // Unix ms timestamp
  status: "active" | "completed"
}
```

**MODE_CONFIG** (`ModeTag.jsx`):
```javascript
{
  psy:          { label: "Psychology",   color: "#34d399", soft: "rgba(52,211,153,0.12)" },
  professional: { label: "Professional", color: "#60a5fa", soft: "rgba(96,165,250,0.12)" },
  sport:        { label: "Sport",        color: "#fbbf24", soft: "rgba(251,191,36,0.12)" },
}
```

### 8.5 Planned types (not yet in codebase — implement when building M3+)

```python
# Suggested additions to schemas.py
ConversationOut   { id, title, mode, status, created_at }
MessageOut        { id, conversation_id, role: "user"|"coach", content, audio_url?, created_at }
ReportOut         { session_id, scores: dict, sections: list, created_at }
WSClientEvent     { type: "transcript"|"coach_text"|"coach_audio"|"status"|"error", payload: any }
```

---

## 9. Environment Variables

### 9.1 Backend (`backend/.env`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | No | `sqlite:///./ai_coach.db` | SQLAlchemy connection string |
| `JWT_SECRET` | **Yes** | — | HS256 signing key for all JWTs |
| `JWT_ALGORITHM` | No | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_MINUTES` | No | `15` | Access token TTL |
| `REFRESH_TOKEN_DAYS` | No | `7` | Refresh token TTL |
| `GOOGLE_CLIENT_ID` | **Yes** | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | **Yes** | — | Google OAuth secret |
| `GOOGLE_REDIRECT_URI` | **Yes** | — | Must match Google console; e.g. `http://localhost:8000/auth/google/callback` |
| `RESEND_API_KEY` | **Yes** | — | Resend email API key |
| `EMAIL_FROM` | No | `onboarding@resend.dev` | Sender address |
| `TEST_EMAIL` | **Yes** | — | Resend sandbox verified recipient; all emails redirect here in dev |
| `FRONTEND_URL` | No | `http://localhost:5173` | CORS origin + OAuth redirect target |
| `BACKEND_URL` | No | `http://localhost:8000` | Reserved for absolute URL generation |

### 9.2 Backend — added 2026-06-24

| Variable | Purpose |
|----------|---------|
| `LLM_API_KEY` | Token Factory API key — maps to `settings.llm_api_key`; set in `backend/.env` |

### 9.3 Backend — planned (not in `config.py` yet)

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Session/cache/pub-sub |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET` | Audio artifact storage via boto3 |
| `CHROMA_PERSIST_DIR` | Local ChromaDB persistence path |
| `WHISPER_MODEL_SIZE` | faster-whisper model tier (e.g. `base`, `small`) |
| `SPACY_MODEL` | spaCy model name (e.g. `en_core_web_sm`) |

### 9.3 Frontend (`frontend/.env.local`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_API_URL` | No | `http://localhost:8000` | Backend base URL for all API calls |

**Security note:** Never commit `.env` or `.env.local`. Rotate any secrets that were ever committed to git history.

---

## 10. Implementation Order

Build in this sequence to respect dependencies:

```
Phase 1 — Foundation (DONE)
├── config.py, database.py
├── services/db_models.py, security.py, schemas.py
├── services/email_service.py
├── routers/auth.py
├── main.py (CORS + auth router)
└── Frontend: authApi, authStore, Login, Register, OAuthSuccess, App bootstrap

Phase 2 — Data model extension (DONE)
├── Added Conversation + Message SQLAlchemy models to db_models.py
├── Extended schemas.py with ConversationCreate/Out/Detail, MessageItemOut, MessageCreate
└── Still using create_all (no Alembic yet)

Phase 3 — Conversation REST (DONE)
├── Implemented routers/conversations.py (list, create, get, delete)
├── Mounted in main.py
├── Removed USE_MOCK from convApi.js
└── get_current_user dependency on all routes

Phase 4 — Text chat (DONE as of 2026-06-24)
├── Implemented services/llm_service.py (OpenAI SDK → Token Factory, Llama-3.1-70B)
├── Implemented routers/messages.py (send message, LLM response, AI title generation)
├── Implemented messageStore.js, updated convStore.js (refreshConversation)
├── Built chat components: MessageList, InputBar, MessageBubble, AIStatus
├── Implemented useAudioRecorder.js → POST /transcribe (Whisper STT)
└── Auto-title: LLM generates 3–5 word title from first exchange

Phase 4b — Voice input (PARTIAL)
├── useAudioRecorder.js wired to InputBar ✓
└── whisper_stt.py service not yet implemented (transcribe router exists)

Phase 5 — Audio + VAD (M3/M4)
├── useAudioRecorder.js, useVAD.js, VoiceButton, WaveformBar, AudioPlayer
├── services/audio_features.py, emotion_model.py
└── Stream audio over WebSocket; store blobs (local or S3)

Phase 6 — RAG + scenarios (M4/M5)
├── Populate data/scenarios/*.json
├── Implement rag_engine.py (ChromaDB ingest + query)
├── Integrate retrieval into llm_service prompt assembly

Phase 7 — NLP analysis (M5)
├── Implement nlp_analyzer.py
└── Persist per-message analysis for report aggregation

Phase 8 — Session reports (M6)
├── Implement routers/sessions.py
├── reportApi.js, ReportPage, ScoreGrid, CoachingSection
└── recharts visualization of rubric scores

Phase 9 — Production hardening
├── Fix RefreshOut schema; add Dockerfiles
├── Redis, postgres option, secure cookies (secure=True, SameSite)
├── Remove duplicate index.html elements
└── CI: eslint, dependency-cruiser, pytest
```

**Dependency graph (simplified):**

```
config → database → db_models → auth router → frontend auth
                ↓
         conversation models → conversations router → convApi → sidebar UI
                ↓
         messages + ws router → wsClient → chat UI
                ↓
    whisper + llm + tts → audio hooks → voice UI
                ↓
    scenarios JSON → rag_engine → llm prompts
                ↓
    nlp + emotion → session aggregate → report UI
```

---

## 11. What to Avoid

### 11.1 Known bugs / inconsistencies (fix before building on top)

1. **`RefreshOut` missing `user` field** — `/auth/refresh` constructs `RefreshOut(..., user=...)` but schema drops `user`; frontend expects `{ accessToken, user }` in `authStore.bootstrap()`.
2. **`authStore.register()` calls nonexistent `authApi.register`** — dead code path; registration uses direct `authApi.sendCode/verifyCode/completeSignup` in `Register.jsx`.
3. ~~**`main.py` only includes auth router**~~ — **FIXED 2026-06-24**: now mounts auth, conversations, messages, transcribe.
4. **`index.html` duplicate `#root` and script** — can cause double React mount.
5. **`requirements.txt` duplicates** — fastapi, uvicorn, sqlalchemy, passlib, python-jose, python-multipart each listed twice; harmless on install but noisy.
6. **`.env` with real secrets in working tree** — rotate JWT, Google, Resend keys if repo was shared; keep gitignored.
7. **`whisper_stt.py` service empty** — `useAudioRecorder` sends audio to a `/transcribe` router, but the actual faster-whisper inference inside that router needs to be confirmed/implemented.
8. **`docker-compose.yml` references `ANTHROPIC_API_KEY`** — stale; update to `LLM_API_KEY` if Dockerizing.

### 11.2 Anti-patterns to avoid in continued development

| Don't | Do instead |
|-------|------------|
| Store access tokens in localStorage | Keep access token in memory (Zustand); refresh via httponly cookie |
| Store plaintext verification codes | Continue bcrypt-hashing codes in `PendingVerification` |
| Change coaching mode mid-conversation | Create a new conversation (UI already communicates immutability) |
| Call Anthropic/spaCy/torch at import time | Lazy-load heavy ML models on first request or in lifespan handler |
| Block FastAPI event loop with CPU inference | Run whisper/emotion/onnx in `run_in_executor` or separate worker |
| Commit `ai_coach.db` or `venv/` | Keep in `.gitignore`; document seed/migration steps |
| Re-introduce `USE_MOCK` in convApi or messageApi | The mock layer is gone; use MSW or test fixtures for unit tests |
| Pass refresh token to frontend JS | Cookie-only refresh (current design is correct) |
| Skip `get_current_user` on new routes | Reuse dependency from `auth.py` for all protected endpoints |
| Hardcode scenario content in Python | Keep scenarios in JSON; index via `rag_engine` |

### 11.3 Operational constraints

- **Resend sandbox:** Only delivers to `TEST_EMAIL`; other recipients are redirected — document for QA.
- **Google OAuth:** `GOOGLE_REDIRECT_URI` must exactly match Google Cloud Console authorized redirect URIs.
- **CORS:** Backend allows single origin `settings.frontend_url`; update when deploying to new domains.
- **Cookie path `/auth`:** Refresh cookie only sent to `/auth/*` paths — correct for refresh/logout; do not move cookie path without updating frontend fetch paths.
- **SQLite limits:** Fine for dev; use PostgreSQL + connection pooling for multi-user production.
- **docker-compose:** Non-functional until Dockerfiles are added for backend (uvicorn) and frontend (vite preview or nginx static).
- **bcrypt pin:** Stay on `bcrypt<4.1` / `bcrypt==4.0.1` until passlib compatibility confirmed for newer bcrypt.

### 11.4 Milestone references in UI (implementation roadmap hints)

- **M2:** Sidebar + conversation shell (frontend largely done; backend missing)
- **M3:** Chat interface (`ConversationPage` placeholder)
- **M6:** Coaching report (`ReportPage` placeholder)

---

## Appendix A — Running locally

### Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

pip install -r requirements.txt
# Create backend/.env with required variables (see Section 9)
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# Create frontend/.env.local with VITE_API_URL=http://localhost:8000
npm run dev
```

Open `http://localhost:5173` → register or login → `/app`.

---

## Appendix B — Auth API reference

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/auth/send-code` | No | `{ email }` | `{ message }` |
| POST | `/auth/verify-code` | No | `{ email, code }` | `{ signup_token, message }` |
| POST | `/auth/complete-signup` | No | `{ signup_token, name, password }` | `{ user, accessToken }` + refresh cookie |
| POST | `/auth/login` | No | `{ email, password }` | `{ user, accessToken }` + refresh cookie |
| POST | `/auth/refresh` | Cookie | — | `{ accessToken }` (+ user in handler, fix schema) |
| POST | `/auth/logout` | Cookie | — | `{ message }` |
| GET | `/auth/me` | Bearer | — | `UserOut` |
| GET | `/auth/google/login` | No | — | 302 redirect to Google |
| GET | `/auth/google/callback` | No | query `code` | 302 redirect to frontend with token hash |

---

## Appendix C — Frontend route map

| Path | Component | Auth |
|------|-----------|------|
| `/login` | Login | Public |
| `/register` | Register | Public |
| `/oauth-success` | OAuthSuccess | Public |
| `/app` | AppLayout → EmptyState | Protected |
| `/app/:id` | AppLayout → ConversationPage | Protected |
| `/report/:id` | ReportPage | Protected |
| `*` | Redirect → `/login` | — |

---

*End of handoff document.*
