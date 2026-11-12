"""Require a ten-digit Mi Lifestyle ID for every member.

Two rules, added as two constraints because they fail for different reasons and one of
them has to treat the rows that already exist differently:

1. `ck_members_mi_lifestyle_id_is_ten_digits` — an identifier, when present, is exactly
   ten digits.

2. `ck_members_member_has_mi_lifestyle_id` — every member carries one, except the root.
   The root is the leader's own record, created at first sign-in from a Clerk account
   that has no Mi Lifestyle ID to supply; the app asks the leader for theirs on the Edit
   Profile screen instead.

Both are added **NOT VALID**, which is not the weaker rule it sounds like: PostgreSQL
enforces a NOT VALID check on every insert and on every update from the moment it is
added. All it declines to do is re-scan rows that are already stored.

That matters because identifiers recorded before these rules existed may not satisfy
them, and a member whose identifier was cleared for being unusable holds NULL until
someone gives them a real one. Those rows stay readable, and the first edit to any of
them has to satisfy both rules like anywhere else — the app's form will not submit
without a valid identifier.

To enforce either rule over the whole table later, once every row conforms:

    ALTER TABLE members VALIDATE CONSTRAINT ck_members_mi_lifestyle_id_is_ten_digits;
    ALTER TABLE members VALIDATE CONSTRAINT ck_members_member_has_mi_lifestyle_id;

Validation takes only a SHARE UPDATE EXCLUSIVE lock, so it blocks neither reads nor
writes. Either statement fails, harmlessly, while a row still breaks its rule.

No column is altered and no row is rewritten by this migration.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-12
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MI_LIFESTYLE_ID_LENGTH = 10

# Raw SQL throughout, because NOT VALID has no equivalent in `create_check_constraint`.
# The full names are spelled out for the same reason: the metadata naming convention
# applies to Alembic's own operations, not to statements written by hand.
FORMAT_CONSTRAINT = "ck_members_mi_lifestyle_id_is_ten_digits"
PRESENCE_CONSTRAINT = "ck_members_member_has_mi_lifestyle_id"


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE members ADD CONSTRAINT {FORMAT_CONSTRAINT} "
        f"CHECK (mi_lifestyle_id IS NULL "
        f"OR mi_lifestyle_id ~ '^[0-9]{{{MI_LIFESTYLE_ID_LENGTH}}}$') NOT VALID"
    )
    op.execute(
        f"ALTER TABLE members ADD CONSTRAINT {PRESENCE_CONSTRAINT} "
        f"CHECK (is_root OR mi_lifestyle_id IS NOT NULL) NOT VALID"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE members DROP CONSTRAINT {PRESENCE_CONSTRAINT}")
    op.execute(f"ALTER TABLE members DROP CONSTRAINT {FORMAT_CONSTRAINT}")
