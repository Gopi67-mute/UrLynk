"""Request and response shapes for safe deletion with subtree reorganization.

Kept in its own module because the result carries the team's refreshed counts, so these
models depend on both the member and the team schemas.
"""

import uuid
from typing import Annotated

from pydantic import StringConstraints

from app.models.member import PlacementPosition
from app.schemas.common import RequestModel, ResponseModel
from app.schemas.member import MemberSummary
from app.schemas.team import TeamCounts

# A plan fingerprint is a SHA-256 digest in hex. Bounded so a request body cannot carry
# an essay in its place; the value itself is only ever compared, never parsed.
PlanToken = Annotated[str, StringConstraints(min_length=32, max_length=128)]


class PlacementPathEntry(ResponseModel):
    """One step on the way down to a destination.

    `placement_position` is the side this member occupies under the entry before it, so
    the first entry — the promoted member, the member the search started from — has
    none.
    """

    id: uuid.UUID
    name: str
    placement_position: PlacementPosition | None


class SubtreeReattachment(ResponseModel):
    """Where the child that is *not* promoted ends up, with everyone below them.

    `member_count` counts that member and every descendant: the number of people who
    move. They keep their positions relative to one another — the only relationship
    that changes is the one at the top, where `member` becomes the
    `destination_position` child of `destination`.
    """

    member: MemberSummary
    member_count: int
    destination: MemberSummary
    destination_position: PlacementPosition
    # From the promoted member down to the destination, inclusive, so the screen can
    # show the leader exactly where the subtree is going.
    destination_path: list[PlacementPathEntry]


class MemberDeletionPlan(ResponseModel):
    """What deleting this member would do. Read-only: requesting it changes nothing.

    Three shapes, by how many members sit directly below the one being deleted:

    - none: `promotable` is empty and both `promoted` and `reattachment` are null. An
      ordinary deletion, with nothing to reorganize.
    - one: that member is the only possible choice, so `promoted` names them and
      `requires_promotion_choice` is false. They take the deleted member's position and
      nothing else moves.
    - two: `requires_promotion_choice` is true and `promotable` holds both, LEFT first.
      Until the leader picks one, `promoted` and `reattachment` are null; asking again
      with that choice fills both in.

    `plan_token` is the fingerprint of this exact plan. Confirming sends it back, and
    the server recalculates the plan under lock and compares: a tree that changed in the
    meantime produces a different fingerprint and the confirmation is refused rather
    than applied to a structure the leader never saw.
    """

    member: MemberSummary
    placement_parent: MemberSummary | None
    placement_position: PlacementPosition | None
    promotable: list[MemberSummary]
    requires_promotion_choice: bool
    promoted: MemberSummary | None
    reattachment: SubtreeReattachment | None
    plan_token: PlanToken


class MemberDeletionConfirm(RequestModel):
    """Go ahead with the plan the leader was shown.

    `promote_member_id` is required whenever anyone is placed below the member being
    deleted, including when there is only one candidate: the choice is stated rather
    than inferred, so a tree that gained a second child after the preview is caught
    instead of silently resolved.

    There is no destination in this request by design. The destination is recalculated
    on the server from the live tree; a client cannot name one, and `plan_token` can
    only confirm the plan the server itself would produce right now.
    """

    promote_member_id: uuid.UUID | None = None
    plan_token: PlanToken


class MemberDeletionResult(ResponseModel):
    """What the operation actually did, and the team's counts after it.

    The counts come back with the result so the screen the leader returns to is correct
    immediately, without a second request.
    """

    deleted_member_id: uuid.UUID
    promoted: MemberSummary | None
    reattached: MemberSummary | None
    reattached_to: MemberSummary | None
    reattached_position: PlacementPosition | None
    counts: TeamCounts
