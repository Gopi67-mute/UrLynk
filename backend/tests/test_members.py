"""Phase 5: member registration and LEFT/RIGHT placement through the API."""

import uuid
from datetime import date, timedelta

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import create_app

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MY_TEAM = "/api/v1/teams/me"
MEMBERS = "/api/v1/members"


@pytest.fixture
def team(api_client: TestClient, leader: Leader) -> dict:
    """An initialized team for `leader`, as the overview response describes it."""
    return api_client.post(
        INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers
    ).json()


@pytest.fixture
def root_id(team: dict) -> str:
    return team["root_member"]["id"]


def add_member(client: TestClient, leader: Leader, **fields: object):
    """POST exactly the fields given — nothing is filled in, so absences can be tested."""
    return client.post(MEMBERS, json=fields, headers=leader.headers)


def create(client: TestClient, leader: Leader, parent_id: str, position: str, name: str) -> dict:
    """Register a valid member. A unique Mi Lifestyle ID is supplied, as one is required."""
    response = add_member(
        client,
        leader,
        name=name,
        placement_parent_id=parent_id,
        placement_position=position,
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )
    assert response.status_code == 201, response.text
    return response.json()


def error_code(response) -> str:
    return response.json()["error"]["code"]


# --- valid placement --------------------------------------------------------------------


