"""Member registration and placement rules.

Every function takes the caller's own `Team`, so a member ID from a request can only
ever resolve inside that team. A member belonging to another leader reads exactly like
one that does not exist.
"""

import logging
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Member, PlacementPosition, Team
from app.repositories import member_repository
from app.schemas.member import (
    MemberChildren,
    MemberCreate,
    MemberDetail,
    MemberListItem,
    MemberPage,
    MemberSummary,
    MemberUpdate,
    RecentMember,
)
from app.services.pagination import decode_cursor, encode_cursor

logger = logging.getLogger("app.members")

MEMBER_NOT_FOUND = ("member_not_found", "We couldn't find that member in your team.")
PARENT_NOT_FOUND = ("parent_not_found", "That placement parent isn't in your team.")
SPONSOR_NOT_FOUND = ("sponsor_not_found", "That sponsor isn't in your team.")

ROOT_UNDELETABLE = (
    "root_member_undeletable",
    "This is your own record as team leader, so it can't be deleted.",
)
HAS_CHILDREN = (
    "member_has_children",
    "This member has members placed below them. Those positions would be lost, so they "
    "can't be deleted.",
)
SPONSORS_OTHERS = (
    "member_sponsors_others",
    "This member is recorded as another member's sponsor, so they can't be deleted. "
    "Change that sponsor first.",
)

# The same two foreign keys mean something different when a row is being removed rather
# than written: a member is still referenced, not a reference that cannot be resolved.
_DELETE_CONSTRAINT_ERRORS: dict[str, tuple[str, str]] = {
    "fk_members_placement_parent_same_team": HAS_CHILDREN,
    "fk_members_sponsor_same_team": SPONSORS_OTHERS,
}

# Unique indexes and constraints a concurrent write can trip, and what each means to
# the caller. Checked after the fact, so a race ends in a clear 409 rather than a 500.
_CONSTRAINT_ERRORS: dict[str, tuple[int, str, str]] = {
    "uq_members_placement_parent_id_placement_position": (
        409,
        "placement_occupied",
        "That position is already taken. Choose the other side or another parent.",
    ),
    "ix_members_team_mi_lifestyle_id": (
        409,
        "mi_lifestyle_id_taken",
        "That Mi Lifestyle ID is already registered in your team.",
    ),
    "ix_members_team_root": (
        409,
        "root_member_exists",
        "Your team already has a leader record.",
    ),
    "fk_members_placement_parent_same_team": (404, *PARENT_NOT_FOUND),
    "fk_members_sponsor_same_team": (404, *SPONSOR_NOT_FOUND),
    # Both are already refused before the write; reaching them means a request got past
    # the schema, so the answer is still specific rather than a generic conflict.
    "ck_members_mi_lifestyle_id_is_ten_digits": (
        422,
        "mi_lifestyle_id_invalid",
        "A Mi Lifestyle ID must be exactly 10 digits.",
    ),
    "ck_members_member_has_mi_lifestyle_id": (
        422,
        "mi_lifestyle_id_required",
        "A Mi Lifestyle ID is required for every member.",
    ),
}

MI_LIFESTYLE_ID_REQUIRED = (
    "mi_lifestyle_id_required",
    "A Mi Lifestyle ID is required for every member.",
)


def _not_found(code_and_message: tuple[str, str]) -> ApiError:
    code, message = code_and_message
    return ApiError(404, code, message)


def _translate_integrity_error(exc: IntegrityError) -> ApiError:
    """Map a database constraint to a specific error, or a safe generic one."""
    constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
    known = _CONSTRAINT_ERRORS.get(constraint or "")
    if known is not None:
        status, code, message = known
        logger.info("Member write rejected by constraint %s", constraint)
        return ApiError(status, code, message)

    # Nothing is echoed from the driver's message: it can quote submitted values.
    logger.warning("Member write rejected by unexpected constraint %s", constraint)
    return ApiError(409, "member_conflict", "We couldn't save that member. Check the details.")


def _translate_delete_integrity_error(exc: IntegrityError) -> ApiError:
    """A constraint tripped while removing a member, after the checks said it was safe.

    That means something was written concurrently between the check and the commit, so
    the answer is the same 409 the check would have given rather than a 500.
    """
    constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
    known = _DELETE_CONSTRAINT_ERRORS.get(constraint or "")
    if known is not None:
        logger.info("Member deletion refused by constraint %s", constraint)
        return ApiError(409, *known)

    logger.warning("Member deletion refused by unexpected constraint %s", constraint)
    return ApiError(
        409, "member_undeletable", "We couldn't delete this member. Refresh and try again."
    )


def _summary(member: Member) -> MemberSummary:
    return MemberSummary.model_validate(member)


