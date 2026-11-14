import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, func, or_, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Member, PlacementPosition

# A placement chain longer than this is treated as corrupt rather than walked forever.
# Cycles are already caught by the path check in the query below; this is a backstop.
MAX_PLACEMENT_DEPTH = 10_000

# Named here so `SET CONSTRAINTS` and the error translation that reads constraint names
# off a failed write cannot drift apart.
PLACEMENT_SLOT_CONSTRAINT = "uq_members_placement_parent_id_placement_position"


@dataclass(frozen=True, slots=True)
class ChainStatus:
    """What walking a member's placement parents upwards found."""

    reaches_root: bool
    has_cycle: bool
    depth: int


@dataclass(frozen=True, slots=True)
class AncestorPath:
    """A member's placement chain, root first and the member themselves last.

    `reaches_root` and `has_cycle` describe the same walk `ChainStatus` reports on, so a
    damaged chain is recognised rather than drawn. `exhausted` means the walk stopped at
    the depth limit instead of at the root: the chain is not known to be broken, only
    longer than the caller is willing to return.
    """

    member_ids: tuple[uuid.UUID, ...]
    reaches_root: bool
    has_cycle: bool
    exhausted: bool


def _escape_like(value: str) -> str:
    """Make a user's text literal inside LIKE/ILIKE.

    Without this, a search for "100%" would match every member, and "_" would stand in
    for any single character. The backslash is escaped first, so escaping cannot be
    escaped away. `escape="\\"` must be passed to the comparison for this to take effect.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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

    The conflict is named rather than left open, for two reasons. It states the one
    collision this insert expects — a second first-login for the same team — so any
    *other* unique violation is raised instead of being quietly swallowed. And a bare
    `ON CONFLICT DO NOTHING` considers every unique constraint on the table as a
    possible arbiter, which PostgreSQL refuses outright once one of them is deferrable
    (`uq_members_placement_parent_id_placement_position` is, as of migration 0006).
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
        .on_conflict_do_nothing(index_elements=["team_id"], index_where=text("is_root"))
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


def child_slots(
    session: Session, team_id: uuid.UUID, parent_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[PlacementPosition, uuid.UUID]]:
    """Who sits directly below each of these parents, as identifiers only.

    One query for a whole level of the tree, which is what lets the breadth-first slot
    search cost one round trip per level rather than one per member. Three columns are
    selected and no member is loaded into the session: a search that walks hundreds of
    members never reads a name, a note or a photo.
    """
    if not parent_ids:
        return {}

    rows = session.execute(
        select(Member.placement_parent_id, Member.placement_position, Member.id).where(
            Member.team_id == team_id,
            Member.placement_parent_id.in_(parent_ids),
        )
    ).all()

    slots: dict[uuid.UUID, dict[PlacementPosition, uuid.UUID]] = {}
    for parent_id, position, child_id in rows:
        if parent_id is not None and position is not None:
            slots.setdefault(parent_id, {})[PlacementPosition(position)] = child_id
    return slots


def has_duplicate_slots(session: Session, team_id: uuid.UUID) -> bool:
    """Whether any parent in this team holds two members on the same side.

    The unique constraint already makes this impossible, and reorganization re-arms it
    before committing. Asking anyway is deliberate: it is the one invariant whose breach
    would silently lose a member from the tree, and it costs a single grouped query.
    """
    duplicate = session.execute(
        select(Member.placement_parent_id)
        .where(Member.team_id == team_id, Member.placement_parent_id.is_not(None))
        .group_by(Member.placement_parent_id, Member.placement_position)
        .having(func.count() > 1)
        .limit(1)
    ).first()
    return duplicate is not None


def defer_slot_checks(session: Session) -> None:
    """Hold the placement-slot check until this transaction commits.

    Only reorganization asks for this, and only because promoting a child into the
    deleted member's position is a swap: the promoted member has to take a slot its
    previous occupant has not released yet. See migration 0006 for why no ordering of
    the statements avoids it.

    The constraint is DEFERRABLE INITIALLY IMMEDIATE, so this changes nothing for any
    other transaction, and a database that has not run migration 0006 raises here rather
    than quietly skipping the protection.
    """
    session.execute(text(f'SET CONSTRAINTS "{PLACEMENT_SLOT_CONSTRAINT}" DEFERRED'))


def enforce_slot_checks(session: Session) -> None:
    """Check the deferred placement-slot rule now, before the transaction commits.

    Re-arming the constraint runs every check that was queued while it was deferred, so
    a duplicated slot is raised here — inside the operation, where it becomes a handled
    conflict and a rollback — instead of out of COMMIT, where there is nothing left to
    catch it.
    """
    session.execute(text(f'SET CONSTRAINTS "{PLACEMENT_SLOT_CONSTRAINT}" IMMEDIATE'))


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


def search(
    session: Session,
    team_id: uuid.UUID,
    *,
    query: str,
    limit: int,
    after: tuple[str, uuid.UUID] | None = None,
) -> list[Member]:
    """Members of one team whose name or Mi Lifestyle ID matches `query`.

    Two different kinds of match, because the two fields are two different kinds of
    value:

    - **name**: anywhere in the name, case-insensitively, so "nair" finds "Meera Nair".
      ILIKE is PostgreSQL's own case-insensitive comparison, so no column is wrapped in
      `lower()` for the match itself;
    - **Mi Lifestyle ID**: a *prefix*, and only when the query is made of digits. An
      identifier is exactly ten digits, so a leader typing the first few of one is
      narrowing it down; typing letters is never a search for an identifier, and
      scanning the column for those would cost a comparison per row for no possible hit.
      A full identifier is a prefix of itself, so an exact search still finds it — and
      leading zeros are matched as typed, since the column is text and is never parsed as
      a number.

    The two conditions are OR'd in one statement, so a member matching both appears once.

    Ordering is `(lower(name), id)`: alphabetical, case-insensitive, and total — `id`
    breaks ties between members who share a name, so the order is identical on every
    request and a member can never appear on two pages or be skipped between them.
    Deliberately *not* relevance-ranked: a stable order a leader can scan is worth more
    here than a cleverer one that reshuffles as they type.

    `after` is the previous page's last `(lower(name), id)`, compared as a row so the
    database can walk from that position. Both the comparison and the ordering use the
    same collation, so they agree.

    Everything is bounded: the caller's `limit` caps the rows, the statement is filtered
    by `team_id` first, and no member outside the caller's team can be reached whatever
    the query says.
    """
    pattern = _escape_like(query)
    conditions = [Member.name.ilike(f"%{pattern}%", escape="\\")]

    # Only when the query could be part of an identifier. `str.isdigit` is avoided for
    # the reason `is_valid_mi_lifestyle_id` avoids it: it accepts Unicode numerals.
    if query and all(character in "0123456789" for character in query):
        conditions.append(Member.mi_lifestyle_id.ilike(f"{pattern}%", escape="\\"))

    sort_name = func.lower(Member.name)
    stmt = _team_scoped(team_id).where(or_(*conditions))
    if after is not None:
        stmt = stmt.where(tuple_(sort_name, Member.id) > after)
    return list(session.scalars(stmt.order_by(sort_name, Member.id).limit(limit)).all())


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


# The same upward walk as `_ANCESTOR_CHAIN_SQL`, but keeping each step rather than only
# the verdict. `depth` counts placement edges from the member, so ordering by it
# descending puts the root first and the member last — the order the path is read in.
_ANCESTOR_PATH_SQL = text(
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
    SELECT id, is_root, cycle, depth FROM chain ORDER BY depth DESC
    """
)


