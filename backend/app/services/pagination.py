"""Opaque keyset cursors for paginated collections."""

import base64
import binascii
import uuid
from datetime import datetime

from app.core.errors import ApiError

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100

_SEPARATOR = "|"


def encode_cursor(created_at: datetime, member_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_SEPARATOR}{member_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Turn a cursor back into a sort position, or reject it as a bad request.

    A cursor carries no permission: the query it feeds is still scoped to the
    caller's own team, so a cursor from somewhere else can only point past the end.
    """
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_at_text, _, member_id_text = (
            base64.urlsafe_b64decode(padded.encode()).decode().partition(_SEPARATOR)
        )
        return datetime.fromisoformat(created_at_text), uuid.UUID(member_id_text)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise ApiError(400, "invalid_cursor", "That page reference isn't valid.") from exc


def encode_name_cursor(sort_name: str, member_id: uuid.UUID) -> str:
    """A cursor for a collection ordered by `(lower(name), id)`, such as search results."""
    raw = f"{sort_name}{_SEPARATOR}{member_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_name_cursor(cursor: str) -> tuple[str, uuid.UUID]:
    """The sort position a name cursor names, or a 400.

    Split from the *right*: a member's name may legitimately contain the separator, while
    the identifier that follows it never can.
    """
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        sort_name, separator, member_id_text = (
            base64.urlsafe_b64decode(padded.encode()).decode().rpartition(_SEPARATOR)
        )
        if not separator:
            raise ValueError("A name cursor carries both a name and an identifier.")
        return sort_name, uuid.UUID(member_id_text)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise ApiError(400, "invalid_cursor", "That page reference isn't valid.") from exc
