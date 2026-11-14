"""Let the placement slot constraint be checked at commit instead of per statement.

`uq_members_placement_parent_id_placement_position` is what guarantees a parent holds at
most one LEFT and one RIGHT member. This migration keeps that guarantee exactly as it is
and changes only *when* PostgreSQL is willing to check it.

Why it is needed
----------------
Safe deletion promotes one of a member's children into the position the deleted member
occupied. That is a swap: the promoted child has to take `(parent, side)` while the
member being deleted still holds it. Every ordering of the individual statements breaks
some immediate rule:

- the promoted child cannot take the slot first — the slot is still occupied, and the
  unique constraint refuses it;
- the member cannot be deleted first — their children still reference them, and the
  placement foreign key (NO ACTION) refuses it;
- nobody can be parked in between — `ck_members_root_has_no_placement` requires every
  non-root member to have both a placement parent and a side, so there is no valid
  "detached" state to pass through, and a CHECK constraint cannot be deferred at all.

DEFERRABLE INITIALLY IMMEDIATE resolves it without loosening anything:

- `INITIALLY IMMEDIATE` means the default behaviour is unchanged. Registering a member
  is still refused the instant it aims at an occupied slot, with the same constraint
  name, so the existing 409 for a taken position reads exactly as before.
- A transaction that explicitly asks (`SET CONSTRAINTS ... DEFERRED`) can reorder its
  own statements and have the rule checked once at the end. Reorganization is the only
  operation that asks, and it re-arms the constraint itself (`SET CONSTRAINTS ...
  IMMEDIATE`) before it commits, so a violation surfaces as a handled conflict rather
  than an error thrown by COMMIT.

Every committed state still satisfies the constraint. What a deferred check cannot do is
let a duplicate slot survive a transaction: the check runs before COMMIT returns, and a
failure aborts the whole transaction.

One documented consequence: a deferrable unique constraint cannot act as the arbiter of
an `ON CONFLICT` clause. The only upsert in the application is the root member insert,
which conflicts on `ix_members_team_root` (an ordinary, non-deferrable partial index) and
never on this constraint — a root member has no placement parent, and NULLs do not
collide here.

The constraint is dropped and recreated, which rebuilds its unique index. Nothing else
about the table changes.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-12
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "uq_members_placement_parent_id_placement_position"
COLUMNS = ["placement_parent_id", "placement_position"]


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT, "members", type_="unique")
    op.create_unique_constraint(
        CONSTRAINT,
        "members",
        COLUMNS,
        deferrable=True,
        initially="IMMEDIATE",
    )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT, "members", type_="unique")
    op.create_unique_constraint(CONSTRAINT, "members", COLUMNS)