@pytest.mark.parametrize("position", ["LEFT", "RIGHT"])
def test_a_member_can_be_placed_on_either_side(
    api_client: TestClient, leader: Leader, root_id: str, position: str
) -> None:
    response = add_member(
        api_client,
        leader,
        name="Palanivel",
        placement_parent_id=root_id,
        placement_position=position,
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Palanivel"
    assert body["placement_position"] == position
    assert body["is_root"] is False
    assert body["placement_parent"]["id"] == root_id
    assert body["has_left_child"] is False
    assert body["has_right_child"] is False


def test_both_sides_can_be_filled_under_one_parent(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    left = create(api_client, leader, root_id, "LEFT", "Left Member")
    right = create(api_client, leader, root_id, "RIGHT", "Right Member")

    children = api_client.get(f"{MEMBERS}/{root_id}/children", headers=leader.headers).json()
    assert children["left"]["id"] == left["id"]
    assert children["right"]["id"] == right["id"]
    assert children["parent_id"] == root_id


def test_optional_details_are_stored(api_client: TestClient, leader: Leader, root_id: str) -> None:
    joined = date.today() - timedelta(days=30)
    response = add_member(
        api_client,
        leader,
        name="Meera Nair",
        placement_parent_id=root_id,
        placement_position="LEFT",
        mi_lifestyle_id="0012345678",
        phone_number="+91 98765 43210",
        joining_date=joined.isoformat(),
        notes="Joined at the regional meeting.",
    )

    assert response.status_code == 201
    body = response.json()
    # Leading zeros are part of the identifier, not formatting.
    assert body["mi_lifestyle_id"] == "0012345678"
    assert body["phone_number"] == "+91 98765 43210"
    assert body["joining_date"] == joined.isoformat()
    assert body["notes"] == "Joined at the regional meeting."


def test_a_member_can_be_placed_several_levels_down(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    child = create(api_client, leader, root_id, "LEFT", "Child")
    grandchild = create(api_client, leader, child["id"], "RIGHT", "Grandchild")

    response = add_member(
        api_client,
        leader,
        name="Great grandchild",
        placement_parent_id=grandchild["id"],
        placement_position="LEFT",
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )
    assert response.status_code == 201


def test_a_sponsor_is_recorded_independently_of_placement(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    sponsor = create(api_client, leader, root_id, "LEFT", "Sponsor")

    body = add_member(
        api_client,
        leader,
        name="Sponsored",
        placement_parent_id=root_id,
        placement_position="RIGHT",
        sponsor_id=sponsor["id"],
        mi_lifestyle_id=next_mi_lifestyle_id(),
    ).json()

    # Sponsored by the LEFT member, but placed on the RIGHT under the root.
    assert body["sponsor"]["id"] == sponsor["id"]
    assert body["placement_parent"]["id"] == root_id
    assert body["placement_position"] == "RIGHT"


# --- rejected placement -----------------------------------------------------------------


def test_an_occupied_position_is_rejected_and_the_member_there_is_untouched(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    first = create(api_client, leader, root_id, "LEFT", "First")

    response = add_member(
        api_client,
        leader,
        name="Second",
        placement_parent_id=root_id,
        placement_position="LEFT",
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )

    assert response.status_code == 409
    assert error_code(response) == "placement_occupied"

    children = api_client.get(f"{MEMBERS}/{root_id}/children", headers=leader.headers).json()
    assert children["left"]["id"] == first["id"]
    assert children["left"]["name"] == "First"


def test_an_unknown_parent_is_rejected(api_client: TestClient, leader: Leader, team: dict) -> None:
    response = add_member(
        api_client,
        leader,
        name="Nowhere",
        placement_parent_id=str(uuid.uuid4()),
        placement_position="LEFT",
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )

    assert response.status_code == 404
    assert error_code(response) == "parent_not_found"


def test_a_sponsor_outside_the_team_is_rejected(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    other = api_client.post(
        INITIALIZE, json={"display_name": "Bala"}, headers=other_leader.headers
    ).json()

    response = add_member(
        api_client,
        leader,
        name="Sponsored elsewhere",
        placement_parent_id=root_id,
        placement_position="LEFT",
        sponsor_id=other["root_member"]["id"],
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )

    assert response.status_code == 404
    assert error_code(response) == "sponsor_not_found"


def test_a_member_cannot_be_added_to_a_broken_branch(
    api_client: TestClient, leader: Leader, root_id: str, session_factory
) -> None:
    """A cycle in the stored data stops new members being hung off it.

    The cycle is written with raw SQL, because the API cannot create one: the
    placement chain is walked before every insert.
    """
    first = create(api_client, leader, root_id, "LEFT", "First")
    second = create(api_client, leader, first["id"], "LEFT", "Second")

    with session_factory() as session:
        session.execute(
            text("UPDATE members SET placement_parent_id = :second WHERE id = :first"),
            {"second": second["id"], "first": first["id"]},
        )
        session.commit()

    for parent_id in (first["id"], second["id"]):
        response = add_member(
            api_client,
            leader,
            name="On a cycle",
            placement_parent_id=parent_id,
            placement_position="RIGHT",
            mi_lifestyle_id=next_mi_lifestyle_id(),
        )
        assert response.status_code == 409
        assert error_code(response) == "placement_chain_invalid"


def test_a_duplicate_mi_lifestyle_id_in_the_same_team_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    add_member(
        api_client,
        leader,
        name="First",
        placement_parent_id=root_id,
        placement_position="LEFT",
        mi_lifestyle_id="0012345678",
    )

    response = add_member(
        api_client,
        leader,
        name="Second",
        placement_parent_id=root_id,
        placement_position="RIGHT",
        mi_lifestyle_id="0012345678",
    )

    assert response.status_code == 409
    assert error_code(response) == "mi_lifestyle_id_taken"


def test_members_cannot_be_added_before_the_team_exists(
    api_client: TestClient, leader: Leader
) -> None:
    response = add_member(
        api_client,
        leader,
        name="Too early",
        placement_parent_id=str(uuid.uuid4()),
        placement_position="LEFT",
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )

    assert response.status_code == 404
    assert error_code(response) == "team_not_initialized"


# --- input validation --------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"name": ""}, id="blank name"),
        pytest.param({"name": "   "}, id="whitespace name"),
        pytest.param({"name": "A" * 121}, id="name too long"),
        pytest.param({"name": "Line\nBreak"}, id="control character in name"),
        pytest.param({"placement_position": "MIDDLE"}, id="unknown position"),
        pytest.param({"placement_position": "left"}, id="lowercase position"),
        pytest.param({"placement_parent_id": "not-a-uuid"}, id="malformed parent"),
        pytest.param({"mi_lifestyle_id": "has space"}, id="id with a space"),
        pytest.param({"mi_lifestyle_id": "12345678901"}, id="eleven digits"),
        pytest.param({"mi_lifestyle_id": "123456789"}, id="nine digits"),
        pytest.param({"mi_lifestyle_id": "12345A7890"}, id="ten characters, not all digits"),
        pytest.param({"mi_lifestyle_id": ""}, id="blank id"),
        pytest.param({"phone_number": "12345"}, id="phone too short"),
        pytest.param({"phone_number": "call me"}, id="phone with letters"),
        pytest.param({"notes": "A" * 501}, id="notes too long"),
        pytest.param({"joining_date": "1999-12-31"}, id="joining date too old"),
        pytest.param({"joining_date": "not-a-date"}, id="malformed joining date"),
        pytest.param({"sponsor_id": "not-a-uuid"}, id="malformed sponsor"),
    ],
)
def test_invalid_details_are_rejected(
    api_client: TestClient, leader: Leader, root_id: str, fields: dict
) -> None:
    payload = {"name": "Valid Name", "placement_parent_id": root_id, "placement_position": "LEFT"}
    payload.update(fields)

    response = api_client.post(MEMBERS, json=payload, headers=leader.headers)

    assert response.status_code == 422
    assert error_code(response) == "validation_error"


def test_a_joining_date_in_the_future_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = add_member(
        api_client,
        leader,
        name="Tomorrow",
        placement_parent_id=root_id,
        placement_position="LEFT",
        joining_date=(date.today() + timedelta(days=3)).isoformat(),
    )
    assert response.status_code == 422


def test_todays_joining_date_is_accepted(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = add_member(
        api_client,
        leader,
        name="Today",
        placement_parent_id=root_id,
        placement_position="LEFT",
        joining_date=date.today().isoformat(),
        mi_lifestyle_id=next_mi_lifestyle_id(),
    )
    assert response.status_code == 201


@pytest.mark.parametrize(
    "extra",
    [
        pytest.param({"team_id": "11111111-1111-1111-1111-111111111111"}, id="team_id"),
        pytest.param({"is_root": True}, id="is_root"),
        pytest.param({"id": "11111111-1111-1111-1111-111111111111"}, id="id"),
        pytest.param({"created_at": "2020-01-01T00:00:00Z"}, id="created_at"),
    ],
)
def test_fields_the_client_must_not_choose_are_rejected(
    api_client: TestClient, leader: Leader, root_id: str, extra: dict
) -> None:
    payload = {"name": "Valid", "placement_parent_id": root_id, "placement_position": "LEFT"}
    payload.update(extra)

    response = api_client.post(MEMBERS, json=payload, headers=leader.headers)

    assert response.status_code == 422


def test_placement_details_are_required(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = api_client.post(MEMBERS, json={"name": "No placement"}, headers=leader.headers)
    assert response.status_code == 422


# --- reading members ---------------------------------------------------------------------


def test_a_member_detail_shows_its_parent_and_children(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    parent = create(api_client, leader, root_id, "LEFT", "Parent")
    create(api_client, leader, parent["id"], "RIGHT", "Child")

    body = api_client.get(f"{MEMBERS}/{parent['id']}", headers=leader.headers).json()

    assert body["placement_parent"]["id"] == root_id
    assert body["placement_position"] == "LEFT"
    assert body["has_left_child"] is False
    assert body["has_right_child"] is True
    assert body["sponsor"] is None


def test_an_unknown_member_is_not_found(api_client: TestClient, leader: Leader, team: dict) -> None:
    response = api_client.get(f"{MEMBERS}/{uuid.uuid4()}", headers=leader.headers)
    assert response.status_code == 404
    assert error_code(response) == "member_not_found"


def test_free_slots_read_as_null(api_client: TestClient, leader: Leader, root_id: str) -> None:
    body = api_client.get(f"{MEMBERS}/{root_id}/children", headers=leader.headers).json()
    assert body["left"] is None
    assert body["right"] is None


def test_children_of_an_unknown_member_are_not_found(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    response = api_client.get(f"{MEMBERS}/{uuid.uuid4()}/children", headers=leader.headers)
    assert response.status_code == 404


def test_reading_members_requires_a_token(api_client: TestClient, root_id: str) -> None:
    assert api_client.get(MEMBERS).status_code == 401
    assert api_client.get(f"{MEMBERS}/{root_id}").status_code == 401
    assert api_client.get(f"{MEMBERS}/{root_id}/children").status_code == 401
    assert api_client.post(MEMBERS, json={"name": "x"}).status_code == 401


# --- the directory listing ---------------------------------------------------------------


def test_the_listing_starts_with_the_leader_and_flags_filled_slots(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Left Member")

    body = api_client.get(MEMBERS, headers=leader.headers).json()
    items = body["items"]

    assert [item["name"] for item in items] == ["Asha Patel", "Left Member"]
    assert items[0]["has_left_child"] is True
    assert items[0]["has_right_child"] is False
    assert items[1]["has_left_child"] is False
    assert body["next_cursor"] is None


def test_the_listing_is_paginated(api_client: TestClient, leader: Leader, root_id: str) -> None:
    left = create(api_client, leader, root_id, "LEFT", "Left Member")
    create(api_client, leader, root_id, "RIGHT", "Right Member")
    create(api_client, leader, left["id"], "LEFT", "Deep Member")

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(4):
        params: dict[str, object] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = api_client.get(MEMBERS, params=params, headers=leader.headers).json()
        seen.extend(item["name"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert cursor is None
    assert seen == ["Asha Patel", "Left Member", "Right Member", "Deep Member"]
    assert len(seen) == len(set(seen))  # no page repeated a member


def test_a_malformed_cursor_is_rejected(api_client: TestClient, leader: Leader, team: dict) -> None:
    response = api_client.get(MEMBERS, params={"cursor": "not-a-cursor"}, headers=leader.headers)
    assert response.status_code == 400
    assert error_code(response) == "invalid_cursor"


@pytest.mark.parametrize("limit", [0, -1, 101, 10_000])
def test_the_page_size_is_bounded(
    api_client: TestClient, leader: Leader, team: dict, limit: int
) -> None:
    response = api_client.get(MEMBERS, params={"limit": limit}, headers=leader.headers)
    assert response.status_code == 422


# --- counts -------------------------------------------------------------------------------


def test_the_team_counts_follow_the_structure(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    left = create(api_client, leader, root_id, "LEFT", "Left")
    create(api_client, leader, root_id, "RIGHT", "Right")
    deep = create(api_client, leader, left["id"], "LEFT", "Deep")
    create(api_client, leader, deep["id"], "RIGHT", "Deeper")

    counts = api_client.get(MY_TEAM, headers=leader.headers).json()["counts"]

    # Three on the left at any depth, one on the right, plus the leader.
    assert counts == {"total_members": 5, "left_members": 3, "right_members": 1}


# --- persistence --------------------------------------------------------------------------


def test_members_survive_an_application_restart(
    api_client: TestClient, leader: Leader, root_id: str, db_settings, verifier
) -> None:
    member = create(api_client, leader, root_id, "RIGHT", "Durable Member")

    # A new application instance: new engine, new connection pool, same PostgreSQL.
    with TestClient(create_app(db_settings, token_verifier=verifier)) as restarted:
        detail = restarted.get(f"{MEMBERS}/{member['id']}", headers=leader.headers).json()
        counts = restarted.get(MY_TEAM, headers=leader.headers).json()["counts"]

    assert detail["name"] == "Durable Member"
    assert detail["placement_position"] == "RIGHT"
    assert detail["placement_parent"]["id"] == root_id
    assert counts["right_members"] == 1
