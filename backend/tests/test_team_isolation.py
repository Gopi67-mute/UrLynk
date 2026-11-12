"""Phase 5 security: one leader can never reach another leader's team.

Leader A and leader B hold valid tokens for the same instance. Everything A tries
against B's records has to fail, and fail without revealing that they exist.
"""

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MY_TEAM = "/api/v1/teams/me"
MEMBERS = "/api/v1/members"


def _set_up(client: TestClient, leader: Leader, display_name: str) -> dict:
    team = client.post(
        INITIALIZE, json={"display_name": display_name}, headers=leader.headers
    ).json()
    member = client.post(
        MEMBERS,
        json={
            "name": f"{display_name} member",
            "placement_parent_id": team["root_member"]["id"],
            "placement_position": "LEFT",
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    ).json()
    return {"team": team, "member": member}


@pytest.fixture
def two_teams(api_client: TestClient, leader: Leader, other_leader: Leader) -> dict:
    return {
        "a": _set_up(api_client, leader, "Asha"),
        "b": _set_up(api_client, other_leader, "Bala"),
    }


def test_each_leader_reads_only_their_own_team(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_teams: dict
) -> None:
    a = api_client.get(MY_TEAM, headers=leader.headers).json()
    b = api_client.get(MY_TEAM, headers=other_leader.headers).json()

    assert a["team"]["id"] == two_teams["a"]["team"]["team"]["id"]
    assert b["team"]["id"] == two_teams["b"]["team"]["team"]["id"]
    assert a["team"]["id"] != b["team"]["id"]
    assert a["root_member"]["name"] == "Asha"
    assert b["root_member"]["name"] == "Bala"


def test_a_leader_cannot_read_another_leaders_members(
    api_client: TestClient, leader: Leader, two_teams: dict
) -> None:
    """A member ID is not a permission: knowing one buys nothing outside your team."""
    for member_id in (
        two_teams["b"]["team"]["root_member"]["id"],
        two_teams["b"]["member"]["id"],
    ):
        detail = api_client.get(f"{MEMBERS}/{member_id}", headers=leader.headers)
        children = api_client.get(f"{MEMBERS}/{member_id}/children", headers=leader.headers)

        assert detail.status_code == 404
        assert detail.json()["error"]["code"] == "member_not_found"
        assert children.status_code == 404
        # The response says nothing about the member existing elsewhere.
        assert "Bala" not in detail.text


def test_a_leader_cannot_add_members_to_another_leaders_team(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_teams: dict
) -> None:
    response = api_client.post(
        MEMBERS,
        json={
            "name": "Intruder",
            "placement_parent_id": two_teams["b"]["team"]["root_member"]["id"],
            "placement_position": "RIGHT",
            # Valid, so the request fails on the team boundary and not on its content.
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "parent_not_found"

    # Nothing was written into either team.
    b_counts = api_client.get(MY_TEAM, headers=other_leader.headers).json()["counts"]
    a_counts = api_client.get(MY_TEAM, headers=leader.headers).json()["counts"]
    assert b_counts["total_members"] == 2
    assert a_counts["total_members"] == 2


def test_a_leader_cannot_sponsor_with_another_leaders_member(
    api_client: TestClient, leader: Leader, two_teams: dict
) -> None:
    response = api_client.post(
        MEMBERS,
        json={
            "name": "Cross sponsored",
            "placement_parent_id": two_teams["a"]["team"]["root_member"]["id"],
            "placement_position": "RIGHT",
            "sponsor_id": two_teams["b"]["member"]["id"],
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "sponsor_not_found"


def test_the_listing_never_includes_another_leaders_members(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_teams: dict
) -> None:
    a_items = api_client.get(MEMBERS, headers=leader.headers).json()["items"]
    b_items = api_client.get(MEMBERS, headers=other_leader.headers).json()["items"]

    assert sorted(item["name"] for item in a_items) == ["Asha", "Asha member"]
    assert sorted(item["name"] for item in b_items) == ["Bala", "Bala member"]
    assert not {item["id"] for item in a_items} & {item["id"] for item in b_items}


def test_another_leaders_cursor_reveals_nothing(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_teams: dict
) -> None:
    """A cursor is a sort position, not a key: it still only pages the caller's team."""
    b_page = api_client.get(MEMBERS, params={"limit": 1}, headers=other_leader.headers).json()
    assert b_page["next_cursor"]

    a_page = api_client.get(
        MEMBERS, params={"cursor": b_page["next_cursor"]}, headers=leader.headers
    ).json()

    assert all(item["name"].startswith("Asha") for item in a_page["items"])


def test_the_same_mi_lifestyle_id_can_exist_in_both_teams(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_teams: dict
) -> None:
    """Teams are independent, so one leader's IDs cannot block another's."""
    shared_id = "0099001234"
    for current, team in ((leader, two_teams["a"]), (other_leader, two_teams["b"])):
        response = api_client.post(
            MEMBERS,
            json={
                "name": "Same ID",
                "placement_parent_id": team["team"]["root_member"]["id"],
                "placement_position": "RIGHT",
                "mi_lifestyle_id": shared_id,
            },
            headers=current.headers,
        )
        assert response.status_code == 201, response.text


def test_both_leaders_can_use_the_same_position_under_their_own_roots(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_teams: dict
) -> None:
    for current, team in ((leader, two_teams["a"]), (other_leader, two_teams["b"])):
        response = api_client.post(
            MEMBERS,
            json={
                "name": "Right side",
                "placement_parent_id": team["team"]["root_member"]["id"],
                "placement_position": "RIGHT",
                "mi_lifestyle_id": next_mi_lifestyle_id(),
            },
            headers=current.headers,
        )
        assert response.status_code == 201


def test_switching_account_switches_team(
    api_client: TestClient, token_factory, two_teams: dict
) -> None:
    """A different verified subject is a different team, even on one device."""
    third = {"Authorization": f"Bearer {token_factory(sub='user_leader_c')}"}

    response = api_client.get(MY_TEAM, headers=third)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "team_not_initialized"


def test_an_expired_token_reaches_no_team(
    api_client: TestClient, token_factory, two_teams: dict
) -> None:
    import time

    now = int(time.time())
    expired = token_factory(sub="user_leader_a", exp=now - 60, iat=now - 120, nbf=now - 120)

    response = api_client.get(MY_TEAM, headers={"Authorization": f"Bearer {expired}"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_expired"