def create_member(session: Session, team: Team, data: MemberCreate) -> MemberDetail:
    """Register a member in a free LEFT or RIGHT slot under an existing parent.

    The order matters, and every step runs inside one transaction:

    1. the placement parent is read **and locked** inside the caller's team, so two
       members racing for the same slot are serialized rather than both succeeding;
    2. the parent's own chain is verified to reach the team's root, so nothing is
       added to a damaged or cyclic branch;
    3. the sponsor, if given, is checked to be in the same team;
    4. the target slot is checked for an occupant;
    5. the insert still has to satisfy every constraint, and a loser in a race gets
       the same 409 as step 4 would have produced.

    Self-parenting cannot be requested here: the member does not exist yet, and the
    `ck_members_placement_parent_not_self` constraint refuses it at the database level
    for any later update.
    """
    parent = member_repository.get_for_update(session, team.id, data.placement_parent_id)
    if parent is None:
        raise _not_found(PARENT_NOT_FOUND)

    if not parent.is_root:
        chain = member_repository.ancestor_chain_status(session, team.id, parent.id)
        if chain.has_cycle or not chain.reaches_root:
            logger.error(
                "Refusing to place a member under a parent whose chain is broken "
                "(cycle=%s, reaches_root=%s)",
                chain.has_cycle,
                chain.reaches_root,
            )
            raise ApiError(
                409,
                "placement_chain_invalid",
                "That part of your team structure needs attention before members can "
                "be added to it.",
            )

    if (
        data.sponsor_id is not None
        and member_repository.get(session, team.id, data.sponsor_id) is None
    ):
        raise _not_found(SPONSOR_NOT_FOUND)

    if member_repository.slot_is_taken(session, team.id, parent.id, data.placement_position):
        raise ApiError(*_CONSTRAINT_ERRORS["uq_members_placement_parent_id_placement_position"])

    member = Member(
        team_id=team.id,
        name=data.name,
        mi_lifestyle_id=data.mi_lifestyle_id,
        phone_number=data.phone_number,
        joining_date=data.joining_date,
        notes=data.notes,
        sponsor_id=data.sponsor_id,
        placement_parent_id=parent.id,
        placement_position=data.placement_position,
        is_root=False,
    )
    session.add(member)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise _translate_integrity_error(exc) from exc

    return _detail(session, team, member)


def get_member_detail(session: Session, team: Team, member_id: uuid.UUID) -> MemberDetail:
    member = member_repository.get(session, team.id, member_id)
    if member is None:
        raise _not_found(MEMBER_NOT_FOUND)
    return _detail(session, team, member)


def update_member(
    session: Session, team: Team, member_id: uuid.UUID, data: MemberUpdate
) -> MemberDetail:
    """Change a member's own details, and nothing else about them.

    Only the fields the request actually sent are written; `null` clears an optional
    one. The schema has already refused anything structural — team, id, root status,
    placement parent and side — so there is no field here that could move a member or
    hand them to another leader.

    What is still checked at this layer:

    - the member is read **and locked** inside the caller's team, so a member of any
      other team reads as 404 and two concurrent edits are serialized;
    - a new sponsor must be a member of the same team, and cannot be the member
      themselves;
    - the Mi Lifestyle ID is unique per team, which the database decides: a race ends
      in the same 409 as a check here would have given.
    """
    member = member_repository.get_for_update(session, team.id, member_id)
    if member is None:
        raise _not_found(MEMBER_NOT_FOUND)

    changes = data.changes()

    # Clearing an identifier is the one edit that could leave a member without one, and
    # the database would refuse it anyway. Answering here names the field instead.
    if "mi_lifestyle_id" in changes and changes["mi_lifestyle_id"] is None:
        raise ApiError(422, *MI_LIFESTYLE_ID_REQUIRED)

    if "sponsor_id" in changes:
        sponsor_id = changes["sponsor_id"]
        if sponsor_id is not None:
            if sponsor_id == member.id:
                raise ApiError(
                    422, "sponsor_invalid", "A member can't be recorded as their own sponsor."
                )
            if member_repository.get(session, team.id, sponsor_id) is None:
                raise _not_found(SPONSOR_NOT_FOUND)

    for field, value in changes.items():
        setattr(member, field, value)

    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise _translate_integrity_error(exc) from exc

    # Only the field names: the values are the member's own personal details.
    logger.info("Member updated (%s)", ", ".join(sorted(changes)) or "no changes")
    return _detail(session, team, member)


