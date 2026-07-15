# AI Coach — Project Architecture Report

**Generated:** 2026-07-01  
**Project:** AI-Powered Communication Coach  
**Stack:** FastAPI + React + SQLite + ChromaDB + faster-whisper + Llama 3.1 70B

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Frontend Layer](#3-frontend-layer)
4. [Backend Layer](#4-backend-layer)
5. [LLM / AI Coach Layer](#5-llm--ai-coach-layer)
6. [Speech Pipeline](#6-speech-pipeline)
7. [RAG Knowledge Base](#7-rag-knowledge-base)
8. [Scenario System](#8-scenario-system)
9. [Training Pipeline](#9-training-pipeline)
10. [Data Collected So Far](#10-data-collected-so-far)
11. [Implementation Status](#11-implementation-status)
12. [Known Gaps & Next Steps](#12-known-gaps--next-steps)

---

## 1. System Overview

The AI Coach is a full-stack application that helps users practice communication skills through AI-powered role-play conversations. Users can choose from three coaching modes (psychology, professional, sport) and practice with structured scenarios. The system supports:

- **Text-based coaching** (M3 — implemented)
- **Voice transcription** (M4 — partially implemented, model being downloaded)
- **RAG-enhanced responses** (M5 — knowledge base built, not yet wired)
- **Vocal metrics analysis** (M4 — schema ready, not yet implemented)
- **Coaching reports** (M3 — basic implementation, needs real analysis pipeline)

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                      │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Auth     │  │ Conv     │  │ Message  │  │ Audio Recorder    │  │
│  │ Store    │  │ Store    │  │ Store    │  │ (MediaRecorder)   │  │
│  │ (Zustand)│  │(Zustand) │  │(Zustand) │  │                   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │              │                 │             │
│  ┌────▼──────────────▼──────────────▼─────────────────▼──────────┐ │
│  │                    API Services Layer                          │ │
│  │  authApi.js │ convApi.js │ messageApi.js (incl. transcribe)   │ │
│  └──────────────────────────────┬─────────────────────────────────┘ │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │ HTTP (fetch, credentials: include)
                                  │
┌─────────────────────────────────┼───────────────────────────────────┐
│                    BACKEND (FastAPI)                                │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ /auth/*      │  │ /conversations/* │  │ /transcribe/*        │  │
│  │ (JWT, OAuth) │  │ (CRUD, messages) │  │ (faster-whisper)     │  │
│  └──────┬───────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│         │                   │                        │              │
│  ┌──────▼───────────────────▼────────────────────────▼───────────┐  │
│  │                    Services Layer                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │
│  │  │ Security │  │ LLM      │  │ Email    │  │ DB Models    │  │  │
│  │  │ (JWT)    │  │ (OpenAI) │  │ (SMTP)   │  │ (SQLAlchemy) │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                             │                                       │
│  ┌──────────────────────────▼────────────────────────────────────┐  │
│  │                    Data Layer                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │  │
│  │  │ SQLite       │  │ ChromaDB     │  │ Scenarios (JSON)   │  │  │
│  │  │ (ai_coach.db)│  │ (coaching_kb)│  │ (5 files)          │  │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    External Services       │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ Token Factory API    │  │
                    │  │ (Llama 3.1 70B)      │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ Google OAuth 2.0     │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ Gmail SMTP           │  │
                    │  └──────────────────────┘  │
                    └────────────────────────────┘
```

---

## 3. Frontend Layer

### 3.1 Tech Stack

| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **Vite** | Build tool & dev server |
| **Zustand** | State management (4 stores) |
| **React Router v6** | Client-side routing |
| **Tailwind CSS** | Utility CSS (configured but minimal usage) |
| **CSS Variables** | Dark theme (ink/bone/gold palette) |

### 3.2 State Stores (Zustand)

| Store | File | Key State |
|---|---|---|
| `authStore` | `stores/authStore.js` | `user`, `accessToken`, `isBootstrapping` |
| `convStore` | `stores/convStore.js` | `conversations[]`, `activeId` |
| `messageStore` | `stores/messageStore.js` | `messages[]`, `loading`, `sending` |

### 3.3 Routing Structure

```
/login              → Login page (email/password + Google OAuth)
/register           → Registration (3-step: send code → verify → complete)
/oauth-success      → Google OAuth callback handler
/app                → Protected layout (sidebar + main area)
  /app              → Empty state ("Select a conversation")
  /app/:id          → Conversation page (chat interface)
/report/:id         → Coaching report page
```

### 3.4 Key Components

| Component | File | Purpose |
|---|---|---|
| `AppLayout` | `layouts/AppLayout.jsx` | Sidebar + main area shell |
| `ConvTopbar` | `components/topbar/ConvTopbar.jsx` | Scenario info header |
| `InputBar` | `components/chat/InputBar.jsx` | Text input + mic/video toggles |
| `MessageList` | `components/chat/MessageList.jsx` | Chat message display |
| `WaveformViz` | `components/chat/WaveformViz.jsx` | Audio waveform visualization |
| `AIStatus` | `components/chat/AIStatus.jsx` | "Thinking" / "Listening" indicator |
| `ModePicker` | `components/chat/ModePicker.jsx` | Coaching mode selector pill |
| `NewConvButton` | `components/sidebar/NewConvButton.jsx` | Create new conversation |
| `ConvItem` | `components/sidebar/ConvItem.jsx` | Sidebar conversation entry |

### 3.5 Audio Recording Flow

```
User taps mic → getUserMedia({ audio: true })
              → MediaRecorder (audio/webm)
              → onstop → Blob → POST /transcribe/
              → transcript → fills input textarea
              → User reviews & sends as text message
```

**Status:** Implemented. The `useAudioRecorder` hook handles the full flow. The `large-v3-turbo` model is currently being downloaded for improved accuracy.

---

## 4. Backend Layer

### 4.1 Tech Stack

| Technology | Purpose |
|---|---|
| **FastAPI** | Web framework |
| **SQLAlchemy** | ORM |
| **SQLite** | Database (ai_coach.db) |
| **PyJWT (python-jose)** | JWT token handling |
| **passlib (bcrypt)** | Password hashing |
| **httpx** | Async HTTP client (Google OAuth) |

### 4.2 Database Schema (SQLAlchemy Models)

```
┌─────────────────┐       ┌──────────────────────┐
│      User       │       │ PendingVerification  │
├─────────────────┤       ├──────────────────────┤
│ id (PK)         │       │ email (PK)           │
│ email (unique)  │       │ code_hash            │
│ name            │       │ attempts             │
│ password_hash   │       │ expires_at           │
│ is_verified     │       │ verified             │
│ google_id       │       │ verified_at          │
│ created_at      │       │ created_at           │
└────────┬────────┘       └──────────────────────┘
         │ 1
         │
         │ *
┌────────▼────────┐       ┌──────────────────────┐
│  Conversation   │       │   CoachingReport     │
├─────────────────┤ 1    *├──────────────────────┤
│ id (PK)         │◄──────│ id (PK)              │
│ user_id (FK)    │       │ conversation_id (FK) │
│ mode            │       │ user_id (FK)         │
│ title           │       │ summary              │
│ created_at      │       │ strengths (JSON)     │
└────────┬────────┘       │ areas_for_growth     │
         │ 1              │ metrics (JSON)       │
         │                │ created_at           │
         │ *              └──────────────────────┘
┌────────▼────────┐
│    Message      │
├─────────────────┤
│ id (PK)         │
│ conversation_id │
│ role (user|assistant)
│ content         │
│ audio_url       │
│ emotion         │  ← vocal metrics (future)
│ pitch           │
│ energy          │
│ filler_count    │
│ assertiveness   │
│ created_at      │
└─────────────────┘
```

### 4.3 API Endpoints

#### Authentication (`/auth/*`)

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/auth/send-code` | Send 6-digit verification email | ✅ |
| POST | `/auth/verify-code` | Verify code, get signup token | ✅ |
| POST | `/auth/complete-signup` | Create account (name + password) | ✅ |
| POST | `/auth/login` | Email/password login | ✅ |
| POST | `/auth/refresh` | Refresh access token (cookie) | ✅ |
| POST | `/auth/logout` | Clear refresh cookie | ✅ |
| GET | `/auth/me` | Get current user profile | ✅ |
| GET | `/auth/google/login` | Redirect to Google OAuth | ✅ |
| GET | `/auth/google/callback` | Google OAuth callback | ✅ |

#### Conversations (`/conversations/*`)

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/conversations/` | List user's conversations | ✅ |
| POST | `/conversations/` | Create new conversation | ✅ |
| GET | `/conversations/{id}` | Get conversation + messages | ✅ |
| DELETE | `/conversations/{id}` | Delete conversation | ✅ |
| POST | `/conversations/{id}/messages` | Send message (placeholder AI) | ⚠️ Duplicate |
| POST | `/conversations/{id}/end` | End session, generate report | ✅ (basic) |
| GET | `/conversations/{id}/report` | Get coaching report | ✅ (basic) |
| GET | `/conversations/scenarios/list` | List all scenarios | ✅ |
| GET | `/conversations/scenarios/{id}` | Get specific scenario | ✅ |

**Note:** There are two message-sending endpoints — one in `conversations.py` (placeholder) and one in `messages.py` (wired to real LLM). The `messages.py` version is the active one.

#### Transcription (`/transcribe/*`)

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/transcribe/` | Transcribe audio file | ✅ (model downloading) |

### 4.4 Authentication Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Step 1  │────▶│  Step 2  │────▶│  Step 3  │────▶│  Login   │
│ Send Code│     │VerifyCode│     │Complete  │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │                │
     ▼                ▼                ▼                ▼
  POST /auth/      POST /auth/      POST /auth/      POST /auth/
  send-code        verify-code      complete-signup  login
     │                │                │                │
     │                │                │                │
     ▼                ▼                ▼                ▼
  Email with       Returns          Creates user     Returns
  6-digit code     signup_token     + sets cookie    accessToken
                   (JWT, 5min)      + returns        + refresh
                                     accessToken      cookie
```

**Token Strategy:**
- **Access Token:** JWT, 15 min expiry, sent in `Authorization: Bearer` header
- **Refresh Token:** JWT, 7 day expiry, stored in `httpOnly` cookie (`/auth` path)
- **Signup Token:** JWT, 5 min expiry, proves email was verified

---

## 5. LLM / AI Coach Layer

### 5.1 Configuration

| Parameter | Value |
|---|---|
| **Provider** | Token Factory (Esprit) |
| **Base URL** | `https://tokenfactory.esprit.tn/api` |
| **Model** | `hosted_vllm/Llama-3.1-70B-Instruct` |
| **Context Window** | Last 20 messages |
| **Temperature** | 0.7 |
| **Max Tokens** | 512 |

### 5.2 System Prompts

Three coaching modes with distinct personalities:

| Mode | Personality | Focus |
|---|---|---|
| **psy** | Empathetic psychology coach | Emotional intelligence, self-awareness, relationships |
| **professional** | Sharp career coach | Career growth, negotiation, interviews |
| **sport** | Energetic sport coach | Mindset, motivation, mental resilience |

### 5.3 Message Flow

```
User types message
       │
       ▼
POST /conversations/{id}/messages
       │
       ▼
Save user message to DB
       │
       ▼
Build history (last 20 messages)
       │
       ▼
Call get_coach_response(mode, history, user_message)
       │
       ▼
Token Factory API → Llama 3.1 70B
       │
       ▼
Save assistant response to DB
       │
       ▼
Auto-generate title (if first message)
       │
       ▼
Return [user_msg, assistant_msg]
```

**Status:** ✅ Fully implemented and wired.

---

## 6. Speech Pipeline

### 6.1 Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Browser  │────▶│ Backend  │────▶│ faster-  │
│ Media-   │     │ FastAPI  │     │ whisper  │
│ Recorder │     │          │     │          │
└──────────┘     └──────────┘     └──────────┘
     │                │                │
     ▼                ▼                ▼
  audio/webm       POST /          large-v3-turbo
  Blob             transcribe/     (CUDA, float16)
```

### 6.2 Current Configuration

| Parameter | Value |
|---|---|
| **Model** | `large-v3-turbo` (switched from `base`) |
| **Device** | CUDA |
| **Compute Type** | float16 |
| **Beam Size** | 5 |
| **Supported Formats** | webm, wav, ogg, mp4, mpeg |

### 6.3 Implementation Status

| Component | Status |
|---|---|
| Audio recording (browser) | ✅ Implemented |
| Audio upload endpoint | ✅ Implemented |
| Whisper model (base, CPU) | ✅ Was working |
| Whisper model (large-v3-turbo, CUDA) | 🔄 Downloading |
| Vocal metrics extraction | ❌ Not implemented |
| Real-time transcription | ❌ Not implemented |

**Note:** The `Message` model has columns for vocal metrics (`emotion`, `pitch`, `energy`, `filler_count`, `assertiveness`) but these are not yet populated. This is the M4 milestone.

---

## 7. RAG Knowledge Base

### 7.1 Vector Store

| Parameter | Value |
|---|---|
| **Vector DB** | ChromaDB |
| **Location** | `backend/data/chroma_db` |
| **Collection** | `coaching_kb` |
| **Total Documents** | 603 |
| **Embedding Model** | `intfloat/multilingual-e5-base` |
| **Prefix** | `passage: ` (indexing), `query: ` (retrieval) |
| **Normalization** | L2-normalized |

### 7.2 Collection Pipelines

```
┌─────────────────────────────────────────────────────────────────┐
│                    RAG Collection Pipelines                      │
│                                                                  │
│  Session Guides ────▶ PDFs/HTML ────▶ Text extraction           │
│  (346 chunks)        (SAMHSA, VA,    ───▶ Chunking              │
│                       MI guides,      ───▶ JSONL staging         │
│                       CBT manuals)                               │
│                                                                  │
│  PubMed Abstracts ──▶ PMC E-utilities ──▶ Abstract text          │
│  (158 chunks)        (6 queries)        ───▶ JSONL staging       │
│                                                                  │
│  Web Articles ──────▶ newspaper3k /    ───▶ Article text         │
│  (39 chunks)          BeautifulSoup     ───▶ JSONL staging       │
│                                                                  │
│  Academic Papers ───▶ Unpaywall/       ───▶ PDF text             │
│  (9 targeted)         OpenAlex by DOI   ───▶ JSONL staging       │
│                                                                  │
│  All pipelines ─────▶ embed_and_upsert.py ───▶ ChromaDB          │
│                       (multilingual-e5-base)                     │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Documents by Tier

| Tier | Count | Description |
|---|---|---|
| **session_guide** | 346 | Full therapist manuals, MI guides, CBT protocols |
| **abstract** | 158 | PubMed research abstracts |
| **technique** | 60 | Structured coaching technique descriptions |
| **article** | 39 | Web articles from psychology/coaching sources |
| **signal_mapping** | 0 | (Planned — not yet populated) |
| **Total** | **603** | |

### 7.4 Documents by Mode

| Mode | Count | Description |
|---|---|---|
| **psy** | 364 | Psychology/therapy (MI, CBT, Gottman, NVC, attachment) |
| **sport** | 155 | Sports psychology (self-talk, imagery, flow, anxiety) |
| **professional** | 70 | Professional coaching (negotiation, feedback, assertiveness) |
| **all** | 14 | Cross-mode content (therapeutic alliance repair) |

### 7.5 Key Session Guide Sources

| Source | Chunks |
|---|---|
| SAMHSA TIP 35 — Enhancing Motivation for Change | 159 |
| VA Brief CBT Therapist Manual | 54 |
| VA CBT for Chronic Pain Therapist Manual | 83 |
| Dancing Gecko MI Guided Dialogue | 17 |
| Clinical Consensus — Alliance Rupture Repair | 14 |
| Other sources | 19 |

### 7.6 RAG Integration Status

| Component | Status |
|---|---|
| Knowledge base built (603 docs) | ✅ Complete |
| Embedding pipeline | ✅ Complete |
| Retrieval logic | ❌ Not implemented |
| RAG-enhanced LLM responses | ❌ Not wired |
| Signal mapping tier | ❌ Not populated |

**Note:** The RAG knowledge base is fully built but not yet integrated into the LLM response pipeline. This is the M5 milestone.

---

## 8. Scenario System

### 8.1 Available Scenarios

| Scenario | Mode | Difficulty | Languages |
|---|---|---|---|
| **Boundary Setting** | professional | 2/5 | en, fr, ar |
| **Conflict Resolution** | professional | 3/5 | en, fr, ar |
| **Difficult Feedback** | professional | 3/5 | en, fr, ar |
| **Job Interview** | professional | 2/5 | en, fr, ar |
| **Salary Negotiation** | professional | 3/5 | en, fr, ar |

### 8.2 Scenario Structure

Each scenario JSON includes:

```json
{
  "id": "boundary_setting",
  "title": "Setting Boundaries",
  "description": "Practice saying no to a colleague...",
  "mode": "professional",
  "difficulty": 2,
  "turn_guide": { "min": 8, "max": 12 },
  "languages": ["en", "fr", "ar"],
  "persona": { "name": "Sam", "role": "...", "personality": [...] },
  "context": "...",
  "success_criteria": [...],
  "system_prompt": "You are Sam...",
  "opening_line": { "en": "...", "fr": "...", "ar": "..." },
  "coaching_focus": [...]
}
```

### 8.3 Implementation Status

| Component | Status |
|---|---|
| Scenario JSON files | ✅ 5 scenarios created |
| List scenarios endpoint | ✅ Implemented |
| Get scenario endpoint | ✅ Implemented |
| Scenario-aware system prompts | ❌ Not wired to LLM |
| Scenario-based conversation creation | ❌ Not implemented |

---

## 9. Training Pipeline

### 9.1 Emotion Classifier

| Parameter | Value |
|---|---|
| **Model** | ACNN (Attention-based CNN) |
| **Dataset** | RAVDESS |
| **Task** | Aggression detection |
| **File** | `backend/training/models/best_acnn_aggression_model_ravdess.pkl` |
| **Notebook** | `backend/training/train_expression_classifier.ipynb` |

### 9.2 Implementation Status

| Component | Status |
|---|---|
| Model trained (RAVDESS) | ✅ Complete |
| Model saved (.pkl) | ✅ Complete |
| Integration with message pipeline | ❌ Not implemented |
| Real-time emotion detection | ❌ Not implemented |

---

## 10. Data Collected So Far

### 10.1 RAG Knowledge Base (603 documents)

| Category | Count | Source |
|---|---|---|
| Session guides (psy) | 247 | SAMHSA, VA, MI manuals |
| Session guides (sport) | 85 | Sport psychology guides |
| Session guides (all) | 14 | Alliance rupture repair |
| PubMed abstracts (psy) | 72 | MI, person-centered therapy, alliance |
| PubMed abstracts (professional) | 36 | Executive coaching effectiveness |
| PubMed abstracts (sport) | 50 | Pre-performance routines, self-talk |
| Techniques (psy) | 20 | Structured coaching techniques |
| Techniques (professional) | 20 | Structured coaching techniques |
| Techniques (sport) | 20 | Structured coaching techniques |
| Web articles (psy) | 25 | Gottman, NVC, attachment theory |
| Web articles (professional) | 14 | Negotiation, feedback, assertiveness |

### 10.2 Scenarios (5 JSON files)

| Scenario | Mode | Languages |
|---|---|---|
| Boundary Setting | professional | en, fr, ar |
| Conflict Resolution | professional | en, fr, ar |
| Difficult Feedback | professional | en, fr, ar |
| Job Interview | professional | en, fr, ar |
| Salary Negotiation | professional | en, fr, ar |

### 10.3 Trained Model

| Model | Dataset | Task |
|---|---|---|
| ACNN | RAVDESS | Aggression detection |

### 10.4 User Data (Database)

| Table | Purpose | Status |
|---|---|---|
| `users` | User accounts | Active |
| `pending_verifications` | Email verification flow | Active |
| `conversations` | Coaching sessions | Active |
| `messages` | Chat messages | Active |
| `coaching_reports` | Session reports | Active (basic) |

---

## 11. Implementation Status

### 11.1 Completed (✅)

| Feature | Milestone |
|---|---|
| User authentication (email + Google OAuth) | M2 |
| JWT token management (access + refresh) | M2 |
| Email verification flow | M2 |
| Conversation CRUD | M3 |
| Text-based coaching (Llama 3.1 70B) | M3 |
| Auto-title generation | M3 |
| Coaching report (basic) | M3 |
| Audio recording (browser) | M4 |
| Audio transcription endpoint | M4 |
| RAG knowledge base (603 docs) | M5 |
| Scenario system (5 scenarios) | M5 |
| Emotion classifier trained (RAVDESS) | M4 |

### 11.2 In Progress (🔄)

| Feature | Milestone |
|---|---|
| faster-whisper large-v3-turbo download | M4 |

### 11.3 Not Started (❌)

| Feature | Milestone |
|---|---|
| Vocal metrics extraction (emotion, pitch, energy) | M4 |
| Real-time transcription | M4 |
| RAG-enhanced LLM responses | M5 |
| Scenario-aware system prompts | M5 |
| Signal mapping tier | M5 |
| Video analysis pipeline | M6 |
| Production deployment | M7 |

---

## 12. Known Gaps & Next Steps

### 12.1 Critical Gaps

1. **RAG not wired to LLM** — The knowledge base of 603 documents exists but is never queried during coaching responses. The `llm_service.py` sends plain prompts without RAG context.

2. **Vocal metrics not extracted** — The `Message` model has columns for `emotion`, `pitch`, `energy`, `filler_count`, `assertiveness` but they are always `null`. The trained ACNN model is not integrated.

3. **Scenario system not wired** — Scenarios exist as JSON files with detailed system prompts, but the conversation creation flow doesn't use them. The `conversations.py` router has placeholder AI responses.

4. **Two message endpoints** — Both `conversations.py` (placeholder) and `messages.py` (real LLM) define `POST /{id}/messages`. The `messages.py` version is the active one in `main.py`, but the duplicate could cause confusion.

5. **No `signal_mapping` tier** — 0 documents in the RAG collection for this planned tier.

### 12.2 Recommended Next Steps

| Priority | Task | Effort |
|---|---|---|
| P0 | Wire RAG retrieval into `llm_service.py` | Medium |
| P0 | Integrate vocal metrics extraction after transcription | Medium |
| P1 | Wire scenario system prompts into conversation creation | Small |
| P1 | Remove duplicate message endpoint in `conversations.py` | Small |
| P1 | Add `signal_mapping` documents to RAG collection | Medium |
| P2 | Add sport and psy scenarios | Medium |
| P2 | Implement real coaching report analysis pipeline | Large |
| P3 | Add real-time transcription (streaming) | Large |
| P3 | Docker production deployment | Medium |

---

*End of Report*