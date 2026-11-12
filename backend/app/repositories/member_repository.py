import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, func, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Member, PlacementPosition

# A placement chain longer than this is treated as corrupt rather than walked forever.
# Cycles are already caught by the path check in the query below; this is a backstop.
MAX_PLACEMENT_DEPTH = 10_000


@dataclass(frozen=True, slots=True)
class ChainStatus:
    """What walking a member's placement parents upwards found."""

    reaches_root: bool
    has_cycle: bool
    depth: int


def _team_scoped(team_id: uuid.UUID) -> Select[tuple[Member]]:
    return select(Member).where(Member.team_id == team_id)


def get(session: Session, team_id: uuid.UUID, member_id: uuid.UUID) -> Member | None:
    return session.scalars(_team_scoped(team_id).where(Member.id == member_id)).one_or_none()


def get_for_update(session: Session, team_id: uuid.UUID, member_id: uuid.UUID) -> Member | None:
    """Read a member and hold a row lock on it until the transaction ends.

    Taking this on a placement parent serializes two members racing for the same LEFT
    or RIGHT slot, so the second one sees the first instead of both finding it empty.
    """
    return session.scalars(
        _team_scoped(team_id).where(Member.id == member_id).with_for_update()
    ).one_or_none()


def get_root(session: Session, team_id: uuid.UUID) -> Member | None:
    return session.scalars(_team_scoped(team_id).where(Member.is_root)).one_or_none()


def insert_root_if_absent(
    session: Session, team_id: uuid.UUID, user_profile_id: uuid.UUID, name: str
) -> None:
    """Create the leader's own member record at the root of their team.

    A partial unique index (`members (team_id) WHERE is_root`) allows only one, and
    ON CONFLICT DO NOTHING turns a concurrent duplicate into a no-op.
    """
    session.execute(
        insert(Member)
        .values(
            team_id=team_id,
            user_profile_id=user_profile_id,
            name=name,
            is_root=True,
            placement_parent_id=None,
            placement_position=None,
        )
        .on_conflict_do_nothing()
    )


def count_all(session: Session, team_id: uuid.UUID) -> int:
    return (
        session.scalar(select(func.count()).select_from(Member).where(Member.team_id == team_id))
        or 0
    )


def slot_is_taken(
    session: Session,
    team_id: uuid.UUID,
    parent_id: uuid.UUID,
    position: PlacementPosition,
) -> bool:
    return bool(
        session.scalar(
            select(
                select(Member.id)
                .where(
                    Member.team_id == team_id,
                    Member.placement_parent_id == parent_id,
                    Member.placement_position == position,
                )
                .exists()
            )
        )
    )


def children_of(
    session: Session, team_id: uuid.UUID, parent_id: uuid.UUID
) -> dict[PlacementPosition, Member]:
    """The parent's direct LEFT and RIGHT members. A missing key means a free slot."""
    rows = session.scalars(
        _team_scoped(team_id).where(Member.placement_parent_id == parent_id)
    ).all()
    return {child.placement_position: child for child in rows if child.placement_position}


def has_children(session: Session, team_id: uuid.UUID, parent_id: uuid.UUID) -> bool:
    """Whether anyone is placed directly below this member, on either side."""
    return bool(
        session.scalar(
            select(
                select(Member.id)
                .where(Member.team_id == team_id, Member.placement_parent_id == parent_id)
                .exists()
            )
        )
    )


def is_sponsor(session: Session, team_id: uuid.UUID, member_id: uuid.UUID) -> bool:
    """Whether this member is recorded as anyone else's sponsor.

    Sponsorship is a separate relationship from placement, and `sponsor_id` carries a
    composite foreign key with no cascade, so the database refuses to delete a member
    another record still points at. Asking first turns that into a clear answer instead
    of a constraint violation.
    """
    return bool(
        session.scalar(
            select(
                select(Member.id)
                .where(Member.team_id == team_id, Member.sponsor_id == member_id)
                .exists()
            )
        )
    )


def delete(session: Session, member: Member) -> None:
    """Remove one member row. The caller has already checked it is safe to remove."""
    session.delete(member)


def filled_slots(
    session: Session, team_id: uuid.UUID, member_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, set[PlacementPosition]]:
    """Which slots are filled, for many parents in one query (no per-row lookups)."""
    if not member_ids:
        return {}

    rows = session.execute(
        select(Member.placement_parent_id, Member.placement_position).where(
            Member.team_id == team_id,
            Member.placement_parent_id.in_(member_ids),
        )
    ).all()

    filled: dict[uuid.UUID, set[PlacementPosition]] = {}
    for parent_id, position in rows:
        if parent_id is not None and position is not None:
            filled.setdefault(parent_id, set()).add(position)
    return filled


