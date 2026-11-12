"""Clerk token verification and the protected /api/v1/me endpoint."""

import base64
import hashlib
import hmac
import json
import time
from collections.abc import Callable

import pytest
from conftest import ISSUER, SESSION_ID, USER_ID, FakeJwks, SigningKey, make_settings
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient

from app.core.security import (
    MAX_TOKEN_LENGTH,
    ClerkTokenVerifier,
    JwksCache,
    KeySetUnavailableError,
    TokenError,
)
from app.main import create_app

TokenFactory = Callable[..., str]


def _get_me(client: TestClient, token: str | None):
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.get("/api/v1/me", headers=headers)


def _assert_401(response, code: str) -> None:
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    error = response.json()["error"]
    assert error["code"] == code
    assert set(error) == {"code", "message", "request_id"}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


# --- /api/v1/me -------------------------------------------------------------------------


def test_valid_token_returns_verified_identity(client: TestClient, token_factory) -> None:
    response = _get_me(client, token_factory())

    assert response.status_code == 200
    assert response.json() == {"clerk_user_id": USER_ID, "session_id": SESSION_ID}


def test_identity_comes_from_token_not_from_client_input(client: TestClient, token_factory) -> None:
    response = client.get(
        "/api/v1/me?clerk_user_id=user_attacker",
        headers={
            "Authorization": f"Bearer {token_factory()}",
            "X-User-Id": "user_attacker",
            "X-Clerk-User-Id": "user_attacker",
        },
    )

    assert response.status_code == 200
    assert response.json()["clerk_user_id"] == USER_ID


def test_missing_bearer_token_is_rejected(client: TestClient) -> None:
    _assert_401(_get_me(client, None), "not_authenticated")


def test_non_bearer_scheme_is_rejected(client: TestClient, token_factory) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": f"Basic {token_factory()}"})
    _assert_401(response, "not_authenticated")


@pytest.mark.parametrize("token", ["garbage", "a.b.c", "", "Bearer"])
def test_malformed_token_is_rejected(client: TestClient, token: str) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_expired_token_is_rejected(client: TestClient, token_factory) -> None:
    now = int(time.time())
    token = token_factory(iat=now - 120, nbf=now - 120, exp=now - 60)
    _assert_401(_get_me(client, token), "token_expired")


def test_expiry_within_leeway_is_accepted(client: TestClient, token_factory) -> None:
    # Tolerates small clock differences between Clerk and this server (default 5 s).
    token = token_factory(exp=int(time.time()) - 2)
    assert _get_me(client, token).status_code == 200


def test_token_not_yet_valid_is_rejected(client: TestClient, token_factory) -> None:
    now = int(time.time())
    token = token_factory(nbf=now + 120, iat=now, exp=now + 300)
    _assert_401(_get_me(client, token), "invalid_token")


def test_token_from_another_issuer_is_rejected(client: TestClient, token_factory) -> None:
    token = token_factory(iss="https://other-instance.clerk.accounts.dev")
    _assert_401(_get_me(client, token), "invalid_token")


def test_token_signed_by_unknown_key_with_known_kid_is_rejected(
    client: TestClient, token_factory, attacker_key: SigningKey
) -> None:
    _assert_401(_get_me(client, token_factory(key=attacker_key)), "invalid_token")


def test_tampered_payload_is_rejected(client: TestClient, token_factory) -> None:
    header, _, signature = token_factory().split(".")
    forged = _b64url(
        json.dumps(
            {"sub": "user_attacker", "iss": ISSUER, "exp": 9999999999, "iat": int(time.time())}
        ).encode()
    )
    _assert_401(_get_me(client, f"{header}.{forged}.{signature}"), "invalid_token")


@pytest.mark.parametrize("claim", ["exp", "iat", "iss", "sub"])
def test_token_missing_required_claim_is_rejected(
    client: TestClient, token_factory, claim: str
) -> None:
    _assert_401(_get_me(client, token_factory(drop=(claim,))), "invalid_token")