def ancestor_path(
    session: Session, team_id: uuid.UUID, member_id: uuid.UUID, *, max_depth: int
) -> AncestorPath:
    """The exact placement chain from the team's root down to this member.

    One query, whatever the depth: the database walks the real `placement_parent_id`
    edges, so the result is the structure itself rather than anything inferred from
    registration order, timestamps or identifiers. Nothing but the ids is selected, so a
    deep path costs no names, notes or photos here; the caller loads the members it needs
    in a second, bounded query.

    Three things stop the walk, and the result says which: the root (`reaches_root`), a
    member already on the path (`has_cycle` — a damaged tree, not a longer one), and
    `max_depth` (`exhausted`). A chain that reaches neither the root nor the limit means
    the member's parent is missing from the team, which is also damage.

    `member_ids` is root-first and always ends with `member_id`; for the root itself it
    holds that one id.
    """
    rows = session.execute(
        _ANCESTOR_PATH_SQL,
        {"team_id": team_id, "member_id": member_id, "max_depth": max_depth},
    ).all()

    if not rows:
        return AncestorPath((), reaches_root=False, has_cycle=False, exhausted=False)

    top = rows[0]
    return AncestorPath(
        member_ids=tuple(row.id for row in rows),
        reaches_root=bool(top.is_root),
        has_cycle=any(row.cycle for row in rows),
        # The walk is given `max_depth` edges to use, so a chain still going at that
        # depth is longer than the caller asked for rather than broken.
        exhausted=not top.is_root and top.depth >= max_depth,
    )


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


# Counts a member and everyone below them. UNION (not UNION ALL) de-duplicates, so a
# damaged tree cannot make this recurse forever.
_SUBTREE_SIZE_SQL = text(
    """
    WITH RECURSIVE subtree AS (
        SELECT id FROM members WHERE team_id = :team_id AND id = :member_id
        UNION
        SELECT descendant.id
        FROM members AS descendant
        JOIN subtree ON descendant.placement_parent_id = subtree.id
        WHERE descendant.team_id = :team_id
    )
    SELECT count(*) FROM subtree
    """
)


def subtree_size(session: Session, team_id: uuid.UUID, member_id: uuid.UUID) -> int:
    """How many members move if this member moves: themselves and every descendant.

    Counted in the database, so the preview can say "12 members move with them" without
    the API loading twelve members to find out.
    """
    return session.scalar(_SUBTREE_SIZE_SQL, {"team_id": team_id, "member_id": member_id}) or 0
