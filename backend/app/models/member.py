import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

# The column stays wider than the rule it now enforces. Narrowing it would mean altering
# the type on a table that already holds shorter legacy values, for no gain: the exact
# length is enforced by `mi_lifestyle_id_is_ten_digits` below, by the API schema, and by
# the form.
MI_LIFESTYLE_ID_MAX_LENGTH = 32

# A Mi Lifestyle ID is exactly ten digits. Stored as text and never parsed as a number,
# so a leading zero is part of the ID rather than something to be dropped.
MI_LIFESTYLE_ID_LENGTH = 10
MI_LIFESTYLE_ID_PATTERN = f"^[0-9]{{{MI_LIFESTYLE_ID_LENGTH}}}$"


def is_valid_mi_lifestyle_id(value: str | None) -> bool:
    """Whether this identifier satisfies the rules the database enforces.

    The same rule as `ck_members_mi_lifestyle_id_is_ten_digits`, expressed in Python so
    it can be checked *before* a write rather than discovered as a constraint violation
    afterwards. Both the request schema and the placement service read it from here, so
    there is one definition of a valid identifier rather than three.

    `str.isdigit()` is deliberately not used: it accepts Unicode digits such as
    Arabic-Indic or superscript numerals, which are not what an identifier is made of.
    The check is against ASCII 0-9 only, and the value is never parsed as a number, so a
    leading zero is part of the identifier rather than something to be dropped.
    """
    if value is None:
        return False
    return len(value) == MI_LIFESTYLE_ID_LENGTH and all(
        character in "0123456789" for character in value
    )


MEMBER_NAME_MAX_LENGTH = 120
PHONE_NUMBER_MAX_LENGTH = 32
NOTES_MAX_LENGTH = 500


class PlacementPosition(StrEnum):
    """Which of a placement parent's two slots a member occupies."""

    LEFT = "LEFT"
    RIGHT = "RIGHT"


# Stored as VARCHAR + CHECK rather than a PostgreSQL ENUM type: same guarantee, and
# migrations never have to alter a database-level type.
placement_position_type = Enum(
    PlacementPosition,
    name="placement_position",
    native_enum=False,
    length=5,
    create_constraint=True,
    validate_strings=True,
)


