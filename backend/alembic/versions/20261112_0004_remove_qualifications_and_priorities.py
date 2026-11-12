"""Remove the qualifications, priorities and goals columns from members.

The four free-text profile fields added in 0003 are no longer part of UrLynk. They were
never read by anything but the profile screens that are going away with them, so this
drops the columns outright rather than leaving dead ones behind.

Each column also carried a `*_not_blank` check constraint. PostgreSQL would drop those
along with their column, but they are dropped explicitly first so the intent is in the
migration rather than implied by a side effect.

`member_photos` and every other member column are untouched.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REMOVED_COLUMNS = (
    "educational_qualifications",
    "professional_qualifications",
    "priorities",
    "goals",
)

# The bound these columns were declared with in 0003, kept here so `downgrade` rebuilds
# exactly what it dropped rather than something merely similar.
PROFILE_TEXT_MAX_LENGTH = 500


def upgrade() -> None:
    for column in REMOVED_COLUMNS:
        # The bare constraint name: the metadata naming convention expands it to
        # "ck_members_<column>_not_blank", the same way 0003 created it.
        op.drop_constraint(f"{column}_not_blank", "members", type_="check")
        op.drop_column("members", column)


def downgrade() -> None:
    """Rebuild the columns and their constraints, empty.

    Honest about what it can do: the columns come back exactly as 0003 defined them,
    but they come back NULL. Dropping a column discards its values, so no downgrade can
    restore what `upgrade` removed — which is why `upgrade` was only safe to run after
    confirming every one of these columns was empty.
    """
    for column in reversed(REMOVED_COLUMNS):
        op.add_column(
            "members",
            sa.Column(column, sa.String(length=PROFILE_TEXT_MAX_LENGTH), nullable=True),
        )
        op.create_check_constraint(
            f"{column}_not_blank",
            "members",
            f"{column} IS NULL OR length(trim({column})) > 0",
        )
