from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from config import settings

_is_sqlite = "sqlite" in settings.database_url

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 15} if _is_sqlite else {},
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
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


_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "users": {
        "last_login_at": "DATETIME",
        "login_count": "INTEGER",
        "last_seen_at": "DATETIME",
    },
    "messages": {
        "text_emotion": "VARCHAR",
        "text_emotion_confidence": "FLOAT",
        "text_emotion_evidence": "VARCHAR",
    },
}


def ensure_schema_upgrades() -> None:
    """Add any missing nullable columns listed in _ADDED_COLUMNS."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    for table, columns in _ADDED_COLUMNS.items():
        if table not in existing_tables:
            continue
        present = {c["name"] for c in inspector.get_columns(table)}
        for name, sql_type in columns.items():
            if name in present:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
                print(f"[db] added column {table}.{name} ({sql_type})")
            except Exception as e:
                print(f"[db] could not add column {table}.{name}: {e}")
