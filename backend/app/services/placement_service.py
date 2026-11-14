"""Safe deletion: promote one child, reattach the other's subtree, then delete.

Deleting a member who has anyone below them is refused outright by
`member_service.delete_member`, because a plain deletion would take a whole branch with
it. This module is the other answer: it reorganizes the structure first so that nobody
is lost, and only then removes the one member the leader asked to remove.

What it does, in the leader's terms:

- one of the deleted member's children is **promoted** into the position the deleted
  member occupied, keeping their own children exactly where they are;
- the other child, if there is one, is **reattached** with everyone below them at the
  first free position under the promoted member;
- everybody keeps their identity, their details, their photo, their sponsor and their
  place relative to the people below them. One member is removed and exactly one
  parent-child relationship is created.

Where the subtree lands is decided here, never by the client: the search runs against
the live tree inside the operation's own transaction (see `find_first_free_slot`).
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Member, PlacementPosition, Team
from app.models.member import MI_LIFESTYLE_ID_LENGTH, is_valid_mi_lifestyle_id
from app.repositories import member_repository, team_repository
from app.schemas.member import MemberSummary
from app.schemas.placement import (
    MemberDeletionConfirm,
    MemberDeletionPlan,
    MemberDeletionResult,
    PlacementPathEntry,
    SubtreeReattachment,
)
from app.services import member_service, team_service

logger = logging.getLogger("app.placement")

# LEFT before RIGHT, everywhere a pair of slots is inspected or enqueued. Declared once
# so the order of the breadth-first search cannot drift from the order the preview
# describes.
SIDES: tuple[PlacementPosition, PlacementPosition] = (
    PlacementPosition.LEFT,
    PlacementPosition.RIGHT,
)

# The search returns at the first free position, and a tree of n members always has
# n + 1 of them, so a healthy structure stops long before this. It is a backstop against
# damaged data that would otherwise loop: 64 full levels is more members than the
# application will ever hold.
MAX_SEARCH_LEVELS = 64

INVALID_PROMOTION = (
    "invalid_promotion_choice",
    "Choose one of the members placed directly below this member.",
)
PREVIEW_STALE = (
    "reorganization_preview_stale",
    "Your team changed while you were reviewing this. Check the new plan and confirm again.",
)
REORGANIZATION_CONFLICT = (
    "reorganization_conflict",
    "We couldn't reorganize your team safely, so nothing was changed. Refresh and try again.",
)
NO_FREE_POSITION = (
    "reorganization_conflict",
    "We couldn't find a free position for the members being moved, so nothing was changed.",
)
IDENTIFIER_MISSING_CODE = "member_identifier_missing"


@dataclass(frozen=True, slots=True)
class FreeSlot:
    """The first free position found under the member a search started from."""

    member_id: uuid.UUID
    position: PlacementPosition
    # Every step from the start member down to `member_id`, inclusive. The first entry
    # is the start member and carries no side, because the path says nothing about where
    # that member sits — only how to walk down from them.
    path: tuple[tuple[uuid.UUID, PlacementPosition | None], ...]


@dataclass(frozen=True, slots=True)
class DeletionPlan:
    """Everything the operation would do, computed from the tree as it is right now."""

    target: Member
    placement_parent: Member | None
    # Both direct children, LEFT first. Empty for a member with nobody below them.
    promotable: tuple[Member, ...]
    # True only while a member has two children and the leader has not chosen between
    # them: there is nothing to preview until they do.
    requires_promotion_choice: bool
    promoted: Member | None
    reattached: Member | None
    destination: FreeSlot | None


# --- the breadth-first, LEFT-first search ------------------------------------------------


def find_first_free_slot(
    session: Session,
    team_id: uuid.UUID,
    start_id: uuid.UUID,
    *,
    detached_id: uuid.UUID | None = None,
) -> FreeSlot:
    """The first free position at or below `start_id`, searching breadth-first.

    The rule, exactly:

    1. visit the start member;
    2. inspect their LEFT slot, then their RIGHT slot, and return the first one free;
    3. if both are taken, put their LEFT child and then their RIGHT child at the back
       of the queue;
    4. take the next member from the front of the queue and repeat.

    Breadth-first means the result is always as high up the tree as possible, and the
    LEFT-before-RIGHT rule at every step — both when inspecting slots and when queuing
    children — makes it the leftmost such position. The same tree therefore always
    produces the same destination, which is what lets a preview be confirmed later.

    `detached_id` is the member whose subtree is being moved. It is excluded from the
    search: the members moving cannot provide the position they are moving into. It is
    unreachable here in any case — the search only ever walks *downwards* from the
    promoted member, and the member being moved hangs from the member being deleted —
    so encountering it would mean the stored structure is not a tree, and that is
    reported as a conflict rather than built upon.

    One query per level, not per member, and only three columns of each row: a search
    that crosses hundreds of members never loads a name, a note or a photo. A level is
    only ever read when every member above it is full, so a sparse tree costs a single
    query.
    """
    level: list[uuid.UUID] = [start_id]
    # How each queued member was reached, so the path down to the answer can be rebuilt
    # without keeping whole levels around.
    came_from: dict[uuid.UUID, tuple[uuid.UUID, PlacementPosition]] = {}

    for _ in range(MAX_SEARCH_LEVELS):
        slots = member_repository.child_slots(session, team_id, level)
        next_level: list[uuid.UUID] = []

        for member_id in level:
            children = slots.get(member_id, {})

            if detached_id is not None and detached_id in children.values():
                logger.error(
                    "Refusing to reorganize: the subtree being moved was reached from "
                    "inside the promoted member's own branch"
                )
                raise ApiError(409, *REORGANIZATION_CONFLICT)

            free = next((side for side in SIDES if side not in children), None)
            if free is not None:
                return FreeSlot(member_id, free, _path_to(start_id, member_id, came_from))

            # Both sides taken, so this member's children are the next level — LEFT
            # first, which is what makes the search leftmost as well as shallowest.
            for side in SIDES:
                child_id = children[side]
                came_from[child_id] = (member_id, side)
                next_level.append(child_id)

        if not next_level:  # pragma: no cover - a full level always has free slots below
            break
        level = next_level

    # Unreachable for any tree: a member with no free slot has two children, so the
    # search always has somewhere to go, and a finite tree always ends in free slots.
    logger.error("No free position found below member after %s levels", MAX_SEARCH_LEVELS)
    raise ApiError(409, *NO_FREE_POSITION)


def _path_to(
    start_id: uuid.UUID,
    member_id: uuid.UUID,
    came_from: dict[uuid.UUID, tuple[uuid.UUID, PlacementPosition]],
) -> tuple[tuple[uuid.UUID, PlacementPosition | None], ...]:
    """Walk `came_from` back up to the start member, then read it the other way round."""
    steps: list[tuple[uuid.UUID, PlacementPosition | None]] = []
    current = member_id
    while current != start_id:
        parent_id, side = came_from[current]
        steps.append((current, side))
        current = parent_id
    steps.append((start_id, None))
    steps.reverse()
    return tuple(steps)


# --- building a plan ----------------------------------------------------------------------


def _children_of(session: Session, team: Team, target: Member) -> dict[PlacementPosition, Member]:
    return member_repository.children_of(session, team.id, target.id)


def _build_plan(
    session: Session,
    team: Team,
    target: Member,
    *,
    promote_member_id: uuid.UUID | None,
    lock: bool,
) -> DeletionPlan:
    """Work out what deleting `target` would do, from the tree as it stands.

    `lock` is what separates a preview from the real thing. A preview reads; the
    confirmed operation takes a row lock on each member it is about to write, inside a
    transaction that already holds the team's structural lock, so the plan it builds is
    the plan it applies.
    """
    children = _children_of(session, team, target)
    promotable = tuple(children[side] for side in SIDES if side in children)

    parent = (
        member_repository.get(session, team.id, target.placement_parent_id)
        if target.placement_parent_id
        else None
    )

    if promote_member_id is not None:
        promoted = next((child for child in promotable if child.id == promote_member_id), None)
        if promoted is None:
            # Says nothing about whether that ID exists elsewhere: a member of another
            # team reads exactly like one that is simply not a child of this one.
            raise ApiError(422, *INVALID_PROMOTION)
    elif len(promotable) == 1:
        # No choice to make, so there is nothing to ask the leader.
        promoted = promotable[0]
    else:
        # Either nobody is below this member, or there are two and the leader has not
        # said which should take the position.
        return DeletionPlan(
            target=target,
            placement_parent=parent,
            promotable=promotable,
            requires_promotion_choice=len(promotable) == 2,
            promoted=None,
            reattached=None,
            destination=None,
        )

    reattached = next((child for child in promotable if child.id != promoted.id), None)

    # Both of these are written by the operation, so both have to be movable. Checked
    # before the destination is searched: there is no point describing a reorganization
    # the database would refuse, and the preview must not promise one.
    _check_can_be_moved((promoted, reattached))

    if lock:
        # Locked in a fixed order — the members about to be written, by identifier — on
        # top of the team lock this transaction already holds.
        for member in sorted([promoted, *([reattached] if reattached else [])], key=lambda m: m.id):
            if member_repository.get_for_update(session, team.id, member.id) is None:
                raise ApiError(409, *REORGANIZATION_CONFLICT)

    destination = (
        find_first_free_slot(session, team.id, promoted.id, detached_id=reattached.id)
        if reattached is not None
        else None
    )

    return DeletionPlan(
        target=target,
        placement_parent=parent,
        promotable=promotable,
        requires_promotion_choice=False,
        promoted=promoted,
        reattached=reattached,
        destination=destination,
    )


def _check_can_be_moved(members: tuple[Member | None, ...]) -> None:
    """Refuse, before anything is written, a member this operation could not move.

    Moving a member is an UPDATE of their row, and PostgreSQL re-evaluates every CHECK
    constraint against the *whole* new row — not only the columns that changed. So a
    member whose stored identifier does not satisfy
    `ck_members_member_has_mi_lifestyle_id` or `ck_members_mi_lifestyle_id_is_ten_digits`
    cannot be repositioned at all, even though the operation never touches their
    identifier.

    Those rows exist: migration 0005 added both rules NOT VALID, which exempts the rows
    already stored at that moment but governs every insert and update afterwards. A
    member registered before the rule, or one whose unusable identifier was cleared,
    therefore reads back perfectly well and fails the moment anything writes to them.

    Checking here turns that into an answer the leader can act on — add the identifier,
    then reorganize — instead of a constraint violation discovered half-way through the
    transaction. The constraint is still what guarantees it: `_translate` maps the same
    violation to the same code, so a row that changes between this check and the write
    ends in the same place rather than a generic conflict.

    `details` names the member so the app can say who needs attention without showing
    server text or guessing between the two members involved.
    """
    for member in members:
        if member is None or is_valid_mi_lifestyle_id(member.mi_lifestyle_id):
            continue

        logger.info("Reorganization blocked: a member being moved has no usable identifier")
        raise ApiError(
            409,
            IDENTIFIER_MISSING_CODE,
            f"{member.name} needs a Mi Lifestyle ID before they can be moved. Add it to "
            f"their profile, then delete this member.",
            details={
                "member_id": str(member.id),
                "member_name": member.name,
                "required_length": MI_LIFESTYLE_ID_LENGTH,
            },
        )


def _fingerprint(team_id: uuid.UUID, plan: DeletionPlan) -> str:
    """A digest of every structural fact in this plan.

    It exists to answer one question at confirmation time: *is this still the plan the
    leader was shown?* The server recomputes the plan from the live tree, fingerprints
    it, and compares. A tree that changed in a way that matters — a different child
    structure, a destination that is no longer free — produces a different digest and
    the confirmation is refused.

    Only structural facts go in. Renaming a member or editing their phone number does
    not invalidate a plan, because it does not change what the operation would do.

    It is not a capability or an authorization token, and it does not need to be
    unforgeable. Authorization is the verified Clerk token and the team it resolves to;
    the destination is always the one the server has just calculated. The worst a
    fabricated digest can do is agree with the server's own current plan.
    """
    destination = plan.destination
    path = ">".join(f"{step}:{side}" for step, side in (destination.path if destination else ()))
    parts: list[str] = [
        str(team_id),
        str(plan.target.id),
        str(plan.target.placement_parent_id),
        str(plan.target.placement_position),
        str(plan.requires_promotion_choice),
        ",".join(f"{child.id}:{child.placement_position}" for child in plan.promotable),
        str(plan.promoted.id if plan.promoted else None),
        str(plan.reattached.id if plan.reattached else None),
        str(destination.member_id if destination else None),
        str(destination.position if destination else None),
        # The whole way down to the destination, so the digest covers exactly what the
        # preview described rather than only where it ended.
        path,
    ]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def _reattachment(session: Session, team: Team, plan: DeletionPlan) -> SubtreeReattachment | None:
    if plan.reattached is None or plan.destination is None:
        return None

    path_members = member_repository.get_many(
        session, team.id, [member_id for member_id, _ in plan.destination.path]
    )
    destination = path_members.get(plan.destination.member_id)
    if destination is None:  # pragma: no cover - the search just read this member
        raise ApiError(409, *REORGANIZATION_CONFLICT)

    return SubtreeReattachment(
        member=MemberSummary.model_validate(plan.reattached),
        member_count=member_repository.subtree_size(session, team.id, plan.reattached.id),
        destination=MemberSummary.model_validate(destination),
        destination_position=plan.destination.position,
        destination_path=[
            PlacementPathEntry(
                id=member_id,
                name=path_members[member_id].name,
                placement_position=side,
            )
            for member_id, side in plan.destination.path
            if member_id in path_members
        ],
    )


def _plan_response(session: Session, team: Team, plan: DeletionPlan) -> MemberDeletionPlan:
    return MemberDeletionPlan(
        member=MemberSummary.model_validate(plan.target),
        placement_parent=(
            MemberSummary.model_validate(plan.placement_parent) if plan.placement_parent else None
        ),
        placement_position=plan.target.placement_position,
        promotable=[MemberSummary.model_validate(child) for child in plan.promotable],
        requires_promotion_choice=plan.requires_promotion_choice,
        promoted=MemberSummary.model_validate(plan.promoted) if plan.promoted else None,
        reattachment=_reattachment(session, team, plan),
        plan_token=_fingerprint(team.id, plan),
    )


# --- the two operations -------------------------------------------------------------------


def _check_deletable(session: Session, team: Team, target: Member) -> None:
    """The refusals that apply however the deletion is attempted.

    The same rules `member_service.delete_member` applies, and deliberately the same
    codes: reorganization is a way to keep a branch intact, never a way around the
    leader's own record or an independent sponsor relationship.
    """
    if target.is_root:
        raise ApiError(409, *member_service.ROOT_UNDELETABLE)
    if member_repository.is_sponsor(session, team.id, target.id):
        raise ApiError(409, *member_service.SPONSORS_OTHERS)


def build_plan(
    session: Session,
    team: Team,
    member_id: uuid.UUID,
    *,
    promote_member_id: uuid.UUID | None = None,
) -> MemberDeletionPlan:
    """What deleting this member would do. Reads only — nothing is written or deleted.

    Asking for a plan is not a step towards the deletion: there is no reservation, no
    lock held past the request and no record that it was asked for. A leader can look
    and walk away, and the team is exactly as it was.
    """
    target = member_repository.get(session, team.id, member_id)
    if target is None:
        raise ApiError(404, *member_service.MEMBER_NOT_FOUND)

    _check_deletable(session, team, target)
    plan = _build_plan(session, team, target, promote_member_id=promote_member_id, lock=False)
    return _plan_response(session, team, plan)


def delete_with_reorganization(
    session: Session, team: Team, member_id: uuid.UUID, data: MemberDeletionConfirm
) -> MemberDeletionResult:
    """Reorganize the structure and delete the member, or change nothing at all.

    One transaction, in this order:

    1. **take the team's structural lock.** Every operation that changes placement takes
       it first (see `team_repository.lock_structure`), so no registration can fill the
       destination between the search below and the write, and two reorganizations in
       one team run one after the other rather than at the same time.
    2. **lock and validate the member being deleted:** in the caller's team, not the
       leader's own root record, and not named as anyone's sponsor.
    3. **rebuild the plan from the live tree**, locking the members it will write, and
       recalculate the destination breadth-first.
    4. **compare it with the plan the leader confirmed.** A different fingerprint means
       the tree moved under them, and the answer is a refusal with nothing written.
    5. **apply it:** the promoted child takes the deleted member's parent and side, the
       other child's subtree is reattached at the destination, and only then is the
       member deleted — by which point nobody references them.
    6. **check the invariants** on the result, with the transaction still open.
    7. **commit.**

    Any failure at any step rolls the whole thing back, so there is no such thing as a
    half-reorganized tree: either one member is gone and everyone else is accounted for,
    or nothing happened.

    Step 5 needs the placement-slot constraint deferred, because promoting a child into
    the deleted member's position is a swap and the intermediate state holds that slot
    twice for one statement. The constraint is re-armed in the same transaction, before
    the invariants are checked, so a duplicate slot is caught here and not at COMMIT.
    """
    team_repository.lock_structure(session, team.id)

    target = member_repository.get_for_update(session, team.id, member_id)
    if target is None:
        raise ApiError(404, *member_service.MEMBER_NOT_FOUND)
    _check_deletable(session, team, target)

    children = _children_of(session, team, target)
    # The choice is always stated, never inferred — including when only one member could
    # be promoted. A target that gained or lost a child since the preview is then caught
    # as a mismatch instead of being quietly resolved into a different operation.
    if children and data.promote_member_id is None:
        raise ApiError(422, *INVALID_PROMOTION)
    if not children and data.promote_member_id is not None:
        raise ApiError(422, *INVALID_PROMOTION)

    plan = _build_plan(session, team, target, promote_member_id=data.promote_member_id, lock=True)
    if plan.requires_promotion_choice:  # pragma: no cover - a choice was required above
        raise ApiError(422, *INVALID_PROMOTION)

    if _fingerprint(team.id, plan) != data.plan_token:
        logger.info("Refused a confirmation whose plan no longer matches the team structure")
        raise ApiError(409, *PREVIEW_STALE)

    members_before = member_repository.count_all(session, team.id)

    try:
        _apply(session, plan)
        _verify(session, team, plan, members_before=members_before)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise _translate(exc) from exc
    except ApiError:
        session.rollback()
        raise

    # Identifiers and structure only: the members involved are not described in a log.
    logger.info(
        "Member deleted with reorganization (team=%s, promoted=%s, reattached=%s)",
        team.id,
        plan.promoted.id if plan.promoted else None,
        plan.reattached.id if plan.reattached else None,
    )

    destination = (
        member_repository.get(session, team.id, plan.destination.member_id)
        if plan.destination
        else None
    )

    return MemberDeletionResult(
        deleted_member_id=member_id,
        promoted=MemberSummary.model_validate(plan.promoted) if plan.promoted else None,
        reattached=MemberSummary.model_validate(plan.reattached) if plan.reattached else None,
        reattached_to=MemberSummary.model_validate(destination) if destination else None,
        reattached_position=plan.destination.position if plan.destination else None,
        # Read after the commit, so the screen the leader returns to is right without a
        # second request.
        counts=team_service.build_overview(session, team).counts,
    )


def _apply(session: Session, plan: DeletionPlan) -> None:
    """Write the plan: promote, reattach, delete. Nothing else touches these rows.

    The three writes are flushed separately and in this order on purpose. The promotion
    and the reattachment both have to happen while the member being deleted still
    exists, because their children still reference them until they are moved; the
    deletion has to happen after both, because the placement foreign key refuses to
    remove a member anyone still points at.
    """
    promoted = plan.promoted
    if promoted is None:
        # Nobody is placed below this member, so there is nothing to reorganize and no
        # swap to make: the member is simply removed, exactly as an ordinary deletion
        # removes them.
        member_repository.delete(session, plan.target)
        session.flush()
        return

    member_repository.defer_slot_checks(session)

    # The promoted member takes the deleted member's place exactly: same parent, same
    # side. Their own children are not touched, so their branch moves up with them.
    promoted.placement_parent_id = plan.target.placement_parent_id
    promoted.placement_position = plan.target.placement_position

    if plan.reattached is not None and plan.destination is not None:
        # One new relationship, at the top of the subtree. Everyone below keeps the
        # parent and the side they already had.
        plan.reattached.placement_parent_id = plan.destination.member_id
        plan.reattached.placement_position = plan.destination.position

    session.flush()

    member_repository.delete(session, plan.target)
    session.flush()

    # Runs every check queued while the constraint was deferred, here rather than at
    # COMMIT, so a duplicated slot becomes a handled conflict and a rollback.
    member_repository.enforce_slot_checks(session)


def _verify(session: Session, team: Team, plan: DeletionPlan, *, members_before: int) -> None:
    """Check the tree is sound before any of this is committed.

    The database already guarantees most of it — one member per slot, no self-parent,
    every reference inside one team. What a constraint cannot express is whether the
    result is still a *tree*: that every member still hangs from the root, through a
    chain with no cycle in it. That is exactly what this operation could break, so it
    is checked here, while a rollback is still possible.
    """
    if member_repository.get(session, team.id, plan.target.id) is not None:
        raise ApiError(409, *REORGANIZATION_CONFLICT)

    for member in (plan.promoted, plan.reattached):
        if member is None:
            continue
        chain = member_repository.ancestor_chain_status(session, team.id, member.id)
        if chain.has_cycle or not chain.reaches_root:
            logger.error(
                "Reorganization would leave a member off the tree (cycle=%s, reaches_root=%s)",
                chain.has_cycle,
                chain.reaches_root,
            )
            raise ApiError(409, *REORGANIZATION_CONFLICT)

    if member_repository.has_duplicate_slots(session, team.id):
        logger.error("Reorganization would leave two members in one position")
        raise ApiError(409, *REORGANIZATION_CONFLICT)

    # Exactly one member left: not the subtree that was moved, and not the promoted
    # member's own branch.
    remaining = member_repository.count_all(session, team.id)
    if remaining != members_before - 1:
        logger.error(
            "Reorganization changed the member count by %s, not 1", members_before - remaining
        )
        raise ApiError(409, *REORGANIZATION_CONFLICT)


# A member whose stored identifier breaks either rule cannot be moved at all, because
# an UPDATE re-checks the whole row. `_check_can_be_moved` refuses this before writing;
# these mappings catch the same thing if the row changes in between, so the answer stays
# the specific one either way.
_IDENTIFIER_CONSTRAINTS = frozenset(
    {
        "ck_members_member_has_mi_lifestyle_id",
        "ck_members_mi_lifestyle_id_is_ten_digits",
    }
)


def _translate(exc: IntegrityError) -> ApiError:
    """A constraint tripped inside the operation, after the checks said it was safe.

    Every branch logs the constraint name and returns a code instead: the driver's own
    message can quote stored values and name columns, and none of that belongs in an
    answer to a client.
    """
    constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)

    if constraint == member_repository.PLACEMENT_SLOT_CONSTRAINT:
        logger.info("Reorganization lost a race for a position (%s)", constraint)
        return ApiError(
            409,
            "reorganization_conflict",
            "That position was taken while we were reorganizing, so nothing was changed.",
        )

    if constraint in _IDENTIFIER_CONSTRAINTS:
        logger.info("Reorganization refused by identifier constraint %s", constraint)
        return ApiError(
            409,
            IDENTIFIER_MISSING_CODE,
            "A member being moved needs a Mi Lifestyle ID before they can be moved. Add "
            "it to their profile, then delete this member.",
        )

    logger.warning("Reorganization rejected by constraint %s", constraint)
    return ApiError(409, *REORGANIZATION_CONFLICT)
