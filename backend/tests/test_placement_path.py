"""The exact placement path: the real chain from a team's root down to one member."""

import uuid

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient
from sqlalchemy import insert, text

from app.models import Member
from app.services.member_service import MAX_PLACEMENT_PATH_STEPS

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"


@pytest.fixture
def team(api_client: TestClient, leader: Leader) -> dict:
    return api_client.post(
        INITIALIZE, json={"display_name": "Gopinath J UWTC"}, headers=leader.headers
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


def path(client: TestClient, leader: Leader, member_id: str):
    return client.get(f"{MEMBERS}/{member_id}/placement-path", headers=leader.headers)


def steps(response) -> list[tuple[str, str | None]]:
    """Each step as (name, the side it occupies under the step before it)."""
    return [(step["name"], step["placement_position"]) for step in response.json()["steps"]]


def error_code(response) -> str:
    return response.json()["error"]["code"]


# --- the shape of a path ------------------------------------------------------------------


def test_the_root_member_is_a_path_of_one_step(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = path(api_client, leader, root_id)

    assert response.status_code == 200
    body = response.json()
    assert steps(response) == [("Gopinath J UWTC", None)]
    assert body["depth"] == 0
    assert body["member"]["id"] == root_id
    assert body["steps"][0]["is_root"] is True


@pytest.mark.parametrize("side", ["LEFT", "RIGHT"])
def test_a_direct_child_is_the_root_and_then_them(
    api_client: TestClient, leader: Leader, root_id: str, side: str
) -> None:
    child = create(api_client, leader, root_id, side, "Ajay")

    response = path(api_client, leader, child["id"])

    assert steps(response) == [("Gopinath J UWTC", None), ("Ajay", side)]
    assert response.json()["depth"] == 1


def test_a_mixed_path_names_every_turn_in_order(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The example from the specification, built from real placements.

    Gopinath (ROOT) -> LEFT -> Ajay -> RIGHT -> Anil -> LEFT -> Vijay
    """
    ajay = create(api_client, leader, root_id, "LEFT", "Ajay")
    anil = create(api_client, leader, ajay["id"], "RIGHT", "Anil")
    vijay = create(api_client, leader, anil["id"], "LEFT", "Vijay")

    response = path(api_client, leader, vijay["id"])

    assert steps(response) == [
        ("Gopinath J UWTC", None),
        ("Ajay", "LEFT"),
        ("Anil", "RIGHT"),
        ("Vijay", "LEFT"),
    ]
    assert response.json()["depth"] == 3
    # The path ends at the member who was asked about.
    assert response.json()["steps"][-1]["id"] == vijay["id"]
    assert response.json()["member"]["id"] == vijay["id"]


@pytest.mark.parametrize("side", ["LEFT", "RIGHT"])
def test_a_deep_single_sided_path_keeps_every_step(
    api_client: TestClient, leader: Leader, root_id: str, side: str
) -> None:
    parent = root_id
    for level in range(8):
        parent = create(api_client, leader, parent, side, f"Level {level + 1}")["id"]

    response = path(api_client, leader, parent)

    assert response.json()["depth"] == 8
    assert steps(response)[0] == ("Gopinath J UWTC", None)
    assert steps(response)[1:] == [(f"Level {level + 1}", side) for level in range(8)]


def test_the_path_is_the_placement_chain_not_the_order_members_were_registered(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A member registered last can sit directly under the root, and a member
    registered first can sit three levels down. The path must follow the structure."""
    first = create(api_client, leader, root_id, "LEFT", "Registered First")
    second = create(api_client, leader, first["id"], "LEFT", "Registered Second")
    create(api_client, leader, second["id"], "LEFT", "Registered Third")
    last = create(api_client, leader, root_id, "RIGHT", "Registered Last")

    # Registered last, but one step from the root.
    assert steps(path(api_client, leader, last["id"])) == [
        ("Gopinath J UWTC", None),
        ("Registered Last", "RIGHT"),
    ]
    # Registered second, but two steps down — and the chain runs through the first.
    assert steps(path(api_client, leader, second["id"])) == [
        ("Gopinath J UWTC", None),
        ("Registered First", "LEFT"),
        ("Registered Second", "LEFT"),
    ]


def test_siblings_share_their_ancestors_and_differ_only_at_the_last_step(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    parent = create(api_client, leader, root_id, "LEFT", "Parent")
    left = create(api_client, leader, parent["id"], "LEFT", "Left Child")
    right = create(api_client, leader, parent["id"], "RIGHT", "Right Child")

    left_path = steps(path(api_client, leader, left["id"]))
    right_path = steps(path(api_client, leader, right["id"]))

    assert left_path[:-1] == right_path[:-1]
    assert left_path[-1] == ("Left Child", "LEFT")
    assert right_path[-1] == ("Right Child", "RIGHT")


def test_a_step_carries_what_a_row_needs_and_no_more(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Ajay")

    step = path(api_client, leader, member["id"]).json()["steps"][-1]

    assert set(step) == {
        "id",
        "name",
        "mi_lifestyle_id",
        "placement_position",
        "is_root",
        "joining_date",
        "created_at",
        "photo_updated_at",
    }


# --- the path reflects changes ------------------------------------------------------------


def test_a_reorganized_tree_produces_a_new_path_for_the_members_that_moved(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Deleting a member with a branch below them changes who sits where, and the next
    path request must say so rather than repeat what used to be true."""
    ajay = create(api_client, leader, root_id, "LEFT", "Ajay")
    anil = create(api_client, leader, ajay["id"], "LEFT", "Anil")
    vijay = create(api_client, leader, anil["id"], "LEFT", "Vijay")

    assert steps(path(api_client, leader, vijay["id"])) == [
        ("Gopinath J UWTC", None),
        ("Ajay", "LEFT"),
        ("Anil", "LEFT"),
        ("Vijay", "LEFT"),
    ]

    plan = api_client.get(f"{MEMBERS}/{ajay['id']}/deletion-plan", headers=leader.headers).json()
    confirmed = api_client.post(
        f"{MEMBERS}/{ajay['id']}/deletion",
        json={"promote_member_id": anil["id"], "plan_token": plan["plan_token"]},
        headers=leader.headers,
    )
    assert confirmed.status_code == 200, confirmed.text

    # Anil took Ajay's position, so Vijay is now one step shallower.
    assert steps(path(api_client, leader, vijay["id"])) == [
        ("Gopinath J UWTC", None),
        ("Anil", "LEFT"),
        ("Vijay", "LEFT"),
    ]


def test_a_renamed_ancestor_is_named_as_they_are_now(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    ajay = create(api_client, leader, root_id, "LEFT", "Ajay")
    child = create(api_client, leader, ajay["id"], "LEFT", "Anil")

    api_client.patch(f"{MEMBERS}/{ajay['id']}", json={"name": "Ajay Kumar"}, headers=leader.headers)

    assert steps(path(api_client, leader, child["id"]))[1] == ("Ajay Kumar", "LEFT")


# --- refusals ------------------------------------------------------------------------------


def test_an_unknown_member_is_not_found(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = path(api_client, leader, str(uuid.uuid4()))

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"


def test_a_member_id_that_is_not_an_id_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    assert path(api_client, leader, "not-a-uuid").status_code == 422


def test_another_leaders_member_is_indistinguishable_from_one_that_does_not_exist(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    other = api_client.post(
        INITIALIZE, json={"display_name": "Other Leader"}, headers=other_leader.headers
    ).json()
    theirs = create(api_client, other_leader, other["root_member"]["id"], "LEFT", "Hidden")

    response = path(api_client, leader, theirs["id"])

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"
    # Not a word about the other team's member, or their position in it.
    assert "Hidden" not in response.text


def test_another_leaders_root_cannot_be_used_to_read_their_structure(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    other = api_client.post(
        INITIALIZE, json={"display_name": "Other Leader"}, headers=other_leader.headers
    ).json()

    assert path(api_client, leader, other["root_member"]["id"]).status_code == 404


def test_a_path_cannot_be_read_without_a_token(api_client: TestClient, root_id: str) -> None:
    assert api_client.get(f"{MEMBERS}/{root_id}/placement-path").status_code == 401


def test_a_cyclic_chain_is_refused_rather_than_walked_or_half_drawn(
    api_client: TestClient, leader: Leader, root_id: str, session_factory
) -> None:
    """A cycle cannot be created through the API; it is forced here to prove that a
    damaged chain is reported instead of being presented as a path."""
    first = create(api_client, leader, root_id, "LEFT", "First")
    second = create(api_client, leader, first["id"], "LEFT", "Second")

    with session_factory() as session:
        # First now hangs off Second, and Second off First: a closed loop that never
        # reaches the root. Only the multi-member case can be forced — a member being
        # its own parent is refused by a CHECK constraint.
        session.execute(
            text("UPDATE members SET placement_parent_id = :second WHERE id = :first"),
            {"second": second["id"], "first": first["id"]},
        )
        session.commit()

    response = path(api_client, leader, second["id"])

    assert response.status_code == 409
    assert error_code(response) == "placement_chain_invalid"


# A chain that reaches neither the root nor a cycle is not reachable while the schema
# holds: the placement foreign key means every parent exists in the same team, and
# `ck_members_root_has_no_placement` means the only member without a parent is the root.
# Walking upwards therefore ends at the root unless it loops, which the test above
# covers. The service still checks for it, because a check that can never fire is
# cheaper than a path drawn from a tree nobody noticed was damaged.


def test_a_chain_longer_than_the_limit_is_refused_rather_than_returned(
    api_client: TestClient, leader: Leader, root_id: str, session_factory
) -> None:
    """A valid but absurd structure: one unbroken leg past the 1,000-step bound.

    Seeded directly — a thousand API calls would be measuring registration — and every
    row is a legitimate placement, so this is the bound being enforced rather than
    damage being detected.
    """
    with session_factory() as session:
        team_id = session.execute(
            text("SELECT team_id FROM members WHERE id = :id"), {"id": root_id}
        ).scalar_one()

        rows = []
        parent_id = uuid.UUID(root_id)
        for level in range(MAX_PLACEMENT_PATH_STEPS + 1):
            member_id = uuid.uuid4()
            rows.append(
                {
                    "id": member_id,
                    "team_id": team_id,
                    "name": f"Deep {level + 1:04d}",
                    "mi_lifestyle_id": f"3{level + 1:09d}",
                    "placement_parent_id": parent_id,
                    "placement_position": "LEFT",
                    "is_root": False,
                }
            )
            parent_id = member_id

        session.execute(insert(Member), rows)
        session.commit()
        deepest = rows[-1]["id"]
        just_inside = rows[MAX_PLACEMENT_PATH_STEPS - 2]["id"]

    refused = path(api_client, leader, str(deepest))
    assert refused.status_code == 409
    assert error_code(refused) == "placement_path_too_deep"

    # The member one step inside the bound is still shown in full.
    allowed = path(api_client, leader, str(just_inside))
    assert allowed.status_code == 200
    assert allowed.json()["depth"] == MAX_PLACEMENT_PATH_STEPS - 1
    assert allowed.json()["steps"][0]["is_root"] is True
