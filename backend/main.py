import logging
import sys
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine, ensure_schema_upgrades
from services import db_models  # noqa: F401
from services.kokoro_launcher import ensure_kokoro_running
from services import rag_engine
from services import face_analyzer
from services import emotion_model
from services import tts_service
from routers import auth, conversations, messages, transcribe, audio, ws, analytics
from config import settings

def _configure_coach_logging() -> None:
    """Make the `coach.*` loggers' INFO lines actually reach the console."""
    coach_log = logging.getLogger("coach")
    if coach_log.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    coach_log.addHandler(handler)
    coach_log.setLevel(logging.INFO)
    coach_log.propagate = False


_configure_coach_logging()

Base.metadata.create_all(bind=engine)
ensure_schema_upgrades()


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=ensure_kokoro_running, daemon=True).start()

    def _warm_models() -> None:
        transcribe.warmup()
        rag_engine.warmup()
        face_analyzer.warmup()
        emotion_model.warmup()
        tts_service.warmup_silma_local()

    threading.Thread(target=_warm_models, daemon=True).start()
    yield


app = FastAPI(title="Solace", lifespan=lifespan)

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
app.include_router(analytics.router)
app.include_router(ws.router)


@app.get("/")
def root():
    return {"status": "ok"}
