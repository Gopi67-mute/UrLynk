"""Profile photos: validate, store, read back and remove.

Every function takes the caller's own `Team`, so a photo can only ever be read or
written for a member of that team. A member belonging to another leader reads exactly
like one that does not exist.
"""

import base64
import binascii
import logging
import uuid

from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Team
from app.models.member_photo import MAX_PHOTO_BYTES, PHOTO_MAGIC_BYTES
from app.repositories import member_photo_repository, member_repository
from app.schemas.member import MemberPhotoDetail, MemberPhotoUpload

logger = logging.getLogger("app.member_photos")

MEMBER_NOT_FOUND = ("member_not_found", "We couldn't find that member in your team.")
PHOTO_NOT_FOUND = ("photo_not_found", "This member doesn't have a photo.")


def _not_found(code_and_message: tuple[str, str]) -> ApiError:
    code, message = code_and_message
    return ApiError(404, code, message)


def _decode(upload: MemberPhotoUpload) -> bytes:
    """Turn the request's base64 into image bytes, or refuse it.

    Three things have to hold before anything is stored: the data is really base64, it
    is small enough, and the bytes begin the way the declared format must begin. The
    last one is what stops a file of some other kind — or of no kind — being kept and
    later served back to the app as an image.
    """
    try:
        image = base64.b64decode(upload.data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ApiError(
            422, "invalid_photo", "That photo couldn't be read. Choose another one."
        ) from exc

    if not image:
        raise ApiError(422, "invalid_photo", "That photo couldn't be read. Choose another one.")

    if len(image) > MAX_PHOTO_BYTES:
        raise ApiError(
            422,
            "photo_too_large",
            f"Photos need to be under {MAX_PHOTO_BYTES // 1024} KB. Choose a smaller one.",
        )

    if not image.startswith(PHOTO_MAGIC_BYTES[upload.content_type]):
        raise ApiError(
            422,
            "invalid_photo",
            "That file isn't a photo of the type it claims to be. Choose another one.",
        )

    return image


def _require_member(session: Session, team: Team, member_id: uuid.UUID) -> None:
    if member_repository.get(session, team.id, member_id) is None:
        raise _not_found(MEMBER_NOT_FOUND)


def _as_data_uri(content_type: str, image: bytes) -> str:
    return f"data:{content_type};base64,{base64.b64encode(image).decode('ascii')}"


def get_photo(session: Session, team: Team, member_id: uuid.UUID) -> MemberPhotoDetail:
    """The member's photo as a data URI, or 404 when they have none.

    "No such member in your team" and "that member has no photo" are separate codes so
    the app can fall back to initials for the second without treating it as a failure.
    Neither answer says anything about another team: a member ID that is not in this
    team is simply not found.
    """
    photo = member_photo_repository.get(session, team.id, member_id)
    if photo is None:
        _require_member(session, team, member_id)
        raise _not_found(PHOTO_NOT_FOUND)

    return MemberPhotoDetail(
        member_id=photo.member_id,
        content_type=photo.content_type,
        updated_at=photo.updated_at,
        data_uri=_as_data_uri(photo.content_type, photo.image),
    )


def set_photo(
    session: Session, team: Team, member_id: uuid.UUID, upload: MemberPhotoUpload
) -> MemberPhotoDetail:
    """Store or replace the member's photo.

    The data is validated before any row is locked, and the member is then locked for
    the rest of the transaction, so the stored bytes and the `photo_updated_at` marker
    on the member always move together: a client is never told a photo exists and then
    fails to find it, nor left caching an old version because the marker lagged behind.
    """
    image = _decode(upload)

    member = member_repository.get_for_update(session, team.id, member_id)
    if member is None:
        raise _not_found(MEMBER_NOT_FOUND)

    updated_at = member_photo_repository.upsert(
        session, team.id, member_id, content_type=upload.content_type, image=image
    )
    member.photo_updated_at = updated_at
    session.commit()

    # The size only, never the image or the member: a log line must not describe a person.
    logger.info("Member photo saved (%d bytes)", len(image))
    return MemberPhotoDetail(
        member_id=member_id,
        content_type=upload.content_type,
        updated_at=updated_at,
        data_uri=_as_data_uri(upload.content_type, image),
    )


def delete_photo(session: Session, team: Team, member_id: uuid.UUID) -> None:
    """Remove the member's photo. Already having none is not an error."""
    member = member_repository.get_for_update(session, team.id, member_id)
    if member is None:
        raise _not_found(MEMBER_NOT_FOUND)

    member_photo_repository.delete_for_member(session, team.id, member_id)
    member.photo_updated_at = None
    session.commit()
    logger.info("Member photo removed")
