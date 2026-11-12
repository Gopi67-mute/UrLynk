"""Engine and session lifecycle. One engine (and connection pool) per process."""

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings


def create_db_engine(settings: Settings) -> Engine:
    connect_args: dict[str, object] = {"connect_timeout": settings.db_connect_timeout_seconds}
    if settings.db_statement_timeout_ms:
        connect_args["options"] = f"-c statement_timeout={settings.db_statement_timeout_ms}"

    # Creating the engine does not connect; the first query opens the first connection.
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=True,  # Replace connections the server or a proxy closed while idle.
        pool_recycle=1800,
        connect_args=connect_args,
        hide_parameters=True,  # Keep bound values out of error messages and logs.
    )


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    # expire_on_commit=False lets handlers read committed objects without another query.
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db(request: Request) -> Iterator[Session]:
    """A session per request. Callers commit explicitly; anything uncommitted rolls back."""
    session: Session = request.app.state.session_factory()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ping_database(session: Session) -> None:
    session.execute(text("SELECT 1"))
