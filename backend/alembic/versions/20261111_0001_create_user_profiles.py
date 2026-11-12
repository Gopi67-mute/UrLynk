"""Create user_profiles.

Revision ID: 0001
Revises:
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
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
            "length(clerk_user_id) > 0",
            name=op.f("ck_user_profiles_clerk_user_id_not_empty"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_profiles")),
        sa.UniqueConstraint("clerk_user_id", name=op.f("uq_user_profiles_clerk_user_id")),
    )


def downgrade() -> None:
    op.drop_table("user_profiles")
