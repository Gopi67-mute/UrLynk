"""Team-level reads: the one summary the Team and Home screens are built on."""

from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import PlacementPosition, Team
from app.repositories import member_repository
from app.schemas.member import MemberSummary
from app.schemas.team import TeamCounts, TeamOverview, TeamSummary


def build_overview(session: Session, team: Team) -> TeamOverview:
    """The team, its root member and its three counts.

    Three small queries, no tree download: the branch sizes come from one recursive
    count in the database, not from loading every member into the API.
    """
    root_member = member_repository.get_root(session, team.id)
    if root_member is None:
        # Initialization creates the root in the same transaction as the team, so this
        # means the data was changed outside the application.
        raise ApiError(409, "team_incomplete", "Your team is missing its leader record.")

    sizes = member_repository.branch_sizes(session, team.id, root_member.id)
    return TeamOverview(
        team=TeamSummary.model_validate(team),
        root_member=MemberSummary.model_validate(root_member),
        counts=TeamCounts(
            total_members=member_repository.count_all(session, team.id),
            left_members=sizes[PlacementPosition.LEFT],
            right_members=sizes[PlacementPosition.RIGHT],
        ),
    )
