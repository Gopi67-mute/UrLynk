"""Profile photo rows, always reached through the owning team."""

import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import MemberPhoto


def get(session: Session, team_id: uuid.UUID, member_id: uuid.UUID) -> MemberPhoto | None:
    return session.scalars(
        select(MemberPhoto).where(
            MemberPhoto.team_id == team_id, MemberPhoto.member_id == member_id
        )
    ).one_or_none()


def upsert(
    session: Session,
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    *,
    content_type: str,
    image: bytes,
) -> datetime:
    """Store the member's photo, replacing any earlier one. Returns its new timestamp.

    One statement, so a first photo and a replacement are the same operation and two
    concurrent uploads cannot both insert. The timestamp comes back from the database
    rather than being read again, so the caller records exactly what was written.
    """
    statement = insert(MemberPhoto).values(
        member_id=member_id,
        team_id=team_id,
        content_type=content_type,
        image=image,
        byte_size=len(image),
    )
    updated_at = session.execute(
        statement.on_conflict_do_update(
            index_elements=[MemberPhoto.member_id],
            set_={
                "content_type": statement.excluded.content_type,
                "image": statement.excluded.image,
                "byte_size": statement.excluded.byte_size,
                # `onupdate` only fires for ORM updates, so the replacement timestamp
                # is set here. The database clock stays authoritative.
                "updated_at": func.now(),
            },
            # A photo row only ever belongs to the member named by the primary key, and
            # that member is pinned to this team by the composite foreign key. The team
            # filter here makes the intent explicit at the statement level too.
            where=MemberPhoto.team_id == team_id,
        ).returning(MemberPhoto.updated_at)
    ).scalar_one()
    return updated_at


def delete_for_member(session: Session, team_id: uuid.UUID, member_id: uuid.UUID) -> int:
    """Remove the member's photo. Returns how many rows that was (0 or 1)."""
    result = session.execute(
        delete(MemberPhoto).where(
            MemberPhoto.team_id == team_id, MemberPhoto.member_id == member_id
        )
    )
    return result.rowcount or 0
