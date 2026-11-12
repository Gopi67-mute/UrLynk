"""Guards on the member schemas themselves, with no database involved.

`update_member` writes exactly the fields `MemberUpdate` declares, so that schema *is*
the allow-list for an ordinary profile edit. These tests are the tripwire: if a
structural column were ever added to it, an edit could move a member, change their side
or hand them to another leader, and the build must stop before that ships.
"""

import base64

import pytest
from pydantic import ValidationError

from app.models.member_photo import MAX_PHOTO_BYTES
from app.schemas.member import MAX_PHOTO_BASE64_LENGTH, MemberPhotoUpload, MemberUpdate

# Columns an ordinary profile edit must never be able to write.
PROTECTED_COLUMNS = frozenset(
    {
        "id",
        "team_id",
        "user_profile_id",
        "is_root",
        "placement_parent_id",
        "placement_position",
        "photo_updated_at",
        "created_at",
        "updated_at",
        "clerk_user_id",
    }
)


def test_the_update_schema_declares_no_protected_column() -> None:
    assert PROTECTED_COLUMNS.isdisjoint(MemberUpdate.model_fields)


def test_the_update_schema_refuses_fields_it_does_not_declare() -> None:
    """The other half of the guarantee: anything undeclared is an error, not ignored."""
    assert MemberUpdate.model_config["extra"] == "forbid"

    with pytest.raises(ValidationError):
        MemberUpdate(is_root=True)  # type: ignore[call-arg]


def test_an_update_distinguishes_an_omitted_field_from_an_explicit_null() -> None:
    """The distinction partial updates are built on, checked directly."""
    assert MemberUpdate().changes() == {}
    assert MemberUpdate(notes=None).changes() == {"notes": None}
    assert MemberUpdate(notes="Something").changes() == {"notes": "Something"}


def test_an_update_cannot_clear_a_name() -> None:
    with pytest.raises(ValidationError):
        MemberUpdate(name=None)


def test_an_update_keeps_leading_zeros_in_a_mi_lifestyle_id() -> None:
    # Text throughout: the value is never parsed as a number anywhere.
    identifier = "0009876543"
    assert MemberUpdate(mi_lifestyle_id=identifier).changes() == {"mi_lifestyle_id": identifier}


def test_surrounding_whitespace_is_stripped_before_the_rules_are_applied() -> None:
    assert MemberUpdate(name="  Asha Patel  ").changes() == {"name": "Asha Patel"}

    # So " " cannot pass as a name, nor slip through as blank notes.
    with pytest.raises(ValidationError):
        MemberUpdate(name="   ")
    with pytest.raises(ValidationError):
        MemberUpdate(notes="   ")


def test_a_photo_payload_is_bounded_well_above_the_stored_limit() -> None:
    """Enough headroom that the service can answer "too large" rather than "invalid".

    If the encoded field were capped at exactly the stored limit, an oversized photo
    would be rejected as a malformed request instead of with a message naming the size.
    """
    assert MAX_PHOTO_BASE64_LENGTH > (MAX_PHOTO_BYTES * 4) // 3

    with pytest.raises(ValidationError):
        MemberPhotoUpload(content_type="image/png", data="A" * (MAX_PHOTO_BASE64_LENGTH + 1))


def test_a_photo_must_declare_a_supported_type() -> None:
    encoded = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode("ascii")

    assert MemberPhotoUpload(content_type="image/png", data=encoded).content_type == "image/png"

    with pytest.raises(ValidationError):
        MemberPhotoUpload(content_type="image/svg+xml", data=encoded)  # type: ignore[arg-type]
