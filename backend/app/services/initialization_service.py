"""First-login setup: one profile, one private team, one root member — idempotently."""

import logging

from sqlalchemy.orm import Session

from app.models import Member, Team
from app.repositories import member_repository, team_repository, user_repository
from app.schemas.team import TEAM_NAME_MAX_LENGTH

logger = logging.getLogger("app.initialization")

DEFAULT_LEADER_NAME = "Team Leader"
DEFAULT_TEAM_NAME = "My Team"


def _derive_team_name(display_name: str | None) -> str:
    if not display_name:
        return DEFAULT_TEAM_NAME
    return f"{display_name}'s Team"[:TEAM_NAME_MAX_LENGTH]


def initialize_account(
    session: Session,
    *,
    clerk_user_id: str,
    display_name: str | None = None,
    team_name: str | None = None,
) -> tuple[Team, Member]:
    """Return the caller's team and root member, creating them on a first login.

    Safe to call on every sign-in and safe to call twice at once:

    - all three inserts use ON CONFLICT DO NOTHING, so a duplicate request creates
      nothing and reads back what the winner wrote;
    - `teams.owner_user_id` is unique and `members (team_id) WHERE is_root` is a
      unique index, so the database — not this function — is what guarantees one team
      and one root per leader;
    - everything happens in one transaction, so a failure part-way through cannot
      leave a profile without a team or a team without its root member.

    `display_name` and `team_name` are labels for a first-time setup and are ignored
    afterwards: repeating the call never renames anything.
    """
    user_repository.insert_if_absent(session, clerk_user_id)
    profile = user_repository.get_by_clerk_user_id(session, clerk_user_id)
    if profile is None:  # pragma: no cover - the insert above guarantees a row
        raise RuntimeError("Profile was neither created nor found during initialization")

    team_repository.insert_if_absent(
        session, profile.id, team_name or _derive_team_name(display_name)
    )
    team = team_repository.get_by_owner(session, profile.id)
    if team is None:  # pragma: no cover - the insert above guarantees a row
        raise RuntimeError("Team was neither created nor found during initialization")

    member_repository.insert_root_if_absent(
        session, team.id, profile.id, display_name or DEFAULT_LEADER_NAME
    )
    root_member = member_repository.get_root(session, team.id)
    if root_member is None:  # pragma: no cover - the insert above guarantees a row
        raise RuntimeError("Root member was neither created nor found during initialization")

    session.commit()
    # No identifiers or names: an initialization log line must not describe the account.
    logger.info("Account initialization completed")
    return team, root_member
