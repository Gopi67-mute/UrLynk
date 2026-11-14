import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_team
from app.db.session import get_db
from app.models import Team
from app.models.member import MEMBER_NAME_MAX_LENGTH
from app.schemas.member import (
    MemberChildren,
    MemberCreate,
    MemberDetail,
    MemberPage,
    MemberPhotoDetail,
    MemberPhotoUpload,
    MemberPlacementPath,
    MemberSearchPage,
    MemberUpdate,
    RecentMember,
)
from app.schemas.placement import (
    MemberDeletionConfirm,
    MemberDeletionPlan,
    MemberDeletionResult,
)
from app.services import member_photo_service, member_service, placement_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/members", tags=["members"])

# Long enough for a cursor this API issued, short enough not to accept an essay.
MAX_CURSOR_LENGTH = 256

# How many recent members the dashboard section may ask for. The ceiling is the API's,
# not the client's: a larger `limit` is rejected rather than honoured.
DEFAULT_RECENT_LIMIT = 5
MAX_RECENT_LIMIT = 20

# A search term can be no longer than the longest name it could match, so an oversized
# query is refused before it reaches the database rather than scanned for.
MAX_SEARCH_QUERY_LENGTH = MEMBER_NAME_MAX_LENGTH
DEFAULT_SEARCH_LIMIT = 25
MAX_SEARCH_LIMIT = 50


