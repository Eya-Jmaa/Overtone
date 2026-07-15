from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from config import settings

_is_sqlite = "sqlite" in settings.database_url

engine = create_engine(
    settings.database_url,
    # `timeout` (seconds) is sqlite3's busy_timeout: how long a connection waits
    # for a lock held by another connection before raising "database is locked",
    # instead of failing immediately (the sqlite3 default is 0s). Needed because
    # the WS route (routers/ws.py) holds one session open for the whole
    # connection lifetime, unlike HTTP routes' per-request sessions, so brief
    # lock contention between them is expected.
    connect_args={"check_same_thread": False, "timeout": 15} if _is_sqlite else {},
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # WAL lets readers and a single writer proceed concurrently instead of
        # the default rollback-journal mode's full-database exclusive lock on
        # every write - the main fix for cross-connection lock contention.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=15000")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()