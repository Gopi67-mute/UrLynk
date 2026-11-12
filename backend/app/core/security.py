"""Clerk session-token verification against Clerk's published JWKS.

Follows Clerk's manual verification guide
(https://clerk.com/docs/guides/sessions/manual-jwt-verification):
RS256 signature with a key from `<Frontend API>/.well-known/jwks.json`, `exp`/`nbf`,
`azp` when present, and rejection of `pending` sessions. The issuer is also pinned to
the instance's Frontend API URL, which is the `iss` value Clerk documents.

No Clerk secret key is needed: verification uses only public keys.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWK, PyJWKSet
from jwt.exceptions import (
    ExpiredSignatureError,
    ImmatureSignatureError,
    InvalidIssuerError,
    PyJWKSetError,
    PyJWTError,
)

logger = logging.getLogger("app.auth")

# Clerk signs session tokens with RS256. Pinning it blocks algorithm-confusion attacks
# (`alg: none`, or HS256 signed with the public key as an HMAC secret).
ALLOWED_ALGORITHMS = ("RS256",)
# Clerk session tokens are around 1 KB; anything far larger is not one of them.
MAX_TOKEN_LENGTH = 8192
MAX_SUBJECT_LENGTH = 255


class TokenError(Exception):
    """The token is missing, malformed, unverifiable, expired or otherwise unacceptable."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class KeySetUnavailableError(Exception):
    """Clerk's JWKS could not be fetched, so no token can be verified right now."""


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """The identity proven by a verified token. Never built from client-supplied fields."""

    clerk_user_id: str
    session_id: str | None


JwksFetcher = Callable[[], dict[str, Any]]


def http_jwks_fetcher(url: str, timeout_seconds: float) -> JwksFetcher:
    def fetch() -> dict[str, Any]:
        response = httpx.get(url, timeout=timeout_seconds, follow_redirects=False)
        response.raise_for_status()
        return response.json()

    return fetch


class JwksCache:
    """Caches Clerk's signing keys and refreshes them for key rotation.

    Keys are refetched when the cache is older than `ttl_seconds`, or when a token names
    a key ID the cache does not have (Clerk rotated keys). Unknown-key refreshes are
    limited to one per `min_refresh_interval_seconds`, so tokens with made-up key IDs
    cannot make the server hammer Clerk.
    """

    def __init__(
        self,
        fetch: JwksFetcher,
        *,
        ttl_seconds: float = 3600,
        min_refresh_interval_seconds: float = 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetch = fetch
        self._ttl = ttl_seconds
        self._min_refresh_interval = min_refresh_interval_seconds
        self._clock = clock
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None  # last successful fetch
        self._attempted_at: float | None = None  # last fetch attempt, successful or not
        # One fetch at a time: concurrent requests wait for it instead of piling onto Clerk.
        self._lock = threading.Lock()

    def get_signing_key(self, kid: str) -> PyJWK | None:
        """Return the key for `kid`, None if Clerk has no such key.

        Raises KeySetUnavailableError when no keys have ever been loaded.
        """
        with self._lock:
            now = self._clock()
            if self._is_stale(now) and self._may_fetch(now):
                self._refresh(now)
            key = self._keys.get(kid)
            if key is None and self._may_fetch(now):
                self._refresh(now)
                key = self._keys.get(kid)
            if not self._keys:
                raise KeySetUnavailableError
            return key

    def _is_stale(self, now: float) -> bool:
        return self._fetched_at is None or now - self._fetched_at >= self._ttl

    def _may_fetch(self, now: float) -> bool:
        return self._attempted_at is None or now - self._attempted_at >= self._min_refresh_interval

    def _refresh(self, now: float) -> None:
        self._attempted_at = now
        try:
            key_set = PyJWKSet.from_dict(self._fetch())
        except (httpx.HTTPError, ValueError, PyJWKSetError) as exc:
            # Known keys stay in use; the next attempt waits for the minimum interval.
            logger.warning("Could not refresh Clerk JWKS: %s", type(exc).__name__)
            return

        self._keys = {
            key.key_id: key
            for key in key_set.keys
            if key.key_id
            and key.algorithm_name in ALLOWED_ALGORITHMS
            and getattr(key, "public_key_use", None) in (None, "sig")
        }
        self._fetched_at = now
        logger.info("Loaded %d Clerk signing key(s)", len(self._keys))


class ClerkTokenVerifier:
    def __init__(
        self,
        jwks: JwksCache,
        *,
        issuer: str,
        authorized_parties: list[str] | tuple[str, ...] = (),
        leeway_seconds: int = 5,
    ) -> None:
        self._jwks = jwks
        self._issuer = issuer
        self._authorized_parties = frozenset(authorized_parties)
        self._leeway = leeway_seconds

    def verify(self, token: str) -> AuthenticatedUser:
        """Return the verified identity, or raise TokenError / KeySetUnavailableError."""
        if not token or len(token) > MAX_TOKEN_LENGTH:
            raise TokenError("invalid_token", "The access token is invalid.")

        try:
            header = jwt.get_unverified_header(token)
        except PyJWTError as exc:
            raise TokenError("invalid_token", "The access token is invalid.") from exc

        if header.get("alg") not in ALLOWED_ALGORITHMS:
            raise TokenError("invalid_token", "The access token is invalid.")
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise TokenError("invalid_token", "The access token is invalid.")

        signing_key = self._jwks.get_signing_key(kid)
        if signing_key is None:
            raise TokenError("invalid_token", "The access token is invalid.")

        try:
            claims = jwt.decode(
                token,
                key=signing_key.key,
                algorithms=list(ALLOWED_ALGORITHMS),
                issuer=self._issuer,
                leeway=self._leeway,
                options={
                    "require": ["exp", "iat", "iss", "sub"],
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iat": True,
                    "verify_iss": True,
                },
            )
        except ExpiredSignatureError as exc:
            raise TokenError("token_expired", "The access token has expired.") from exc
        except ImmatureSignatureError as exc:
            raise TokenError("invalid_token", "The access token is not valid yet.") from exc
        except InvalidIssuerError as exc:
            raise TokenError("invalid_token", "The access token is invalid.") from exc
        except PyJWTError as exc:
            raise TokenError("invalid_token", "The access token is invalid.") from exc

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject or len(subject) > MAX_SUBJECT_LENGTH:
            raise TokenError("invalid_token", "The access token is invalid.")

        # Per Clerk: check `azp` against permitted origins, skipping when it is absent.
        azp = claims.get("azp")
        if azp is not None and self._authorized_parties and azp not in self._authorized_parties:
            raise TokenError("invalid_token", "The access token is invalid.")

        # Sessions with unfinished tasks are `pending`; Clerk's SDKs treat them as signed out.
        if claims.get("sts") == "pending":
            raise TokenError("session_pending", "Finish signing in before continuing.")

        session_id = claims.get("sid")
        return AuthenticatedUser(
            clerk_user_id=subject,
            session_id=session_id if isinstance(session_id, str) else None,
        )
