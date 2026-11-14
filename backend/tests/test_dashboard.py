"""Phase 6: the numbers and the records the Home dashboard and the Team screen show.

Everything here goes through `GET /api/v1/teams/me` and `GET /api/v1/members/{id}/children`
— the two requests those screens make — because that is what the app actually reads. The
counts themselves are computed by one recursive query in PostgreSQL, so these tests build
real trees and check the API's answer against the structure that was built.

What is worth testing hardest:

- the counts are the whole branch at every depth, not the direct children and not the
  order members were registered in;
- they follow every structural change — a registration, a deletion, a reorganizing
  deletion — with no restart and no cached arithmetic;
- the root member the dashboard names and photographs is the saved UrLynk record, which
  `teams.team_name` is not;
- one leader's structure never moves another leader's numbers.
"""

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"
TEAM = "/api/v1/teams/me"


@pytest.fixture
def team(api_client: TestClient, leader: Leader) -> dict:
    return api_client.post(
        INITIALIZE, json={"display_name": "Gopinath J"}, headers=leader.headers
    ).json()


@pytest.fixture
def root_id(team: dict) -> str:
    return team["root_member"]["id"]


# --- helpers -----------------------------------------------------------------------------


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


def counts(client: TestClient, leader: Leader) -> dict:
    response = client.get(TEAM, headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()["counts"]


def children(client: TestClient, leader: Leader, member_id: str) -> dict:
    response = client.get(f"{MEMBERS}/{member_id}/children", headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()


def leg(client: TestClient, leader: Leader, parent_id: str, position: str, depth: int) -> str:
    """A single file of `depth` members, each below the last. Returns the deepest id."""
    for index in range(depth):
        parent_id = create(
            client, leader, parent_id, position, f"{position.title()} leg {index + 1}"
        )["id"]
    return parent_id


def reorganize(client: TestClient, leader: Leader, member_id: str, promote: str) -> dict:
    """Preview and confirm a reorganizing deletion, exactly as the app does."""
    previewed = client.get(
        f"{MEMBERS}/{member_id}/deletion-plan", params={"promote": promote}, headers=leader.headers
    )
    assert previewed.status_code == 200, previewed.text
    response = client.post(
        f"{MEMBERS}/{member_id}/deletion",
        json={"plan_token": previewed.json()["plan_token"], "promote_member_id": promote},
        headers=leader.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- a team with nobody in it yet --------------------------------------------------------


def test_a_new_team_counts_only_its_leader(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    assert team["counts"] == {"total_members": 1, "left_members": 0, "right_members": 0}
    # And reading it again agrees: the counts are queried, not remembered from setup.
    assert counts(api_client, leader) == {
        "total_members": 1,
        "left_members": 0,
        "right_members": 0,
    }


def test_both_positions_under_a_new_root_are_free(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    slots = children(api_client, leader, root_id)

    assert slots["parent_id"] == root_id
    assert slots["left"] is None
    assert slots["right"] is None


# --- the counts the dashboard shows ------------------------------------------------------


def test_each_side_counts_its_whole_branch_at_every_depth(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    # The shape of a real team: a left branch of 7 and a right branch of 6, built so that
    # neither side could be produced by counting direct children or registrations.
    ajay = create(api_client, leader, root_id, "LEFT", "Ajay")["id"]
    arun = create(api_client, leader, ajay, "LEFT", "Arun")["id"]
    anil = create(api_client, leader, ajay, "RIGHT", "Anil")["id"]
    create(api_client, leader, arun, "LEFT", "Master")
    create(api_client, leader, arun, "RIGHT", "Kaithi")
    create(api_client, leader, anil, "LEFT", "Vijay")
    create(api_client, leader, anil, "RIGHT", "Vendhan")

    amir = create(api_client, leader, root_id, "RIGHT", "Amir")["id"]
    leo = create(api_client, leader, amir, "RIGHT", "Leo")["id"]
    leokesh = create(api_client, leader, amir, "LEFT", "Leokesh")["id"]
    create(api_client, leader, leokesh, "LEFT", "Nelson")
    create(api_client, leader, leo, "LEFT", "Atlee")
    create(api_client, leader, leo, "RIGHT", "Vetrimaran")

    assert counts(api_client, leader) == {
        "total_members": 14,
        "left_members": 7,
        "right_members": 6,
    }


def test_a_deep_leg_is_counted_in_full_rather_than_as_one_child(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    leg(api_client, leader, root_id, "LEFT", 6)

    # Six members in a single file: counting direct children would say 1.
    assert counts(api_client, leader) == {
        "total_members": 7,
        "left_members": 6,
        "right_members": 0,
    }


def test_the_total_is_always_both_sides_plus_the_leader(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    leg(api_client, leader, root_id, "LEFT", 3)
    leg(api_client, leader, root_id, "RIGHT", 5)

    numbers = counts(api_client, leader)

    assert numbers["total_members"] == numbers["left_members"] + numbers["right_members"] + 1


def test_the_two_sides_are_never_confused_with_each_other(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    leg(api_client, leader, root_id, "LEFT", 2)
    leg(api_client, leader, root_id, "RIGHT", 4)

    assert counts(api_client, leader)["left_members"] == 2
    assert counts(api_client, leader)["right_members"] == 4


def test_a_members_own_side_does_not_decide_which_branch_counts_them(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A member placed RIGHT below a LEFT member still belongs to the LEFT branch."""
    left_child = create(api_client, leader, root_id, "LEFT", "Left child")["id"]
    create(api_client, leader, left_child, "RIGHT", "Right of the left child")

    assert counts(api_client, leader) == {
        "total_members": 3,
        "left_members": 2,
        "right_members": 0,
    }


# --- the branch cards --------------------------------------------------------------------


def test_the_root_reports_the_two_members_the_branch_cards_name(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    left = create(api_client, leader, root_id, "LEFT", "Ajay")
    right = create(api_client, leader, root_id, "RIGHT", "Amir")
    # Members further down must not appear here: the cards show the direct positions only.
    create(api_client, leader, left["id"], "LEFT", "Arun")

    slots = children(api_client, leader, root_id)

    assert slots["left"]["id"] == left["id"]
    assert slots["left"]["name"] == "Ajay"
    assert slots["right"]["id"] == right["id"]
    assert slots["right"]["name"] == "Amir"


def test_a_branch_member_carries_the_photo_version_their_card_draws_from(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Ajay")

    slot = children(api_client, leader, root_id)["left"]

    # No photo yet, so the field is present and null: the app draws initials and asks for
    # no image at all.
    assert "photo_updated_at" in slot
    assert slot["photo_updated_at"] is None


def test_one_filled_position_leaves_the_other_free(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "RIGHT", "Amir")

    slots = children(api_client, leader, root_id)

    assert slots["left"] is None
    assert slots["right"]["name"] == "Amir"


# --- the leader the dashboard shows ------------------------------------------------------


def test_the_overview_names_the_saved_leader_record(
    api_client: TestClient, leader: Leader, team: dict, root_id: str
) -> None:
    renamed = api_client.patch(
        f"{MEMBERS}/{root_id}", json={"name": "Gopinath J UWTC"}, headers=leader.headers
    )
    assert renamed.status_code == 200, renamed.text

    overview = api_client.get(TEAM, headers=leader.headers).json()

    # The saved preferred name, which is what Home, Team and Settings all show, and what
    # the team label is derived from.
    assert overview["root_member"]["name"] == "Gopinath J UWTC"
    assert overview["root_member"]["is_root"] is True
    # The stored team name was written once at sign-up and is deliberately left alone: the
    # app never shows it, so renaming the leader must not rewrite it either.
    assert overview["team"]["team_name"] == team["team"]["team_name"]


def test_the_root_has_no_placement_of_its_own(team: dict) -> None:
    assert team["root_member"]["placement_position"] is None


# --- the counts follow every structural change -------------------------------------------


def test_registering_a_member_moves_the_counts(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    before = counts(api_client, leader)
    create(api_client, leader, root_id, "LEFT", "Ajay")
    after = counts(api_client, leader)

    assert before == {"total_members": 1, "left_members": 0, "right_members": 0}
    assert after == {"total_members": 2, "left_members": 1, "right_members": 0}


def test_deleting_a_member_moves_the_counts_back(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Ajay")
    amir = create(api_client, leader, root_id, "RIGHT", "Amir")

    removed = api_client.delete(f"{MEMBERS}/{amir['id']}", headers=leader.headers)
    assert removed.status_code == 204, removed.text

    assert counts(api_client, leader) == {
        "total_members": 2,
        "left_members": 1,
        "right_members": 0,
    }


def test_a_reorganizing_deletion_loses_nobody_from_the_counts(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    ajay = create(api_client, leader, root_id, "LEFT", "Ajay")["id"]
    arun = create(api_client, leader, ajay, "LEFT", "Arun")["id"]
    anil = create(api_client, leader, ajay, "RIGHT", "Anil")["id"]
    create(api_client, leader, arun, "LEFT", "Master")
    create(api_client, leader, anil, "RIGHT", "Vendhan")
    create(api_client, leader, root_id, "RIGHT", "Amir")

    before = counts(api_client, leader)
    assert before == {"total_members": 7, "left_members": 5, "right_members": 1}

    result = reorganize(api_client, leader, ajay, promote=arun)

    after = counts(api_client, leader)
    # One member gone, everybody else still counted, and still on the same side.
    assert after == {"total_members": 6, "left_members": 4, "right_members": 1}
    # The operation's own counts are the same numbers a fresh dashboard read gives, so the
    # screen that refreshes after a deletion cannot disagree with the one that caused it.
    assert result["counts"] == after


def test_the_branch_cards_follow_a_reorganizing_deletion(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    ajay = create(api_client, leader, root_id, "LEFT", "Ajay")["id"]
    arun = create(api_client, leader, ajay, "LEFT", "Arun")["id"]
    create(api_client, leader, ajay, "RIGHT", "Anil")

    reorganize(api_client, leader, ajay, promote=arun)

    # Arun took the deleted member's position, so the LEFT card now names Arun.
    assert children(api_client, leader, root_id)["left"]["id"] == arun


def test_a_restarted_dashboard_reads_the_same_numbers(
    api_client: TestClient, leader: Leader, root_id: str, db_settings, verifier
) -> None:
    leg(api_client, leader, root_id, "LEFT", 3)
    leg(api_client, leader, root_id, "RIGHT", 2)
    expected = counts(api_client, leader)

    # A new application instance: new engine, new pool, same PostgreSQL. Nothing about
    # these numbers lives in the API's memory.
    with TestClient(create_app(db_settings, token_verifier=verifier)) as restarted:
        assert counts(restarted, leader) == expected


# --- one leader's numbers are their own --------------------------------------------------


def test_another_leaders_team_never_moves_these_counts(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Ajay")

    other_team = api_client.post(
        INITIALIZE, json={"display_name": "Bela Varga"}, headers=other_leader.headers
    ).json()
    other_root = other_team["root_member"]["id"]
    leg(api_client, other_leader, other_root, "LEFT", 4)
    leg(api_client, other_leader, other_root, "RIGHT", 3)

    assert counts(api_client, leader) == {
        "total_members": 2,
        "left_members": 1,
        "right_members": 0,
    }
    assert counts(api_client, other_leader) == {
        "total_members": 8,
        "left_members": 4,
        "right_members": 3,
    }


def test_another_leaders_root_reveals_no_branch_members(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Ajay")
    api_client.post(INITIALIZE, json={"display_name": "Bela Varga"}, headers=other_leader.headers)

    response = api_client.get(f"{MEMBERS}/{root_id}/children", headers=other_leader.headers)

    # Indistinguishable from a member that does not exist.
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "member_not_found"


def test_the_dashboard_requires_a_verified_session(api_client: TestClient, team: dict) -> None:
    assert api_client.get(TEAM).status_code == 401
    assert api_client.get(TEAM, headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_a_leader_with_no_team_is_told_to_initialize(
    api_client: TestClient, other_leader: Leader
) -> None:
    response = api_client.get(TEAM, headers=other_leader.headers)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "team_not_initialized"
