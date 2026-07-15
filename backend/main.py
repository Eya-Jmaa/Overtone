import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from services import db_models  # noqa: F401
from services.kokoro_launcher import ensure_kokoro_running
from services import rag_engine
from routers import auth, conversations, messages, transcribe, audio, ws
from config import settings

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-start the Kokoro TTS server on a background thread so a first-run
    # image pull never blocks uvicorn startup.
    threading.Thread(target=ensure_kokoro_running, daemon=True).start()
    # Warm the RAG embedding model + Chroma collection off the request path so
    # the first coaching turn doesn't pay the (multi-second) model-load cost.
    threading.Thread(target=rag_engine.warmup, daemon=True).start()
    yield


app = FastAPI(title="ai-coach", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(conversations.router)
app.include_router(messages.router)
app.include_router(transcribe.router)
app.include_router(audio.router)
app.include_router(ws.router)


@app.get("/")
def root():
    return {"status": "ok"}