def delete_member(session: Session, team: Team, member_id: uuid.UUID) -> None:
    """Permanently remove one member of the caller's team.

    Deliberately narrow: this removes a single leaf, and nothing else. It is never a
    way to prune a branch, move anyone, or empty a team.

    Everything happens in one transaction, and the order matters:

    1. the member is read **and locked** inside the caller's team, so a member of any
       other team reads as 404 and two concurrent deletions are serialized;
    2. the root member is refused — it is the leader's own record, created with the
       team, and the team's structure hangs from it;
    3. a member with anyone placed below them is refused, so no descendant is ever
       cascade-deleted out from under the leader;
    4. a member another record names as sponsor is refused, because sponsorship is an
       independent relationship the database will not let us silently discard.

    The lock in step 1 is the same row `create_member` takes on a placement parent, so
    a registration racing this deletion is serialized against it rather than slipping a
    child in between the check and the delete. If one somehow did, the placement foreign
    key (NO ACTION, not CASCADE) still refuses the delete and the race ends in a 409.

    The member's photo row goes with them: `member_photos` cascades from
    `members (team_id, id)` on purpose, since a photo has no meaning without its member.
    """
    member = member_repository.get_for_update(session, team.id, member_id)
    if member is None:
        raise _not_found(MEMBER_NOT_FOUND)

    if member.is_root:
        raise ApiError(409, *ROOT_UNDELETABLE)

    if member_repository.has_children(session, team.id, member.id):
        raise ApiError(409, *HAS_CHILDREN)

    if member_repository.is_sponsor(session, team.id, member.id):
        raise ApiError(409, *SPONSORS_OTHERS)

    member_repository.delete(session, member)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise _translate_delete_integrity_error(exc) from exc

    # The id only: a deleted member's own details are not worth writing to a log.
    logger.info("Member deleted (team=%s)", team.id)


def list_recent_members(session: Session, team: Team, *, limit: int) -> list[RecentMember]:
    """The team's newest registrations, newest first and always bounded.

    Two queries, whatever the limit: one for the members, one for the placement parents
    they name. This is a query over the members table, not an event history — a member
    who was renamed or re-placed is not a separate entry here.
    """
    members = member_repository.list_recent(session, team.id, limit=limit)
    parent_ids = {member.placement_parent_id for member in members if member.placement_parent_id}
    parents = member_repository.get_many(session, team.id, sorted(parent_ids))

    return [
        RecentMember(
            **_summary(member).model_dump(),
            placement_parent_name=(
                parents[member.placement_parent_id].name
                if member.placement_parent_id in parents
                else None
            ),
        )
        for member in members
    ]


def _detail(session: Session, team: Team, member: Member) -> MemberDetail:
    parent = (
        member_repository.get(session, team.id, member.placement_parent_id)
        if member.placement_parent_id
        else None
    )
    sponsor = (
        member_repository.get(session, team.id, member.sponsor_id) if member.sponsor_id else None
    )
    children = member_repository.children_of(session, team.id, member.id)

    return MemberDetail(
        **_summary(member).model_dump(),
        phone_number=member.phone_number,
        notes=member.notes,
        placement_parent=_summary(parent) if parent else None,
        sponsor=_summary(sponsor) if sponsor else None,
        has_left_child=PlacementPosition.LEFT in children,
        has_right_child=PlacementPosition.RIGHT in children,
    )


def get_children(session: Session, team: Team, member_id: uuid.UUID) -> MemberChildren:
    """A parent's direct LEFT and RIGHT members; `None` where the slot is free."""
    if member_repository.get(session, team.id, member_id) is None:
        raise _not_found(MEMBER_NOT_FOUND)

    children = member_repository.children_of(session, team.id, member_id)
    left = children.get(PlacementPosition.LEFT)
    right = children.get(PlacementPosition.RIGHT)
    return MemberChildren(
        parent_id=member_id,
        left=_summary(left) if left else None,
        right=_summary(right) if right else None,
    )


def list_members(
    session: Session, team: Team, *, limit: int, cursor: str | None = None
) -> MemberPage:
    """One bounded page of the team directory, oldest first, with slot availability."""
    after = decode_cursor(cursor) if cursor else None
    # One extra row answers "is there another page?" without a second count query.
    rows = member_repository.list_page(session, team.id, limit=limit + 1, after=after)

    has_more = len(rows) > limit
    page = rows[:limit]
    filled = member_repository.filled_slots(session, team.id, [member.id for member in page])

    items = [
        MemberListItem(
            **_summary(member).model_dump(),
            has_left_child=PlacementPosition.LEFT in filled.get(member.id, ()),
            has_right_child=PlacementPosition.RIGHT in filled.get(member.id, ()),
        )
        for member in page
    ]
    next_cursor = encode_cursor(page[-1].created_at, page[-1].id) if has_more and page else None
    return MemberPage(items=items, next_cursor=next_cursor)