def list_recent(session: Session, team_id: uuid.UUID, *, limit: int) -> list[Member]:
    """The team's most recently registered members, newest first.

    The root member is left out: it is the leader's own record, created with the team
    rather than registered by anyone, and listing it as a recent addition would be
    untrue. A team whose leader has added nobody yet therefore returns nothing.

    Ordered by `(created_at, id)` descending, which `ix_members_team_created_at_id`
    covers, and always bounded by `limit`.
    """
    return list(
        session.scalars(
            _team_scoped(team_id)
            .where(~Member.is_root)
            .order_by(Member.created_at.desc(), Member.id.desc())
            .limit(limit)
        ).all()
    )


def get_many(
    session: Session, team_id: uuid.UUID, member_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Member]:
    """Several members of one team in a single query, keyed by id."""
    if not member_ids:
        return {}

    rows = session.scalars(_team_scoped(team_id).where(Member.id.in_(member_ids))).all()
    return {member.id: member for member in rows}


def list_page(
    session: Session,
    team_id: uuid.UUID,
    *,
    limit: int,
    after: tuple[datetime, uuid.UUID] | None = None,
) -> list[Member]:
    """One page of the team directory, oldest first (so the leader comes first).

    Keyset pagination on `(created_at, id)`, which `ix_members_team_created_at_id`
    covers: page 100 costs the same as page 1, unlike OFFSET.
    """
    stmt = _team_scoped(team_id)
    if after is not None:
        stmt = stmt.where(tuple_(Member.created_at, Member.id) > after)
    return list(session.scalars(stmt.order_by(Member.created_at, Member.id).limit(limit)).all())


# Walks a member's placement parents upwards, carrying the path so a cycle stops the
# recursion instead of looping forever.
_ANCESTOR_CHAIN_SQL = text(
    """
    WITH RECURSIVE chain AS (
        SELECT id, placement_parent_id, is_root, ARRAY[id] AS path,
               false AS cycle, 0 AS depth
        FROM members
        WHERE team_id = :team_id AND id = :member_id
        UNION ALL
        SELECT parent.id, parent.placement_parent_id, parent.is_root,
               chain.path || parent.id, parent.id = ANY(chain.path), chain.depth + 1
        FROM members AS parent
        JOIN chain ON parent.id = chain.placement_parent_id
        WHERE parent.team_id = :team_id
          AND NOT chain.cycle
          AND NOT chain.is_root
          AND chain.depth < :max_depth
    )
    SELECT
        coalesce(bool_or(is_root), false) AS reaches_root,
        coalesce(bool_or(cycle), false) AS has_cycle,
        coalesce(max(depth), 0) AS depth
    FROM chain
    """
)


def ancestor_chain_status(
    session: Session, team_id: uuid.UUID, member_id: uuid.UUID
) -> ChainStatus:
    """Check that a member's placement chain ends at the team's root.

    A healthy chain reaches the root and has no cycle. Anything else means the tree is
    damaged, and callers refuse to build on it rather than adding to the damage.
    """
    row = session.execute(
        _ANCESTOR_CHAIN_SQL,
        {"team_id": team_id, "member_id": member_id, "max_depth": MAX_PLACEMENT_DEPTH},
    ).one()
    return ChainStatus(reaches_root=row.reaches_root, has_cycle=row.has_cycle, depth=row.depth)


# Counts each side of the root in one pass. UNION (not UNION ALL) de-duplicates, which
# also means a damaged tree cannot make this recurse forever.
_BRANCH_COUNTS_SQL = text(
    """
    WITH RECURSIVE branch AS (
        SELECT id, placement_position AS side
        FROM members
        WHERE team_id = :team_id AND placement_parent_id = :root_id
        UNION
        SELECT descendant.id, branch.side
        FROM members AS descendant
        JOIN branch ON descendant.placement_parent_id = branch.id
        WHERE descendant.team_id = :team_id
    )
    SELECT side, count(*) AS size FROM branch GROUP BY side
    """
)


def branch_sizes(
    session: Session, team_id: uuid.UUID, root_id: uuid.UUID
) -> dict[PlacementPosition, int]:
    """How many members sit under the root's LEFT and RIGHT slots, at any depth."""
    rows = session.execute(_BRANCH_COUNTS_SQL, {"team_id": team_id, "root_id": root_id}).all()
    sizes = dict.fromkeys(PlacementPosition, 0)
    for side, size in rows:
        sizes[PlacementPosition(side)] = size
    return sizes
