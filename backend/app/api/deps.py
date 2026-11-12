"""Reusable request dependencies."""

import logging

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.security import (
    AuthenticatedUser,
    ClerkTokenVerifier,
    KeySetUnavailableError,
    TokenError,
)
from app.db.session import get_db
from app.models import Team
from app.repositories import team_repository

logger = logging.getLogger("app.auth")

_bearer = HTTPBearer(auto_error=False, description="Clerk session token")
_CHALLENGE = {"WWW-Authenticate": "Bearer"}


def get_token_verifier(request: Request) -> ClerkTokenVerifier:
    return request.app.state.token_verifier


# Deliberately a sync function: a JWKS refresh is a blocking HTTP call, and FastAPI runs
# sync dependencies in its thread pool instead of on the event loop.
def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    verifier: ClerkTokenVerifier = Depends(get_token_verifier),
) -> AuthenticatedUser:
    """The caller's identity, taken only from a verified Clerk token. 401 otherwise."""
    if credentials is None:
        raise ApiError(401, "not_authenticated", "Sign in to continue.", headers=_CHALLENGE)

    try:
        return verifier.verify(credentials.credentials)
    except TokenError as exc:
        # Only the reason code is logged, never the token or its claims.
        logger.info("Rejected access token: %s", exc.code)
        raise ApiError(401, exc.code, exc.message, headers=_CHALLENGE) from exc
    except KeySetUnavailableError as exc:
        # Not the caller's fault: their token may be fine, so this must not read as a 401.
        logger.error("Cannot verify tokens: Clerk signing keys are unavailable")
        raise ApiError(
            503, "auth_unavailable", "Sign-in checks are temporarily unavailable."
        ) from exc


def get_current_team(
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> Team:
    """The caller's own team, resolved from the verified token subject.

    This is the single gate for every team-scoped endpoint. No request ever supplies a
    team identifier, so there is nothing for a caller to tamper with: the worst they
    can do is ask about a member ID that is not in their own team, which reads as 404.

    404 (not 403) when the team does not exist yet: the app answers it by calling
    POST /api/v1/auth/initialize.
    """
    team = team_repository.get_by_clerk_user_id(session, user.clerk_user_id)
    if team is None:
        raise ApiError(
            404,
            "team_not_initialized",
            "Your team hasn't been set up yet.",
        )
    return team