class Member(TimestampMixin, Base):
    """A person in a team, with two independent relationships.

    `sponsor_id` records who introduced them; `placement_parent_id` + `placement_position`
    record where they sit in the binary structure. The two never affect each other.

    The database enforces the structural rules, so a service bug cannot corrupt a tree:

    - one root per team (partial unique index on `team_id WHERE is_root`);
    - the root has no placement, every other member has both parent and position
      (`root_has_no_placement`);
    - one LEFT and one RIGHT child per parent (`uq_members_placement_parent_id_placement_position`);
    - no member is its own parent or sponsor (`placement_parent_not_self`, `sponsor_not_self`);
    - placement parents and sponsors are in the *same team*, enforced by composite foreign
      keys against `(team_id, id)` instead of by application code alone.

    Multi-member cycles are the one rule a constraint cannot express; the placement
    service walks the ancestor chain for those (see `app/services/member_service.py`).
    """

    __tablename__ = "members"
    __table_args__ = (
        # Referenced by the composite foreign keys below, which is how a placement parent
        # or sponsor is pinned to the same team as the member pointing at it.
        UniqueConstraint("team_id", "id", name="uq_members_team_id_id"),
        # These two keep NO ACTION (checked at end of statement) rather than RESTRICT
        # (checked per row), so deleting a team can cascade away a whole tree at once
        # while a parent with children still cannot be deleted on its own.
        ForeignKeyConstraint(
            ["team_id", "placement_parent_id"],
            ["members.team_id", "members.id"],
            name="fk_members_placement_parent_same_team",
        ),
        ForeignKeyConstraint(
            ["team_id", "sponsor_id"],
            ["members.team_id", "members.id"],
            name="fk_members_sponsor_same_team",
        ),
        CheckConstraint(
            "placement_parent_id IS DISTINCT FROM id", name="placement_parent_not_self"
        ),
        CheckConstraint("sponsor_id IS DISTINCT FROM id", name="sponsor_not_self"),
        CheckConstraint(
            "(is_root AND placement_parent_id IS NULL AND placement_position IS NULL)"
            " OR (NOT is_root AND placement_parent_id IS NOT NULL"
            " AND placement_position IS NOT NULL)",
            name="root_has_no_placement",
        ),
        CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        CheckConstraint(
            "mi_lifestyle_id IS NULL OR mi_lifestyle_id ~ '^[^[:space:]]+$'",
            name="mi_lifestyle_id_has_no_spaces",
        ),
        # Exactly ten digits whenever one is present. Added NOT VALID in migration 0005:
        # it governs every insert and update from now on, while two members registered
        # before the rule existed keep the identifiers they were given until someone
        # edits them, at which point the rule applies like anywhere else.
        CheckConstraint(
            f"mi_lifestyle_id IS NULL OR mi_lifestyle_id ~ '{MI_LIFESTYLE_ID_PATTERN}'",
            name="mi_lifestyle_id_is_ten_digits",
        ),
        # Every member carries one. The root is the single exception: it is the leader's
        # own record, created by the database at first sign-in from the Clerk account,
        # which has no Mi Lifestyle ID to supply. The app asks the leader for theirs on
        # the Edit Profile screen instead, so the exemption is only about when the row
        # is born, not about whether a leader needs an identifier.
        CheckConstraint(
            "is_root OR mi_lifestyle_id IS NOT NULL",
            name="member_has_mi_lifestyle_id",
        ),
        CheckConstraint(
            "phone_number IS NULL OR length(trim(phone_number)) > 0",
            name="phone_number_not_blank",
        ),
        # A parent fills each side at most once. NULLs are distinct in PostgreSQL, so
        # root members (both columns NULL) do not collide here.
        #
        # Deferrable, but INITIALLY IMMEDIATE: by default it is still checked the moment
        # a row is written, which is what makes registering a member into an occupied
        # slot an immediate 409. Safe deletion is the one operation that asks for the
        # check to be deferred (see `app/services/placement_service.py`), because
        # promoting a child into the deleted member's position is a swap and no ordering
        # of the statements satisfies the rule at every intermediate step. The deferred
        # check still runs before that transaction commits, so no committed state can
        # ever hold two members in the same slot. See migration 0006.
        UniqueConstraint(
            "placement_parent_id",
            "placement_position",
            name="uq_members_placement_parent_id_placement_position",
            deferrable=True,
            initially="IMMEDIATE",
        ),
        # Exactly one root per team, and the leader holds at most one root member.
        Index("ix_members_team_root", "team_id", unique=True, postgresql_where=text("is_root")),
        # Mi Lifestyle IDs are unique inside a team when present, compared case-insensitively
        # so "ml0012a" cannot be re-registered as "ML0012A". Leading zeros are preserved:
        # the value is stored as text and never parsed as a number.
        Index(
            "ix_members_team_mi_lifestyle_id",
            "team_id",
            text("lower(mi_lifestyle_id)"),
            unique=True,
            postgresql_where=text("mi_lifestyle_id IS NOT NULL"),
        ),
        # Reading one parent's two children, and counting a branch, are the hot queries.
        Index("ix_members_team_placement_parent", "team_id", "placement_parent_id"),
        # Keyset pagination of the team directory.
        Index("ix_members_team_created_at_id", "team_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    # Set only on the root member: the leader's own record in their team.
    user_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("user_profiles.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,
    )

    name: Mapped[str] = mapped_column(String(MEMBER_NAME_MAX_LENGTH), nullable=False)
    mi_lifestyle_id: Mapped[str | None] = mapped_column(
        String(MI_LIFESTYLE_ID_MAX_LENGTH), nullable=True
    )
    phone_number: Mapped[str | None] = mapped_column(String(PHONE_NUMBER_MAX_LENGTH), nullable=True)
    joining_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(NOTES_MAX_LENGTH), nullable=True)

    # When the member's photo last changed, or NULL when they have none. The bytes live
    # in `member_photos`, which is the source of truth; this column exists so a list or
    # a dashboard can tell that a photo exists, and cache it by version, without joining
    # or loading any image data. Both are written in the same transaction.
    photo_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    sponsor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    placement_parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    placement_position: Mapped[PlacementPosition | None] = mapped_column(
        placement_position_type, nullable=True
    )

    is_root: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
