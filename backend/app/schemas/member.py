import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator, model_validator

from app.models.member import (
    MEMBER_NAME_MAX_LENGTH,
    MI_LIFESTYLE_ID_LENGTH,
    NOTES_MAX_LENGTH,
    PHONE_NUMBER_MAX_LENGTH,
    PlacementPosition,
)
from app.models.member_photo import MAX_PHOTO_BYTES
from app.schemas.common import RequestModel, ResponseModel

MemberName = Annotated[str, StringConstraints(min_length=1, max_length=MEMBER_NAME_MAX_LENGTH)]
# Exactly ten digits, and nothing else. The length is fixed rather than bounded, so
# "123456789" and "12345678901" are both refused for the same reason.
MiLifestyleId = Annotated[
    str,
    StringConstraints(
        min_length=MI_LIFESTYLE_ID_LENGTH,
        max_length=MI_LIFESTYLE_ID_LENGTH,
    ),
]
PhoneNumber = Annotated[str, StringConstraints(min_length=6, max_length=PHONE_NUMBER_MAX_LENGTH)]
Notes = Annotated[str, StringConstraints(min_length=1, max_length=NOTES_MAX_LENGTH)]

# Joining dates: a day of slack, because the member's calendar day can be ahead of the
# server's UTC day.
JOINING_DATE_FUTURE_SLACK = timedelta(days=1)
EARLIEST_JOINING_DATE = date(2000, 1, 1)

_PHONE_ALLOWED = set("0123456789 +-().")
_MINIMUM_PHONE_DIGITS = 6

PhotoContentType = Literal["image/jpeg", "image/png", "image/webp"]

