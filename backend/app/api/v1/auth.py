from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import AuthenticatedUser
from app.db.session import get_db
from app.schemas.team import AccountInitializeRequest, TeamOverview
from app.services import initialization_service, team_service

router = APIRouter(prefix="/auth", tags=["account"])


@router.post("/initialize", response_model=TeamOverview)
def initialize_account(
    payload: AccountInitializeRequest | None = None,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> TeamOverview:
    """Make sure the signed-in leader has a profile, a private team and a root member.

    Idempotent: a first login creates all three, and every later call returns the same
    records without creating or renaming anything. The app may call it on any sign-in.

    Returns 200 either way — the same body as `GET /api/v1/teams/me` — so the client
    has one response shape to handle.
    """
    request = payload or AccountInitializeRequest()
    team, _ = initialization_service.initialize_account(
        session,
        clerk_user_id=user.clerk_user_id,
        display_name=request.display_name,
        team_name=request.team_name,
    )
    return team_service.build_overview(session, team)
