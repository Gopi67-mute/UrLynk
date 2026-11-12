from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import UserProfile


def get_by_clerk_user_id(session: Session, clerk_user_id: str) -> UserProfile | None:
    return session.scalars(
        select(UserProfile).where(UserProfile.clerk_user_id == clerk_user_id)
    ).one_or_none()


def insert_if_absent(session: Session, clerk_user_id: str) -> None:
    """Create the profile unless one already exists.

    ON CONFLICT DO NOTHING with no named target covers every unique index on the table.
    When a concurrent first login is mid-insert, this statement waits for that
    transaction and then does nothing, so the caller's follow-up read finds its row
    instead of hitting a duplicate-key error.
    """
    session.execute(
        insert(UserProfile).values(clerk_user_id=clerk_user_id).on_conflict_do_nothing()
    )
