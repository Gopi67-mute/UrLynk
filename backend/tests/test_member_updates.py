"""Phase 5.1: editing a member's own details through PATCH /api/v1/members/{id}.

The leader's own record is the root member, so the same endpoint maintains their
preferred name and business profile. What matters most here is what an edit *cannot*
do: move a member, change their side, make them a leader, or reach another team.
"""

import uuid
from datetime import date, timedelta

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"


@pytest.fixture
def team(api_client: TestClient, leader: Leader) -> dict:
    return api_client.post(
        INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers
    ).json()


@pytest.fixture
def root_id(team: dict) -> str:
    return team["root_member"]["id"]


def create(client: TestClient, leader: Leader, parent_id: str, position: str, name: str) -> dict:
    response = client.post(
        MEMBERS,
        json={
            "name": name,
            "placement_parent_id": parent_id,
            "placement_position": position,
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def patch(client: TestClient, leader: Leader, member_id: str, body: dict):
    return client.patch(f"{MEMBERS}/{member_id}", json=body, headers=leader.headers)


def read(client: TestClient, leader: Leader, member_id: str) -> dict:
    response = client.get(f"{MEMBERS}/{member_id}", headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()


def error_code(response) -> str:
    return response.json()["error"]["code"]


# --- the leader's own profile -----------------------------------------------------------


def test_the_leader_can_edit_their_own_root_member(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = patch(
        api_client,
        leader,
        root_id,
        {
            "name": "Asha P.",
            "mi_lifestyle_id": "0012345678",
            "phone_number": "+91 98765 43210",
            "notes": "Prefers calls after 6pm",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Asha P."
    assert body["is_root"] is True
    assert body["mi_lifestyle_id"] == "0012345678"
    assert body["phone_number"] == "+91 98765 43210"
    assert body["notes"] == "Prefers calls after 6pm"


def test_a_preferred_name_persists_and_survives_re_initialization(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A later sign-in must not put the Clerk/Gmail name back over a saved one."""
    patch(api_client, leader, root_id, {"name": "Asha the Leader"})

    again = api_client.post(INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers)

    assert again.status_code == 200
    assert again.json()["root_member"]["name"] == "Asha the Leader"
    assert read(api_client, leader, root_id)["name"] == "Asha the Leader"


def test_the_saved_profile_is_what_a_later_request_reads(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Nothing is kept in memory: a fresh request reads it back from PostgreSQL."""
    patch(api_client, leader, root_id, {"notes": "Weekly training call"})

    assert read(api_client, leader, root_id)["notes"] == "Weekly training call"


# --- partial semantics ------------------------------------------------------------------


def test_omitted_fields_are_left_alone(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    patch(api_client, leader, root_id, {"phone_number": "9876543210", "notes": "Grow steadily"})

    patch(api_client, leader, root_id, {"name": "Asha Renamed"})

    body = read(api_client, leader, root_id)
    assert body["name"] == "Asha Renamed"
    assert body["phone_number"] == "9876543210"
    assert body["notes"] == "Grow steadily"


def test_an_explicit_null_clears_an_optional_field(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    patch(
        api_client,
        leader,
        root_id,
        {"notes": "Temporary note", "mi_lifestyle_id": "0099001122", "phone_number": "9876543210"},
    )

    response = patch(api_client, leader, root_id, {"notes": None, "phone_number": None})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["notes"] is None
    assert body["phone_number"] is None
    # Untouched by the clearing request.
    assert body["mi_lifestyle_id"] == "0099001122"


def test_an_empty_edit_changes_nothing_and_still_reads_back(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    before = read(api_client, leader, root_id)

    response = patch(api_client, leader, root_id, {})

    assert response.status_code == 200
    assert response.json()["name"] == before["name"]


def test_the_name_cannot_be_cleared(api_client: TestClient, leader: Leader, root_id: str) -> None:
    response = patch(api_client, leader, root_id, {"name": None})

    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    assert read(api_client, leader, root_id)["name"] == "Asha Patel"


def test_a_blank_name_is_rejected(api_client: TestClient, leader: Leader, root_id: str) -> None:
    response = patch(api_client, leader, root_id, {"name": "   "})

    assert response.status_code == 422
    assert read(api_client, leader, root_id)["name"] == "Asha Patel"


# --- Mi Lifestyle IDs -------------------------------------------------------------------


def test_leading_zeros_in_a_mi_lifestyle_id_are_preserved(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    patch(api_client, leader, root_id, {"mi_lifestyle_id": "0009876543"})

    assert read(api_client, leader, root_id)["mi_lifestyle_id"] == "0009876543"


def test_a_duplicate_mi_lifestyle_id_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")
    patch(api_client, leader, root_id, {"mi_lifestyle_id": "0012345678"})

    response = patch(api_client, leader, member["id"], {"mi_lifestyle_id": "0012345678"})

    assert response.status_code == 409
    assert error_code(response) == "mi_lifestyle_id_taken"
    # The refused edit left the member with the identifier they already had.
    assert read(api_client, leader, member["id"])["mi_lifestyle_id"] == member["mi_lifestyle_id"]


def test_an_identifier_cannot_be_cleared(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Every member keeps one. An identifier can be corrected but never removed.

    `null` means "clear this field" for every other optional value, which is exactly
    why this one has to say no rather than quietly accept it.
    """
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = patch(api_client, leader, member["id"], {"mi_lifestyle_id": None})

    assert response.status_code == 422
    assert error_code(response) == "mi_lifestyle_id_required"
    assert read(api_client, leader, member["id"])["mi_lifestyle_id"] == member["mi_lifestyle_id"]


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("123456789", id="nine digits"),
        pytest.param("12345678901", id="eleven digits"),
        pytest.param("ML0012A", id="letters"),
        pytest.param("12345A7890", id="ten characters, not all digits"),
        pytest.param("00 123", id="spaces"),
        pytest.param("", id="blank"),
    ],
)
def test_an_identifier_that_is_not_ten_digits_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str, value: str
) -> None:
    assert patch(api_client, leader, root_id, {"mi_lifestyle_id": value}).status_code == 422


def test_a_member_can_keep_its_own_mi_lifestyle_id_on_a_later_edit(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    patch(api_client, leader, root_id, {"mi_lifestyle_id": "0012345678"})

    response = patch(
        api_client, leader, root_id, {"mi_lifestyle_id": "0012345678", "name": "Asha Again"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["mi_lifestyle_id"] == "0012345678"


def test_the_leaders_own_identifier_can_be_set_on_their_profile(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The root starts without one, because sign-up has none to give it.

    That is the only exemption, and it is about when the row is created rather than
    whether a leader needs an identifier: Edit Profile asks for theirs, and this is the
    request that screen sends.
    """
    assert read(api_client, leader, root_id)["mi_lifestyle_id"] is None

    response = patch(api_client, leader, root_id, {"mi_lifestyle_id": "0055667788"})

    assert response.status_code == 200, response.text
    assert read(api_client, leader, root_id)["mi_lifestyle_id"] == "0055667788"


# --- fields an edit must not touch ------------------------------------------------------


@pytest.mark.parametrize(
    "forbidden",
    [
        {"team_id": str(uuid.uuid4())},
        {"id": str(uuid.uuid4())},
        {"is_root": True},
        {"placement_parent_id": str(uuid.uuid4())},
        {"placement_position": "RIGHT"},
        {"user_profile_id": str(uuid.uuid4())},
        {"clerk_user_id": "user_someone_else"},
        {"photo_updated_at": "2026-01-01T00:00:00Z"},
        {"created_at": "2026-01-01T00:00:00Z"},
        {"has_left_child": True},
        {"unknown_field": "anything"},
    ],
)
def test_structural_and_unknown_fields_are_refused(
    api_client: TestClient, leader: Leader, root_id: str, forbidden: dict
) -> None:
    response = patch(api_client, leader, root_id, forbidden)

    assert response.status_code == 422, response.text
    assert error_code(response) == "validation_error"


def test_a_refused_field_changes_nothing_at_all(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A forbidden field alongside a valid one rejects the whole request."""
    response = patch(api_client, leader, root_id, {"name": "Should Not Be Saved", "is_root": False})

    assert response.status_code == 422
    body = read(api_client, leader, root_id)
    assert body["name"] == "Asha Patel"
    assert body["is_root"] is True


def test_placement_is_untouched_by_an_ordinary_edit(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    patch(api_client, leader, member["id"], {"name": "Palanivel K.", "notes": "Edited"})

    body = read(api_client, leader, member["id"])
    assert body["placement_position"] == "LEFT"
    assert body["placement_parent"]["id"] == root_id
    assert body["is_root"] is False


# --- sponsors ---------------------------------------------------------------------------


def test_a_sponsor_can_be_recorded_and_cleared(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    assigned = patch(api_client, leader, member["id"], {"sponsor_id": root_id})
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["sponsor"]["id"] == root_id

    cleared = patch(api_client, leader, member["id"], {"sponsor_id": None})
    assert cleared.status_code == 200
    assert cleared.json()["sponsor"] is None


def test_a_sponsor_change_does_not_move_the_member(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Sponsorship and placement are independent relationships."""
    left = create(api_client, leader, root_id, "LEFT", "Left Member")
    deeper = create(api_client, leader, left["id"], "RIGHT", "Deeper Member")

    patch(api_client, leader, deeper["id"], {"sponsor_id": root_id})

    body = read(api_client, leader, deeper["id"])
    assert body["sponsor"]["id"] == root_id
    assert body["placement_parent"]["id"] == left["id"]
    assert body["placement_position"] == "RIGHT"


def test_a_member_cannot_sponsor_themselves(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = patch(api_client, leader, member["id"], {"sponsor_id": member["id"]})

    assert response.status_code == 422
    assert error_code(response) == "sponsor_invalid"


def test_an_unknown_sponsor_is_not_found(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = patch(api_client, leader, root_id, {"sponsor_id": str(uuid.uuid4())})

    assert response.status_code == 404
    assert error_code(response) == "sponsor_not_found"


# --- validation -------------------------------------------------------------------------


def test_a_future_joining_date_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    far_ahead = (date.today() + timedelta(days=30)).isoformat()

    response = patch(api_client, leader, root_id, {"joining_date": far_ahead})

    assert response.status_code == 422


def test_a_joining_date_can_be_recorded_and_cleared(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    joined = (date.today() - timedelta(days=400)).isoformat()

    recorded = patch(api_client, leader, root_id, {"joining_date": joined})
    assert recorded.json()["joining_date"] == joined

    cleared = patch(api_client, leader, root_id, {"joining_date": None})
    assert cleared.json()["joining_date"] is None


def test_an_unusable_phone_number_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = patch(api_client, leader, root_id, {"phone_number": "not a number"})

    assert response.status_code == 422


def test_free_text_longer_than_the_limit_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = patch(api_client, leader, root_id, {"notes": "x" * 501})

    assert response.status_code == 422


def test_free_text_keeps_its_line_breaks(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = patch(api_client, leader, root_id, {"notes": "First note\nSecond note"})

    assert response.status_code == 200, response.text
    assert read(api_client, leader, root_id)["notes"] == "First note\nSecond note"


def test_control_characters_in_free_text_are_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = patch(api_client, leader, root_id, {"notes": "bad\x07value"})

    assert response.status_code == 422


# --- fields that no longer exist ---------------------------------------------------------


@pytest.mark.parametrize(
    "field",
    [
        "educational_qualifications",
        "professional_qualifications",
        "priorities",
        "goals",
    ],
)
def test_a_removed_profile_field_is_refused_rather_than_ignored(
    api_client: TestClient, leader: Leader, root_id: str, field: str
) -> None:
    """`extra="forbid"` means these are rejected, not quietly dropped.

    A client still sending one is told so, rather than believing it saved something.
    """
    response = patch(api_client, leader, root_id, {field: "anything"})

    assert response.status_code == 422


def test_a_member_record_no_longer_carries_the_removed_fields(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    body = read(api_client, leader, root_id)

    for field in (
        "educational_qualifications",
        "professional_qualifications",
        "priorities",
        "goals",
    ):
        assert field not in body

    # The profile fields that stayed are still served.
    for field in ("name", "mi_lifestyle_id", "phone_number", "joining_date", "notes"):
        assert field in body


# --- team isolation ---------------------------------------------------------------------


def test_a_leader_cannot_edit_another_leaders_member(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)
    victim = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = patch(api_client, other_leader, victim["id"], {"name": "Taken Over"})

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"
    assert read(api_client, leader, victim["id"])["name"] == "Palanivel"


def test_a_leader_cannot_edit_another_leaders_root_member(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)

    response = patch(api_client, other_leader, root_id, {"name": "Not Yours"})

    assert response.status_code == 404
    assert read(api_client, leader, root_id)["name"] == "Asha Patel"


def test_a_sponsor_from_another_team_is_rejected(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    other_team = api_client.post(INITIALIZE, json={}, headers=other_leader.headers).json()
    other_root_id = other_team["root_member"]["id"]
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = patch(api_client, leader, member["id"], {"sponsor_id": other_root_id})

    assert response.status_code == 404
    assert error_code(response) == "sponsor_not_found"
    assert read(api_client, leader, member["id"])["sponsor"] is None


def test_editing_requires_a_token(api_client: TestClient, root_id: str) -> None:
    response = api_client.patch(f"{MEMBERS}/{root_id}", json={"name": "Anonymous Edit"})

    assert response.status_code == 401
    assert error_code(response) == "not_authenticated"


def test_an_unknown_member_is_not_found(api_client: TestClient, leader: Leader, team: dict) -> None:
    response = patch(api_client, leader, str(uuid.uuid4()), {"name": "Nobody"})

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"