# The hard ceiling on the encoded field, which bounds the request body itself.
#
# Deliberately looser than the stored limit: base64 is four characters per three bytes,
# so a payload exactly at `MAX_PHOTO_BYTES` would leave no room for the service to
# recognise an oversized photo and say so. The headroom means a client that sends a
# photo somewhat too large gets a specific "too large" answer naming the limit, while a
# payload far beyond any plausible avatar is refused before it is even decoded.
PHOTO_SIZE_TOLERANCE = 4
MAX_PHOTO_BASE64_LENGTH = ((MAX_PHOTO_BYTES * PHOTO_SIZE_TOLERANCE + 2) // 3) * 4


def _reject_control_characters(value: str, label: str) -> str:
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{label} contains characters that aren't allowed.")
    return value


class _MemberProfileFields(RequestModel):
    """The optional member details that creating and updating both accept.

    Every rule lives here once, so a value that would be refused on create cannot slip
    in through an update. None of these fields positions a member: placement is set when
    the member is created and is never part of an ordinary profile edit.
    """

    mi_lifestyle_id: MiLifestyleId | None = None
    phone_number: PhoneNumber | None = None
    # Independent of placement: who introduced this member.
    sponsor_id: uuid.UUID | None = None
    joining_date: date | None = None
    notes: Notes | None = None

    @field_validator("mi_lifestyle_id")
    @classmethod
    def _check_mi_lifestyle_id(cls, value: str | None) -> str | None:
        """Exactly ten digits, kept as text.

        `str.isdigit()` is deliberately not used: it accepts Unicode digits such as
        Arabic-Indic or superscript numerals, which are not what an ID is made of. The
        check is against ASCII 0-9 only.

        The value is never parsed as a number, so leading zeros survive the round trip
        intact — "0012345678" is stored and returned exactly as given.
        """
        if value is None:
            return None
        _reject_control_characters(value, "The Mi Lifestyle ID")
        if len(value) != MI_LIFESTYLE_ID_LENGTH or not all(
            character in "0123456789" for character in value
        ):
            raise ValueError(
                f"The Mi Lifestyle ID must be exactly {MI_LIFESTYLE_ID_LENGTH} digits."
            )
        return value

    @field_validator("phone_number")
    @classmethod
    def _check_phone_number(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not set(value) <= _PHONE_ALLOWED:
            raise ValueError("The phone number can only contain digits, spaces and + - ( ) .")
        if sum(character.isdigit() for character in value) < _MINIMUM_PHONE_DIGITS:
            raise ValueError("The phone number needs at least 6 digits.")
        return value

    @field_validator("joining_date")
    @classmethod
    def _check_joining_date(cls, value: date | None) -> date | None:
        if value is None:
            return None
        if value < EARLIEST_JOINING_DATE:
            raise ValueError("The joining date is too far in the past.")
        if value > datetime.now().date() + JOINING_DATE_FUTURE_SLACK:
            raise ValueError("The joining date cannot be in the future.")
        return value

    @field_validator("notes")
    @classmethod
    def _check_free_text(cls, value: str | None) -> str | None:
        """Newlines are welcome here; control characters are not."""
        if value is None:
            return None
        if any(
            ord(character) < 32 and character not in "\n\r\t" or ord(character) == 127
            for character in value
        ):
            raise ValueError("That text contains characters that aren't allowed.")
        return value


class MemberCreate(_MemberProfileFields):
    """A new member and where it sits in the binary structure.

    There is no `team_id` here by design: the team comes from the verified token.
    `is_root` is not accepted either — only account initialization creates a root.
    """

    name: MemberName
    placement_parent_id: uuid.UUID
    placement_position: PlacementPosition

    # Required here, unlike on the optional base: every member registered through the
    # app carries a Mi Lifestyle ID. Omitting it is a 422 naming the field, rather than
    # a member quietly saved without one. The base's validator still applies, so the
    # ten-digit rule is stated in exactly one place.
    mi_lifestyle_id: MiLifestyleId

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _reject_control_characters(value, "The name")


class MemberUpdate(_MemberProfileFields):
    """A partial edit of a member's own details.

    Only the fields present in the request body are touched. Sending `null` for an
    optional field clears it; leaving a field out keeps whatever is stored.

    What is *not* here is the point of the schema. `extra="forbid"` means a request
    naming `team_id`, `id`, `is_root`, `placement_parent_id`, `placement_position` or
    any Clerk identifier is refused outright rather than quietly ignored, so an edit
    can never move a member, adopt them into another team, or make them a leader.
    Placement changes have their own operation, and arrive in a later phase.
    """

    name: MemberName | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else _reject_control_characters(value, "The name")

    @model_validator(mode="after")
    def _name_cannot_be_cleared(self) -> "MemberUpdate":
        # Every member has a name. Omitting it keeps the current one; sending null is a
        # request to erase it, which is refused rather than silently ignored.
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("The name can't be removed. Leave it out to keep the current one.")
        return self

    def changes(self) -> dict[str, object]:
        """Exactly the fields the request asked to change, `None` meaning "clear it"."""
        return self.model_dump(exclude_unset=True)


class MemberSummary(ResponseModel):
    """Enough to list or preview a member."""

    id: uuid.UUID
    name: str
    mi_lifestyle_id: str | None
    placement_position: PlacementPosition | None
    is_root: bool
    joining_date: date | None
    created_at: datetime
    # When this member's photo last changed, or null when they have none. It doubles as
    # the photo's version, so a client can cache one by it and refetch only on a change.
    photo_updated_at: datetime | None


class MemberListItem(MemberSummary):
    """A summary plus which of its two placement slots are already filled.

    The Add Member screen uses these flags to stop a member being offered a slot that
    is taken. The backend re-checks it regardless.
    """

    has_left_child: bool
    has_right_child: bool


class RecentMember(MemberSummary):
    """A newly registered member, as the dashboard's Recently Added section shows them.

    The parent's name is included because the section states where each member landed,
    and looking each one up separately would be a request per row.
    """

    placement_parent_name: str | None


class MemberDetail(MemberSummary):
    phone_number: str | None
    notes: str | None
    placement_parent: MemberSummary | None
    sponsor: MemberSummary | None
    has_left_child: bool
    has_right_child: bool


class MemberChildren(ResponseModel):
    """One parent's two direct placement slots. `None` means the slot is free."""

    parent_id: uuid.UUID
    left: MemberSummary | None
    right: MemberSummary | None


class MemberPage(ResponseModel):
    items: list[MemberListItem]
    # Pass back as `cursor` for the next page; null when this is the last one.
    next_cursor: str | None = Field(default=None)


class MemberPhotoUpload(RequestModel):
    """A profile photo, base64 encoded inside an ordinary JSON request.

    Only the length and the declared type are checked here. The service decodes the
    data once and confirms the bytes really are an image of that type before anything
    is stored, so a mislabelled file cannot be served back later as an image.
    """

    content_type: PhotoContentType
    data: Annotated[str, StringConstraints(min_length=1, max_length=MAX_PHOTO_BASE64_LENGTH)]


class MemberPhotoDetail(ResponseModel):
    """A member's photo, ready to render.

    `data_uri` is the whole image, so showing it needs no second, separately
    authorized request — which matters because session tokens are short-lived and an
    image URL carrying one could not be cached. `updated_at` is the version to cache by.
    """

    member_id: uuid.UUID
    content_type: str
    updated_at: datetime
    data_uri: str
