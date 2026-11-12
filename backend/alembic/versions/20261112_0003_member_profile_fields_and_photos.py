"""Add professional profile fields to members, and a table for profile photos.

Four bounded text columns (educational and professional qualifications, priorities,
goals) extend the business profile every member record can hold — above all the root
member, which is the leader's own. `photo_updated_at` records that a member has a photo
and when it last changed; the bytes themselves go in `member_photos`, so a directory
page never pays for image data.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROFILE_TEXT_COLUMNS = (
    "educational_qualifications",
    "professional_qualifications",
    "priorities",
    "goals",
)
PROFILE_TEXT_MAX_LENGTH = 500
MAX_PHOTO_BYTES = 64 * 1024
ALLOWED_PHOTO_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")


def upgrade() -> None:
    for column in PROFILE_TEXT_COLUMNS:
        op.add_column(
            "members",
            sa.Column(column, sa.String(length=PROFILE_TEXT_MAX_LENGTH), nullable=True),
        )
        # Optional text is either absent or says something; blank-but-present would read
        # as recorded on the member's screen.
        op.create_check_constraint(
            f"{column}_not_blank",
            "members",
            f"{column} IS NULL OR length(trim({column})) > 0",
        )

    op.add_column(
        "members",
        sa.Column("photo_updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "member_photos",
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=False),
        sa.Column("byte_size", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"byte_size > 0 AND byte_size <= {MAX_PHOTO_BYTES}",
            name=op.f("ck_member_photos_byte_size_within_limit"),
        ),
        # The recorded size is the stored size, so a client cannot be told one thing
        # while something else is kept.
        sa.CheckConstraint(
            "octet_length(image) = byte_size",
            name=op.f("ck_member_photos_byte_size_matches_image"),
        ),
        sa.CheckConstraint(
            "content_type IN ("
            + ", ".join(f"'{content_type}'" for content_type in ALLOWED_PHOTO_CONTENT_TYPES)
            + ")",
            name=op.f("ck_member_photos_content_type_supported"),
        ),
        # Composite foreign key against (team_id, id): a photo belongs to a member of
        # that same team and cannot drift to another one. CASCADE so deleting a member,
        # or a whole team, takes its photo with it.
        sa.ForeignKeyConstraint(
            ["team_id", "member_id"],
            ["members.team_id", "members.id"],
            name="fk_member_photos_member_same_team",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("member_id", name=op.f("pk_member_photos")),
    )


def downgrade() -> None:
    op.drop_table("member_photos")
    op.drop_column("members", "photo_updated_at")
    for column in reversed(PROFILE_TEXT_COLUMNS):
        # The bare name, not the expanded one: the metadata naming convention adds the
        # "ck_members_" prefix here exactly as it did in upgrade().
        op.drop_constraint(f"{column}_not_blank", "members", type_="check")
        op.drop_column("members", column)
