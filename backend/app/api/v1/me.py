from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.security import AuthenticatedUser

router = APIRouter(tags=["identity"])


class MeResponse(BaseModel):
    clerk_user_id: str
    session_id: str | None


@router.get("/me", response_model=MeResponse)
def read_me(user: AuthenticatedUser = Depends(get_current_user)) -> MeResponse:
    """The identity proven by the bearer token.

    Read-only and database-free: it confirms that the app's Clerk token reaches the
    backend and verifies, with nothing else in the way. Profile, team and root member
    come from POST /api/v1/auth/initialize; the team itself from GET /api/v1/teams/me.
    """
    return MeResponse(clerk_user_id=user.clerk_user_id, session_id=user.session_id)
