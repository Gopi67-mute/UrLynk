import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    String,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

# A profile photo is an avatar, never a gallery image: the app resizes to 256x256 before
# uploading, which lands around 20 KB. The ceiling is generous enough for a PNG of that
# size and small enough that the bytes can travel inside a JSON response.
MAX_PHOTO_BYTES = 64 * 1024

ALLOWED_PHOTO_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")
CONTENT_TYPE_MAX_LENGTH = 32

# The first bytes each accepted format must begin with, checked so a mislabelled or
# non-image upload is refused rather than stored and served back as an image.
PHOTO_MAGIC_BYTES: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


class MemberPhoto(TimestampMixin, Base):
    """One member's profile photo, stored as bytes in its own table.

    Kept out of `members` on purpose: a directory page selects every column of every
    member it returns, and image bytes there would be paid for on each one.

    `team_id` is carried alongside `member_id` and the two are a composite foreign key
    against `members (team_id, id)`, the same way placement parents and sponsors are
    pinned to their team. A photo therefore cannot belong to a member of another team,
    and a repository can scope a lookup by team without a join.
    """

    __tablename__ = "member_photos"
    __table_args__ = (
        ForeignKeyConstraint(
            ["team_id", "member_id"],
            ["members.team_id", "members.id"],
            name="fk_member_photos_member_same_team",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            f"byte_size > 0 AND byte_size <= {MAX_PHOTO_BYTES}", name="byte_size_within_limit"
        ),
        # The recorded size is the stored size, so a client cannot be told one thing
        # while something else is kept.
        CheckConstraint("octet_length(image) = byte_size", name="byte_size_matches_image"),
        CheckConstraint(
            "content_type IN ("
            + ", ".join(f"'{content_type}'" for content_type in ALLOWED_PHOTO_CONTENT_TYPES)
            + ")",
            name="content_type_supported",
        ),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    team_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    content_type: Mapped[str] = mapped_column(String(CONTENT_TYPE_MAX_LENGTH), nullable=False)
    image: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
