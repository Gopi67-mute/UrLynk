import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Team, UserProfile


def get_by_owner(session: Session, owner_user_id: uuid.UUID) -> Team | None:
    return session.scalars(select(Team).where(Team.owner_user_id == owner_user_id)).one_or_none()


def get_by_clerk_user_id(session: Session, clerk_user_id: str) -> Team | None:
    """The caller's own team, resolved from the verified Clerk subject in one query.

    This is the only way a request ever arrives at a team: no endpoint accepts a team
    ID from the client.
    """
    return session.scalars(
        select(Team)
        .join(UserProfile, UserProfile.id == Team.owner_user_id)
        .where(UserProfile.clerk_user_id == clerk_user_id)
    ).one_or_none()


def insert_if_absent(session: Session, owner_user_id: uuid.UUID, team_name: str) -> None:
    """Create the leader's team unless they already have one.

    `teams.owner_user_id` is unique, so this is what makes "one team per leader"
    hold even when two first-login requests arrive at once.
    """
    session.execute(
        insert(Team)
        .values(owner_user_id=owner_user_id, team_name=team_name)
        .on_conflict_do_nothing()
    )
