from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_team
from app.db.session import get_db
from app.models import Team
from app.schemas.team import TeamOverview
from app.services import team_service

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("/me", response_model=TeamOverview)
def read_my_team(
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> TeamOverview:
    """The signed-in leader's team, its root member and its member counts.

    404 `team_not_initialized` before the first setup; the app answers that by calling
    POST /api/v1/auth/initialize and retrying.
    """
    return team_service.build_overview(session, team)
