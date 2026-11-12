"""Phase 5.1: GET /api/v1/members/recent, behind the dashboard's Recently Added section.

This is a bounded query over the members table, not an event history: every entry is a
member that exists, ordered by when it was registered.
"""

import uuid

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"
RECENT = "/api/v1/members/recent"
MAX_RECENT_LIMIT = 20


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


def recent(client: TestClient, leader: Leader, **params: object):
    return client.get(RECENT, params=params, headers=leader.headers)


def chain(client: TestClient, leader: Leader, root_id: str, count: int) -> list[dict]:
    """`count` members down the left leg, oldest first, so the order is unambiguous."""
    created, parent = [], root_id
    for index in range(count):
        member = create(client, leader, parent, "LEFT", f"Member {index + 1}")
        created.append(member)
        parent = member["id"]
    return created


# --- ordering and content ---------------------------------------------------------------


def test_the_newest_member_comes_first(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    created = chain(api_client, leader, root_id, 4)

    response = recent(api_client, leader)

    assert response.status_code == 200, response.text
    names = [member["name"] for member in response.json()]
    assert names == [member["name"] for member in reversed(created)]


def test_each_entry_says_where_the_member_landed(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "RIGHT", "Palanivel")

    [entry] = recent(api_client, leader).json()

    assert entry["name"] == "Palanivel"
    assert entry["placement_position"] == "RIGHT"
    assert entry["placement_parent_name"] == "Asha Patel"
    assert entry["created_at"] is not None
    assert entry["is_root"] is False


def test_the_parent_name_follows_a_rename(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The section reads from the members table, so it is never a stale snapshot."""
    create(api_client, leader, root_id, "LEFT", "Palanivel")
    api_client.patch(f"{MEMBERS}/{root_id}", json={"name": "Asha P."}, headers=leader.headers)

    [entry] = recent(api_client, leader).json()

    assert entry["placement_parent_name"] == "Asha P."


# --- the leader's own record ------------------------------------------------------------


def test_a_team_with_no_members_yet_is_empty(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    """The leader's root member was created with the team, not registered by anyone."""
    response = recent(api_client, leader)

    assert response.status_code == 200
    assert response.json() == []


def test_the_leader_never_appears_as_a_recent_addition(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    chain(api_client, leader, root_id, 2)

    entries = recent(api_client, leader).json()

    assert all(entry["is_root"] is False for entry in entries)
    assert root_id not in {entry["id"] for entry in entries}


# --- bounds -----------------------------------------------------------------------------


def test_the_default_result_is_small(api_client: TestClient, leader: Leader, root_id: str) -> None:
    chain(api_client, leader, root_id, 9)

    assert len(recent(api_client, leader).json()) == 5


def test_a_smaller_limit_is_honoured(api_client: TestClient, leader: Leader, root_id: str) -> None:
    created = chain(api_client, leader, root_id, 5)

    entries = recent(api_client, leader, limit=2).json()

    assert [entry["name"] for entry in entries] == [created[-1]["name"], created[-2]["name"]]


def test_the_server_decides_the_maximum(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = recent(api_client, leader, limit=MAX_RECENT_LIMIT + 1)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_limit_at_the_maximum_is_accepted(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = recent(api_client, leader, limit=MAX_RECENT_LIMIT)

    assert response.status_code == 200


@pytest.mark.parametrize("limit", [0, -1, "many"])
def test_an_unusable_limit_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str, limit: object
) -> None:
    assert recent(api_client, leader, limit=limit).status_code == 422


# --- team isolation ---------------------------------------------------------------------


def test_another_leaders_members_never_appear(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    other_root = api_client.post(INITIALIZE, json={}, headers=other_leader.headers).json()[
        "root_member"
    ]["id"]
    create(api_client, leader, root_id, "LEFT", "Mine")
    create(api_client, other_leader, other_root, "LEFT", "Theirs")

    assert [entry["name"] for entry in recent(api_client, leader).json()] == ["Mine"]
    assert [entry["name"] for entry in recent(api_client, other_leader).json()] == ["Theirs"]


def test_a_leader_with_no_team_yet_is_told_to_initialize(
    api_client: TestClient, leader: Leader
) -> None:
    response = recent(api_client, leader)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "team_not_initialized"


def test_recent_members_require_a_token(api_client: TestClient, team: dict) -> None:
    response = api_client.get(RECENT)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_recent_is_not_mistaken_for_a_member_id(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The literal path must win over the /{member_id} route, not be parsed as a UUID."""
    assert recent(api_client, leader).status_code == 200
    assert api_client.get(f"{MEMBERS}/{uuid.uuid4()}", headers=leader.headers).status_code == 404
