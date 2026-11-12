import pytest
from conftest import ISSUER, make_settings
from pydantic import ValidationError

from app.core.config import Settings


def test_missing_required_settings_are_reported(monkeypatch) -> None:
    for name in ("DATABASE_URL", "CLERK_ISSUER"):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None)  # type: ignore[call-arg]

    missing = {error["loc"][0] for error in excinfo.value.errors()}
    assert missing == {"database_url", "clerk_issuer"}


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@db:5432/x", "postgresql+psycopg://u:p@db:5432/x"),
        ("postgresql://u:p@db:5432/x", "postgresql+psycopg://u:p@db:5432/x"),
        ("postgresql+psycopg://u:p@db:5432/x", "postgresql+psycopg://u:p@db:5432/x"),
    ],
)
def test_database_url_uses_psycopg_driver(given: str, expected: str) -> None:
    assert make_settings(database_url=given).database_url.get_secret_value() == expected


@pytest.mark.parametrize("url", ["sqlite:///x.db", "mysql://u:p@db/x", "not a url"])
def test_non_postgres_database_url_is_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url=url)


def test_database_password_is_hidden_from_repr() -> None:
    settings = make_settings(database_url="postgresql://u:s3cret-pass@db:5432/x")
    assert "s3cret-pass" not in repr(settings)
    assert "s3cret-pass" not in str(settings.model_dump())


@pytest.mark.parametrize(
    "issuer", ["http://insecure.clerk.accounts.dev", "vocal.clerk.accounts.dev", "https://"]
)
def test_issuer_must_be_https(issuer: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(clerk_issuer=issuer)


def test_jwks_url_defaults_to_issuer_well_known() -> None:
    settings = make_settings(clerk_issuer=ISSUER + "/")
    assert settings.clerk_issuer == ISSUER
    assert settings.resolved_jwks_url == f"{ISSUER}/.well-known/jwks.json"


def test_explicit_jwks_url_must_be_https() -> None:
    with pytest.raises(ValidationError):
        make_settings(clerk_jwks_url="http://example.com/jwks.json")


def test_comma_separated_lists_are_parsed_from_env(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://a.test, https://b.test,")
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "https://a.test")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origins == ["https://a.test", "https://b.test"]
    assert settings.clerk_authorized_parties == ["https://a.test"]


def test_empty_cors_origins_means_no_cors(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "")
    assert Settings(_env_file=None).cors_origins == []  # type: ignore[call-arg]


def test_wildcard_cors_is_rejected_in_production() -> None:
    with pytest.raises(ValidationError):
        make_settings(app_env="production", cors_origins=["*"])


def test_unknown_app_env_is_rejected() -> None:
    with pytest.raises(ValidationError):
        make_settings(app_env="staging-ish")


@pytest.mark.parametrize("field", ["db_pool_size", "db_connect_timeout_seconds"])
def test_pool_settings_must_be_positive(field: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(**{field: 0})