@pytest.mark.parametrize("subject", ["", 12345, "x" * 256])
def test_unusable_subject_is_rejected(client: TestClient, token_factory, subject) -> None:
    _assert_401(_get_me(client, token_factory(sub=subject)), "invalid_token")


def test_unsigned_alg_none_token_is_rejected(client: TestClient, clerk_key: SigningKey) -> None:
    header = _b64url(json.dumps({"alg": "none", "typ": "JWT", "kid": clerk_key.kid}).encode())
    payload = _b64url(
        json.dumps(
            {"sub": USER_ID, "iss": ISSUER, "exp": 9999999999, "iat": int(time.time())}
        ).encode()
    )
    _assert_401(_get_me(client, f"{header}.{payload}."), "invalid_token")


def test_hs256_signed_with_public_key_is_rejected(
    client: TestClient, clerk_key: SigningKey
) -> None:
    """Algorithm confusion: an HMAC 'signed' with the RSA public key must not verify."""
    public_pem = clerk_key.private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT", "kid": clerk_key.kid}).encode())
    payload = _b64url(
        json.dumps(
            {"sub": USER_ID, "iss": ISSUER, "exp": 9999999999, "iat": int(time.time())}
        ).encode()
    )
    signature = hmac.new(public_pem, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    _assert_401(_get_me(client, f"{header}.{payload}.{_b64url(signature)}"), "invalid_token")


def test_token_without_kid_is_rejected(client: TestClient, token_factory) -> None:
    import jwt

    token = token_factory()
    header = jwt.get_unverified_header(token)
    assert header["kid"]
    # Rebuild the header without a kid; the signature is irrelevant because it is
    # rejected before any key lookup.
    _, payload, signature = token.split(".")
    no_kid = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    _assert_401(_get_me(client, f"{no_kid}.{payload}.{signature}"), "invalid_token")


def test_oversized_token_is_rejected_before_parsing(client: TestClient) -> None:
    _assert_401(_get_me(client, "a" * (MAX_TOKEN_LENGTH + 1)), "invalid_token")


def test_pending_session_is_rejected(client: TestClient, token_factory) -> None:
    _assert_401(_get_me(client, token_factory(sts="pending")), "session_pending")


def test_active_session_status_is_accepted(client: TestClient, token_factory) -> None:
    assert _get_me(client, token_factory(sts="active")).status_code == 200


def test_rejection_does_not_echo_the_token(client: TestClient, token_factory) -> None:
    now = int(time.time())
    token = token_factory(exp=now - 60, iat=now - 120, nbf=now - 120)
    response = _get_me(client, token)
    assert token not in response.text
    assert USER_ID not in response.text


def test_unavailable_jwks_returns_503_not_401(settings, fake_jwks: FakeJwks, token_factory) -> None:
    fake_jwks.fail = True
    app = create_app(
        settings, token_verifier=ClerkTokenVerifier(JwksCache(fake_jwks), issuer=ISSUER)
    )
    with TestClient(app) as client:
        response = _get_me(client, token_factory())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "auth_unavailable"


# --- authorized parties (azp) -----------------------------------------------------------


@pytest.fixture
def azp_client(fake_jwks: FakeJwks):
    verifier = ClerkTokenVerifier(
        JwksCache(fake_jwks), issuer=ISSUER, authorized_parties=["https://app.urlynk.test"]
    )
    app = create_app(make_settings(), token_verifier=verifier)
    with TestClient(app) as client:
        yield client


def test_matching_azp_is_accepted(azp_client: TestClient, token_factory) -> None:
    assert _get_me(azp_client, token_factory(azp="https://app.urlynk.test")).status_code == 200


def test_foreign_azp_is_rejected(azp_client: TestClient, token_factory) -> None:
    _assert_401(_get_me(azp_client, token_factory(azp="https://evil.test")), "invalid_token")


def test_missing_azp_is_accepted(azp_client: TestClient, token_factory) -> None:
    # Clerk omits azp when the request had no Origin header, as in native apps.
    assert _get_me(azp_client, token_factory()).status_code == 200


# --- JWKS cache and key rotation --------------------------------------------------------


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_keys_are_cached_between_requests(fake_jwks: FakeJwks, token_factory) -> None:
    verifier = ClerkTokenVerifier(JwksCache(fake_jwks), issuer=ISSUER)
    for _ in range(5):
        verifier.verify(token_factory())
    assert fake_jwks.calls == 1


def test_rotated_key_is_fetched_on_unknown_kid(
    fake_jwks: FakeJwks, token_factory, rotated_key: SigningKey
) -> None:
    clock = FakeClock()
    verifier = ClerkTokenVerifier(
        JwksCache(fake_jwks, min_refresh_interval_seconds=60, clock=clock), issuer=ISSUER
    )
    verifier.verify(token_factory())  # loads the original key
    fake_jwks.keys.append(rotated_key)  # Clerk publishes a new key
    clock.now += 61

    user = verifier.verify(token_factory(key=rotated_key))

    assert user.clerk_user_id == USER_ID
    assert fake_jwks.calls == 2


def test_unknown_kid_refreshes_are_rate_limited(
    fake_jwks: FakeJwks, token_factory, rotated_key: SigningKey
) -> None:
    clock = FakeClock()
    verifier = ClerkTokenVerifier(
        JwksCache(fake_jwks, min_refresh_interval_seconds=60, clock=clock), issuer=ISSUER
    )
    verifier.verify(token_factory())

    for _ in range(20):  # rotated_key is not published, so each lookup misses
        with pytest.raises(TokenError):
            verifier.verify(token_factory(key=rotated_key))

    assert fake_jwks.calls == 1


def test_cache_refreshes_after_ttl(fake_jwks: FakeJwks) -> None:
    clock = FakeClock()
    cache = JwksCache(fake_jwks, ttl_seconds=3600, clock=clock)
    cache.get_signing_key("clerk-key-1")
    clock.now += 3601
    cache.get_signing_key("clerk-key-1")
    assert fake_jwks.calls == 2


def test_known_keys_survive_a_failed_refresh(fake_jwks: FakeJwks) -> None:
    clock = FakeClock()
    cache = JwksCache(fake_jwks, ttl_seconds=3600, clock=clock)
    assert cache.get_signing_key("clerk-key-1") is not None

    fake_jwks.fail = True
    clock.now += 3601
    assert cache.get_signing_key("clerk-key-1") is not None  # stale key still served
    assert cache.get_signing_key("clerk-key-1") is not None
    assert fake_jwks.calls == 2  # the failed refresh is not retried immediately


def test_no_keys_at_all_raises_unavailable(fake_jwks: FakeJwks) -> None:
    fake_jwks.fail = True
    cache = JwksCache(fake_jwks)
    with pytest.raises(KeySetUnavailableError):
        cache.get_signing_key("clerk-key-1")
    with pytest.raises(KeySetUnavailableError):
        cache.get_signing_key("clerk-key-1")
    assert fake_jwks.calls == 1


def test_non_rs256_keys_in_jwks_are_ignored(clerk_key: SigningKey) -> None:
    def fetch():
        return {
            "keys": [
                {**clerk_key.public_jwk(), "alg": "RS512", "kid": "other-alg"},
                {"kty": "oct", "k": _b64url(b"secret"), "kid": "symmetric", "alg": "HS256"},
                clerk_key.public_jwk(),
            ]
        }

    cache = JwksCache(fetch)
    assert cache.get_signing_key("other-alg") is None
    assert cache.get_signing_key("symmetric") is None
    assert cache.get_signing_key("clerk-key-1") is not None
