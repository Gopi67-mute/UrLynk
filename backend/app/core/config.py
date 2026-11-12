"""Validated application settings, read from environment variables (and backend/.env locally)."""

from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_POSTGRES_SCHEMES = ("postgres://", "postgresql://", "postgresql+psycopg://")


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


def _require_https_url(value: str, name: str) -> str:
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc:
        raise ValueError(f"{name} must be an https:// URL")
    return value.rstrip("/")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # SecretStr keeps the URL (and its password) out of reprs, logs and tracebacks.
    database_url: SecretStr
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=5, ge=0, le=50)
    db_pool_timeout_seconds: float = Field(default=10, gt=0, le=60)
    db_connect_timeout_seconds: int = Field(default=5, ge=1, le=60)
    # Sent as a connection startup option; set 0 for poolers that reject startup options.
    db_statement_timeout_ms: int = Field(default=10_000, ge=0)

    clerk_issuer: str
    clerk_jwks_url: str | None = None
    # Allowed values for the token's `azp` claim. Clerk only sets `azp` when the
    # sign-in request carried an Origin header, so native-app tokens may omit it.
    clerk_authorized_parties: Annotated[list[str], NoDecode] = Field(default_factory=list)
    jwt_leeway_seconds: int = Field(default=5, ge=0, le=60)
    jwks_cache_ttl_seconds: int = Field(default=3600, ge=60)
    jwks_min_refresh_interval_seconds: int = Field(default=60, ge=1)
    jwks_fetch_timeout_seconds: float = Field(default=5, gt=0, le=30)

    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    @field_validator("cors_origins", "clerk_authorized_parties", mode="before")
    @classmethod
    def _parse_csv(cls, value: object) -> object:
        return _split_csv(value)

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value().strip()
        if not raw.startswith(_POSTGRES_SCHEMES):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL (postgresql://...)")
        # Hosting providers hand out postgres:// URLs; SQLAlchemy needs the driver named.
        for scheme in ("postgres://", "postgresql://"):
            if raw.startswith(scheme):
                raw = "postgresql+psycopg://" + raw[len(scheme) :]
                break
        return SecretStr(raw)

    @field_validator("clerk_issuer")
    @classmethod
    def _validate_issuer(cls, value: str) -> str:
        return _require_https_url(value.strip(), "CLERK_ISSUER")

    @field_validator("clerk_jwks_url")
    @classmethod
    def _validate_jwks_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return _require_https_url(value.strip(), "CLERK_JWKS_URL")

    @model_validator(mode="after")
    def _check_production_rules(self) -> "Settings":
        if self.app_env == "production" and "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS must list explicit origins in production, not '*'")
        return self

    @property
    def resolved_jwks_url(self) -> str:
        return self.clerk_jwks_url or f"{self.clerk_issuer}/.well-known/jwks.json"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # required values come from the environment
