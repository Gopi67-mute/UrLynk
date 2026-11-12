import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_team
from app.db.session import get_db
from app.models import Team
from app.schemas.member import (
    MemberChildren,
    MemberCreate,
    MemberDetail,
    MemberPage,
    MemberPhotoDetail,
    MemberPhotoUpload,
    MemberUpdate,
    RecentMember,
)
from app.services import member_photo_service, member_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/members", tags=["members"])

# Long enough for a cursor this API issued, short enough not to accept an essay.
MAX_CURSOR_LENGTH = 256

# How many recent members the dashboard section may ask for. The ceiling is the API's,
# not the client's: a larger `limit` is rejected rather than honoured.
DEFAULT_RECENT_LIMIT = 5
MAX_RECENT_LIMIT = 20


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
    - a member with anyone placed below them is refused (409 `member_has_children`),
      so a subtree is never cascade-deleted;
    - a member another record names as sponsor is refused (409
      `member_sponsors_others`), because that relationship would otherwise be discarded.

    A member of any other team is a 404, exactly as if they did not exist. Deleting a
    member takes their profile photo with them, and nothing else.
    """
    member_service.delete_member(session, team, member_id)
    return Response(status_code=204)


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
