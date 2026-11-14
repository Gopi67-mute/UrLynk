import uuid

from sqlalchemy import select, text
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


def lock_structure(session: Session, team_id: uuid.UUID) -> None:
    """Take the team's structural lock, held until the transaction ends.

    One lock per team, and it is the *first* thing every operation that changes the
    binary structure acquires: registering a member, deleting one, and the reorganizing
    deletion that moves a subtree. Two such operations in the same team are therefore
    serialized, while different teams never wait for each other.

    Locking individual member rows is not enough on its own. Reorganization chooses a
    destination by searching a whole subtree for its first free slot, and a registration
    under *any* member in that subtree could fill that slot between the search and the
    write — a row this operation never read, and so could not have locked. The team-level
    lock is what closes that gap.

    It is also what keeps the locking order consistent: team lock first, member rows
    after, in every structural operation. Nothing acquires them the other way round, so
    there is no cycle for two transactions to deadlock on.

    The lock is the team's own row. `teams` is never updated by these operations, so
    this blocks no read: `get_by_clerk_user_id` and the dashboard are unaffected.
    """
    session.execute(
        text("SELECT 1 FROM teams WHERE id = :team_id FOR UPDATE"), {"team_id": team_id}
    )


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
