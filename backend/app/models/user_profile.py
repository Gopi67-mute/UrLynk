import uuid

from sqlalchemy import CheckConstraint, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class UserProfile(TimestampMixin, Base):
    """An UrLynk account, keyed by the verified Clerk user ID (the token's `sub` claim).

    One profile owns at most one team (`teams.owner_user_id` is unique) and holds one
    root member in it (`members.user_profile_id`). Both are created together by
    `app.services.initialization_service`, never here.

    There is deliberately no display name or email column: Clerk is the source of
    truth for identity, and the leader's name is stored once, on their root member.
    """

    __tablename__ = "user_profiles"
    __table_args__ = (CheckConstraint("length(clerk_user_id) > 0", name="clerk_user_id_not_empty"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
