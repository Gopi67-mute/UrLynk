"""Shared test fixtures.

Tests never use real credentials: tokens are signed with throwaway RSA keys served from a
fake JWKS, and the database URL is either deliberately unreachable or TEST_DATABASE_URL.
"""

import os

# Set before any `app` import: app.main builds a module-level app from the environment,
# and these values must win over a developer's backend/.env.
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "postgresql://test:test@127.0.0.1:1/unreachable"
os.environ["CLERK_ISSUER"] = "https://test-instance.clerk.accounts.dev"
os.environ["CORS_ORIGINS"] = ""

import itertools  # noqa: E402
import time  # noqa: E402
from collections.abc import Callable, Iterator  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

import jwt  # noqa: E402
import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jwt.algorithms import RSAAlgorithm  # noqa: E402
from sqlalchemy import Engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from alembic import command  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.security import ClerkTokenVerifier, JwksCache  # noqa: E402
from app.db.session import create_db_engine, create_session_factory  # noqa: E402
from app.main import create_app  # noqa: E402

ISSUER = "https://test-instance.clerk.accounts.dev"
UNREACHABLE_DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unreachable"
USER_ID = "user_2abcDEF123"
SESSION_ID = "sess_2xyz789"

# Every member needs a Mi Lifestyle ID, and it has to be unique within its team. A
# session-wide counter is simpler than per-test bookkeeping and cannot collide, and the
# zero padding keeps each one a valid ten digits — including the leading zeros that are
# the reason these are text and never numbers.
_mi_lifestyle_ids = itertools.count(1)


def next_mi_lifestyle_id() -> str:
    """A unique, valid ten-digit Mi Lifestyle ID for a test member."""
    return f"{next(_mi_lifestyle_ids):010d}"


@dataclass
class SigningKey:
    kid: str
    private_key: rsa.RSAPrivateKey

    def public_jwk(self) -> dict[str, Any]:
        jwk = RSAAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        return {**jwk, "kid": self.kid, "alg": "RS256", "use": "sig"}


def _new_key(kid: str) -> SigningKey:
    return SigningKey(kid, rsa.generate_private_key(public_exponent=65537, key_size=2048))


@pytest.fixture(scope="session")
def clerk_key() -> SigningKey:
    return _new_key("clerk-key-1")


@pytest.fixture(scope="session")
def rotated_key() -> SigningKey:
    return _new_key("clerk-key-2")


@pytest.fixture(scope="session")
def attacker_key() -> SigningKey:
    # Reuses Clerk's kid, so only the signature check can catch it.
    return _new_key("clerk-key-1")


@dataclass
class FakeJwks:
    """A controllable stand-in for Clerk's JWKS endpoint."""

    keys: list[SigningKey]
    fail: bool = False
    calls: int = field(default=0)

    def __call__(self) -> dict[str, Any]:
        self.calls += 1
        if self.fail:
            import httpx

            raise httpx.ConnectError("JWKS unreachable")
        return {"keys": [key.public_jwk() for key in self.keys]}


@pytest.fixture
def fake_jwks(clerk_key: SigningKey) -> FakeJwks:
    return FakeJwks(keys=[clerk_key])


@pytest.fixture
def token_factory(clerk_key: SigningKey) -> Callable[..., str]:
    def make(
        *,
        key: SigningKey | None = None,
        algorithm: str = "RS256",
        headers: dict[str, Any] | None = None,
        drop: tuple[str, ...] = (),
        **claims: Any,
    ) -> str:
        key = key or clerk_key
        now = int(time.time())
        payload: dict[str, Any] = {
            "iss": ISSUER,
            "sub": USER_ID,
            "sid": SESSION_ID,
            "iat": now - 10,
            "nbf": now - 10,
            "exp": now + 60,
            "v": 2,
        }
        payload.update(claims)
        for name in drop:
            payload.pop(name, None)
        return jwt.encode(
            payload,
            key.private_key,
            algorithm=algorithm,
            headers={"kid": key.kid, **(headers or {})},
        )

    return make


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "app_env": "test",
        "database_url": UNREACHABLE_DATABASE_URL,
        "clerk_issuer": ISSUER,
        "db_connect_timeout_seconds": 2,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def verifier(fake_jwks: FakeJwks) -> ClerkTokenVerifier:
    return ClerkTokenVerifier(JwksCache(fake_jwks), issuer=ISSUER)


@pytest.fixture
def client(settings: Settings, verifier: ClerkTokenVerifier) -> Iterator[TestClient]:
    app = create_app(settings, token_verifier=verifier)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


# --- real PostgreSQL ---------------------------------------------------------------
#
# These fixtures run only when TEST_DATABASE_URL is set, and only against a database
# whose name contains "test", because they migrate the schema down and up and truncate
# every table between tests. Never point TEST_DATABASE_URL at real data.

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

requires_database = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set (see backend/README.md)"
)

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Truncating the owning table cascades to teams and members.
TRUNCATE_ALL = "TRUNCATE user_profiles, teams, members CASCADE"


@pytest.fixture(scope="session")
def db_settings() -> Settings:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    settings = make_settings(database_url=TEST_DATABASE_URL)
    database = make_url(settings.database_url.get_secret_value()).database or ""
    if "test" not in database.lower():
        pytest.fail("TEST_DATABASE_URL must name a database containing 'test'")
    return settings


@pytest.fixture(scope="session")
def alembic_config(db_settings: Settings) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.attributes["database_url"] = db_settings.database_url.get_secret_value()
    return config


@pytest.fixture(scope="session")
def db_engine(db_settings: Settings, alembic_config: Config) -> Iterator[Engine]:
    """A migrated test database, built once per test session."""
    command.downgrade(alembic_config, "base")
    command.upgrade(alembic_config, "head")
    engine = create_db_engine(db_settings)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(db_engine: Engine) -> Iterator[sessionmaker[Session]]:
    """Sessions against an empty database: every test starts with no rows."""
    with db_engine.begin() as connection:
        connection.execute(text(TRUNCATE_ALL))
    yield create_session_factory(db_engine)


@pytest.fixture
def api_client(
    db_settings: Settings, verifier: ClerkTokenVerifier, session_factory: sessionmaker[Session]
) -> Iterator[TestClient]:
    """A TestClient wired to the test database (and to an empty one, per test)."""
    app = create_app(db_settings, token_verifier=verifier)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@dataclass(frozen=True)
class Leader:
    """A signed-in leader: their Clerk subject and a ready Authorization header."""

    clerk_user_id: str
    headers: dict[str, str]


@pytest.fixture
def leader(token_factory: Callable[..., str]) -> Leader:
    return _leader(token_factory, "user_leader_a")


@pytest.fixture
def other_leader(token_factory: Callable[..., str]) -> Leader:
    return _leader(token_factory, "user_leader_b")


def _leader(token_factory: Callable[..., str], clerk_user_id: str) -> Leader:
    token = token_factory(sub=clerk_user_id)
    return Leader(clerk_user_id, {"Authorization": f"Bearer {token}"})
