import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Team(TimestampMixin, Base):
    """One leader's private team.

    `owner_user_id` is unique, which is what guarantees "one team per leader in V1":
    a concurrent second initialization fails on the constraint instead of racing.

    There is deliberately no `root_member_id` column. It would need a circular foreign
    key with `members.team_id`, and the root is already identified unambiguously by the
    partial unique index on `members (team_id) WHERE is_root`.
    """

    __tablename__ = "teams"
    __table_args__ = (CheckConstraint("length(trim(team_name)) > 0", name="team_name_not_blank"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("user_profiles.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    team_name: Mapped[str] = mapped_column(String(120), nullable=False)