@router.get("", response_model=MemberPage)
def list_members(
    limit: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(None, max_length=MAX_CURSOR_LENGTH),
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberPage:
    """One page of the caller's team, oldest first (the leader comes first).

    Bounded by `limit` and paged with the opaque `next_cursor` from the previous page.
    Each item says whether its LEFT and RIGHT slots are already filled.
    """
    return member_service.list_members(session, team, limit=limit, cursor=cursor)


@router.post("", response_model=MemberDetail, status_code=201)
def register_member(
    payload: MemberCreate,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberDetail:
    """Add a member to a free LEFT or RIGHT slot under an existing parent.

    The placement parent and sponsor must be in the caller's own team; anything else
    is a 404. An occupied slot is a 409 and never overwrites the member already there.
    """
    return member_service.create_member(session, team, payload)


# Declared before "/{member_id}": FastAPI matches in order, so without this a request
# for /members/recent would try to read "recent" as a member ID.
@router.get("/recent", response_model=list[RecentMember])
def read_recent_members(
    limit: int = Query(DEFAULT_RECENT_LIMIT, ge=1, le=MAX_RECENT_LIMIT),
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> list[RecentMember]:
    """The caller's most recently registered members, newest first.

    Built from the members table and its `created_at` values, so every entry is a real
    record. The leader's own root member is not included: it was created with the team
    rather than registered, so a team with no members yet returns an empty list.
    """
    return member_service.list_recent_members(session, team, limit=limit)


# Also declared before "/{member_id}", for the same reason "/recent" is.
@router.get("/search", response_model=MemberSearchPage)
def search_members(
    q: str = Query(
        ...,
        min_length=1,
        max_length=MAX_SEARCH_QUERY_LENGTH,
        description="Part of a member's name, or the first digits of a Mi Lifestyle ID.",
    ),
    limit: int = Query(DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT),
    cursor: str | None = Query(None, max_length=MAX_CURSOR_LENGTH),
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberSearchPage:
    """Find members of your own team by name or Mi Lifestyle ID.

    The name is matched anywhere within it and without regard to case, so "nair" finds
    "Meera Nair". A query made entirely of digits is also matched against Mi Lifestyle
    IDs as a prefix, so the first few digits of one narrow it down and a full identifier
    finds exactly that member — leading zeros included, since an identifier is text.
    Surrounding spaces are ignored; a query that is nothing but spaces is refused (422
    `search_query_required`) rather than answered with the whole team.

    Results are ordered by name, case-insensitively, with the member id breaking ties, so
    the order never changes between two identical requests and no member can appear
    twice or be skipped across pages. Each page is bounded by `limit`; `next_cursor` asks
    for the one after it, with the same `q`.

    Scoped to the team the verified token resolves to, like every other route here. There
    is no team parameter to supply, and a member of another leader's team can be neither
    matched nor counted.
    """
    return member_service.search_members(session, team, query=q, limit=limit, cursor=cursor)


@router.get("/{member_id}", response_model=MemberDetail)
def read_member(
    member_id: uuid.UUID,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberDetail:
    """One member of the caller's team. A member of any other team reads as 404."""
    return member_service.get_member_detail(session, team, member_id)


@router.patch("/{member_id}", response_model=MemberDetail)
def edit_member(
    member_id: uuid.UUID,
    payload: MemberUpdate,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberDetail:
    """Change a member's own details. Partial: untouched fields keep their values.

    Sending `null` for an optional field clears it; leaving a field out leaves it
    alone. The leader's own record is edited the same way as anyone else's, which is
    how their preferred name and business profile are maintained.

    Structural fields are not editable here and a request naming one is refused (422),
    along with any field this API does not know: no edit can move a member, change
    their side, make them a leader, or move them to another team. A member of another
    team is a 404, and a Mi Lifestyle ID already used in this team is a 409.
    """
    return member_service.update_member(session, team, member_id, payload)


@router.delete("/{member_id}", status_code=204, response_class=Response)
def remove_member(
    member_id: uuid.UUID,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> Response:
    """Permanently delete one member of the caller's team. One member, never a branch.

    Only an eligible member can go, and the rules are refusals rather than silent
    repairs, each with its own stable code:

    - the leader's own root record is never deletable (409 `root_member_undeletable`);
    - a member with anyone placed below them is refused (409 `member_has_children`), so
      a subtree is never cascade-deleted. Removing such a member without losing their
      branch is a separate, explicitly confirmed operation: read
      `GET /api/v1/members/{id}/deletion-plan`, then `POST
      /api/v1/members/{id}/deletion`. This endpoint never reorganizes anything, so no
      ordinary delete can trigger one by accident;
    - a member another record names as sponsor is refused (409
      `member_sponsors_others`), because that relationship would otherwise be discarded.

    A member of any other team is a 404, exactly as if they did not exist. Deleting a
    member takes their profile photo with them, and nothing else.
    """
    member_service.delete_member(session, team, member_id)
    return Response(status_code=204)


@router.get("/{member_id}/deletion-plan", response_model=MemberDeletionPlan)
def read_member_deletion_plan(
    member_id: uuid.UUID,
    promote: uuid.UUID | None = Query(
        None, description="Which of the member's two children should take their position."
    ),
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberDeletionPlan:
    """What deleting this member would do, before anything is done.

    Read-only, and read-only in the strict sense: no row is written, no position is
    reserved and no record is kept that the plan was asked for. A leader can look at it
    and walk away, and their team is exactly as it was.

    The shape of the answer depends on who is placed below the member:

    - nobody: there is nothing to reorganize, and `DELETE /api/v1/members/{id}` removes
      them;
    - one member: that member is the only candidate, so the plan already names them as
      the promotion;
    - two members: `requires_promotion_choice` is true and `promotable` holds both,
      LEFT first. Ask again with `?promote=` set to the chosen one to see where the
      other member's branch would go.

    The destination for that branch is calculated here, breadth-first and LEFT-first
    from the promoted member, and `destination_path` spells out the way down to it. It
    is never taken from the client.

    `plan_token` fingerprints this exact plan. Send it back to confirm; a team that
    changed in the meantime produces a different fingerprint, and the confirmation is
    refused (409 `reorganization_preview_stale`) rather than applied to a structure the
    leader never saw.

    Refused for the same reasons the deletion itself is: 409 `root_member_undeletable`
    for the leader's own record, 409 `member_sponsors_others` when another record names
    this member as sponsor. A member of another team is 404.
    """
    return placement_service.build_plan(session, team, member_id, promote_member_id=promote)


@router.post("/{member_id}/deletion", response_model=MemberDeletionResult)
def confirm_member_deletion(
    member_id: uuid.UUID,
    payload: MemberDeletionConfirm,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberDeletionResult:
    """Reorganize the team and delete this member, in one transaction or not at all.

    This is the only way to remove a member who has anyone placed below them. The
    promoted child — named by `promote_member_id`, and required whenever the member has
    children — takes the deleted member's parent and side, and the other child's whole
    branch is reattached at the position the server calculates. Every surviving member
    keeps their ID, their details, their photo, their sponsor and their own branch.

    The plan is rebuilt and re-checked here against the live tree, under the team's
    structural lock, and compared with `plan_token`:

    - 409 `reorganization_preview_stale` — the team changed since the preview. Nothing
      was written; fetch the plan again and show the leader the new one.
    - 422 `invalid_promotion_choice` — `promote_member_id` is not one of this member's
      two direct children, or is missing when the member has children (or present when
      they have none).
    - 409 `root_member_undeletable`, 409 `member_sponsors_others` — the same refusals as
      an ordinary deletion; reorganizing is not a way around either.
    - 409 `reorganization_conflict` — the result would not have been a sound tree, so
      the whole transaction was rolled back.

    A second, identical confirmation finds the member already gone and is a 404, so a
    retry or a double tap cannot delete twice or move anybody twice.

    Returns what was done, with the team's refreshed counts.
    """
    return placement_service.delete_with_reorganization(session, team, member_id, payload)


@router.get("/{member_id}/placement-path", response_model=MemberPlacementPath)
def read_placement_path(
    member_id: uuid.UUID,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberPlacementPath:
    """The exact chain of placements from your root member down to this one.

    `steps` runs root first and the requested member last, and each step's
    `placement_position` is the side it occupies under the step before it. The root has
    none, because nobody is above it. Reading the list top to bottom is reading the way
    down to the member: LEFT, then RIGHT, then LEFT, exactly as the team is built.

    Calculated by PostgreSQL from the real placement relationships — one recursive walk
    up the chain, then one read for the members on it. Never from registration order,
    identifiers or timestamps, and never by downloading the tree.

    A member of another team is 404 `member_not_found`. A chain that does not reach the
    root — a cycle, or a missing parent — is 409 `placement_chain_invalid` rather than a
    partial path presented as a whole one, and a chain longer than 1,000 steps is 409
    `placement_path_too_deep`.
    """
    return member_service.get_placement_path(session, team, member_id)


@router.get("/{member_id}/children", response_model=MemberChildren)
def read_member_children(
    member_id: uuid.UUID,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberChildren:
    """A member's direct LEFT and RIGHT members. A free slot comes back as null.

    Only the two direct slots: no subtree is ever downloaded.
    """
    return member_service.get_children(session, team, member_id)


@router.get("/{member_id}/photo", response_model=MemberPhotoDetail)
def read_member_photo(
    member_id: uuid.UUID,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberPhotoDetail:
    """A member's profile photo, as a data URI ready to render.

    404 `photo_not_found` when the member has none, which the app answers by drawing
    their initials. A member of another team is 404 `member_not_found`.

    The image travels inside the JSON response on purpose: session tokens are
    short-lived, so an image URL carrying one could not be cached by the client.
    """
    return member_photo_service.get_photo(session, team, member_id)


@router.put("/{member_id}/photo", response_model=MemberPhotoDetail)
def replace_member_photo(
    member_id: uuid.UUID,
    payload: MemberPhotoUpload,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> MemberPhotoDetail:
    """Set or replace a member's profile photo.

    The data is base64 in the request body and must decode to a small image of the
    declared type: 422 `invalid_photo` if the bytes are not one, 422 `photo_too_large`
    if it exceeds the limit. The app resizes before uploading, so an ordinary camera
    photo is well within it.
    """
    return member_photo_service.set_photo(session, team, member_id, payload)


@router.delete("/{member_id}/photo", status_code=204, response_class=Response)
def remove_member_photo(
    member_id: uuid.UUID,
    team: Team = Depends(get_current_team),
    session: Session = Depends(get_db),
) -> Response:
    """Remove a member's profile photo. Removing one they do not have is not an error."""
    member_photo_service.delete_photo(session, team, member_id)
    return Response(status_code=204)
