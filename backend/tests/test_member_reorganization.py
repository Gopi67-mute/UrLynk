"""Safe deletion: promoting a child and reattaching the other subtree.

`DELETE /api/v1/members/{id}` refuses a member who has anyone below them. These tests
cover the operation that removes such a member without losing anybody:

    GET  /api/v1/members/{id}/deletion-plan[?promote=<child id>]   read-only preview
    POST /api/v1/members/{id}/deletion                             the confirmed change

The two things worth testing hardest are where the detached subtree lands — breadth
first, LEFT before RIGHT, inside the promoted member's own branch — and that every
refusal, every stale confirmation and every failure leaves the team exactly as it was.
"""

import base64
import struct
import threading
import uuid
import zlib

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.repositories import member_repository, team_repository
from app.schemas.member import MemberCreate
from app.services import member_service

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"
TEAM = "/api/v1/teams/me"


@pytest.fixture
def team(api_client: TestClient, leader: Leader) -> dict:
    return api_client.post(
        INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers
    ).json()


@pytest.fixture
def root_id(team: dict) -> str:
    return team["root_member"]["id"]


@pytest.fixture
def team_id(team: dict) -> uuid.UUID:
    return uuid.UUID(team["team"]["id"])


# --- helpers -----------------------------------------------------------------------------


def create(
    client: TestClient,
    leader: Leader,
    parent_id: str,
    position: str,
    name: str,
    **extra: object,
) -> dict:
    response = client.post(
        MEMBERS,
        json={
            "name": name,
            "placement_parent_id": parent_id,
            "placement_position": position,
            "mi_lifestyle_id": next_mi_lifestyle_id(),
            **extra,
        },
        headers=leader.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def plan(client: TestClient, leader: Leader, member_id: str, promote: str | None = None):
    query = f"?promote={promote}" if promote else ""
    return client.get(f"{MEMBERS}/{member_id}/deletion-plan{query}", headers=leader.headers)


def get_plan(
    client: TestClient, leader: Leader, member_id: str, promote: str | None = None
) -> dict:
    response = plan(client, leader, member_id, promote)
    assert response.status_code == 200, response.text
    return response.json()


def confirm(
    client: TestClient,
    leader: Leader,
    member_id: str,
    *,
    token: str,
    promote: str | None = None,
):
    body: dict[str, object] = {"plan_token": token}
    if promote is not None:
        body["promote_member_id"] = promote
    return client.post(f"{MEMBERS}/{member_id}/deletion", json=body, headers=leader.headers)


def reorganize(
    client: TestClient, leader: Leader, member_id: str, promote: str | None = None
) -> dict:
    """Preview and confirm in the ordinary way: exactly what the app does."""
    previewed = get_plan(client, leader, member_id, promote)
    response = confirm(client, leader, member_id, token=previewed["plan_token"], promote=promote)
    assert response.status_code == 200, response.text
    return response.json()


def read(client: TestClient, leader: Leader, member_id: str):
    return client.get(f"{MEMBERS}/{member_id}", headers=leader.headers)


def member(client: TestClient, leader: Leader, member_id: str) -> dict:
    response = read(client, leader, member_id)
    assert response.status_code == 200, response.text
    return response.json()


def children(client: TestClient, leader: Leader, member_id: str) -> dict:
    response = client.get(f"{MEMBERS}/{member_id}/children", headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()


def child_id(client: TestClient, leader: Leader, member_id: str, side: str) -> str | None:
    slot = children(client, leader, member_id)[side.lower()]
    return slot["id"] if slot else None


def directory(client: TestClient, leader: Leader) -> list[dict]:
    response = client.get(f"{MEMBERS}?limit=100", headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def counts(client: TestClient, leader: Leader) -> dict:
    response = client.get(TEAM, headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()["counts"]


def error_code(response) -> str:
    return response.json()["error"]["code"]


def png() -> bytes:
    """A real, valid 1x1 PNG."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00", 9))
        + chunk(b"IEND", b"")
    )


def upload_photo(client: TestClient, leader: Leader, member_id: str) -> str:
    response = client.put(
        f"{MEMBERS}/{member_id}/photo",
        json={"content_type": "image/png", "data": base64.b64encode(png()).decode("ascii")},
        headers=leader.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["data_uri"]


def photo(client: TestClient, leader: Leader, member_id: str):
    return client.get(f"{MEMBERS}/{member_id}/photo", headers=leader.headers)


def assert_tree_is_sound(session: Session, team_id: uuid.UUID) -> None:
    """Every member hangs from the root, through a chain with no cycle, in one slot each.

    The three invariants a reorganization could break, checked from the database rather
    than from the API's own account of what it did.
    """
    assert not member_repository.has_duplicate_slots(session, team_id)

    root = member_repository.get_root(session, team_id)
    assert root is not None

    members = member_repository.list_page(session, team_id, limit=10_000)
    for record in members:
        if record.is_root:
            assert record.placement_parent_id is None
            assert record.placement_position is None
            continue
        assert record.placement_parent_id is not None
        assert record.placement_position is not None
        chain = member_repository.ancestor_chain_status(session, team_id, record.id)
        assert chain.reaches_root, f"{record.name} is not connected to the root"
        assert not chain.has_cycle, f"{record.name} sits on a cycle"


# --- A. a member with nobody below them --------------------------------------------------


def test_a_member_with_nobody_below_them_needs_no_reorganization(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The plan says there is nothing to choose and nothing to move."""
    only = create(api_client, leader, root_id, "LEFT", "Palanivel")

    previewed = get_plan(api_client, leader, only["id"])

    assert previewed["promotable"] == []
    assert previewed["requires_promotion_choice"] is False
    assert previewed["promoted"] is None
    assert previewed["reattachment"] is None
    assert previewed["placement_parent"]["id"] == root_id
    assert previewed["placement_position"] == "LEFT"


def test_a_member_with_nobody_below_them_is_deleted_by_the_ordinary_route(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Case A keeps the plain deletion it always had."""
    only = create(api_client, leader, root_id, "LEFT", "Palanivel")

    assert api_client.delete(f"{MEMBERS}/{only['id']}", headers=leader.headers).status_code == 204
    assert read(api_client, leader, only["id"]).status_code == 404


def test_the_confirmed_route_also_removes_a_member_with_nobody_below_them(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    only = create(api_client, leader, root_id, "LEFT", "Palanivel")

    result = reorganize(api_client, leader, only["id"])

    assert result["deleted_member_id"] == only["id"]
    assert result["promoted"] is None
    assert result["reattached"] is None
    assert read(api_client, leader, only["id"]).status_code == 404


def test_an_ordinary_delete_still_refuses_a_member_with_children(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The new operation is not reachable through the old endpoint."""
    parent = create(api_client, leader, root_id, "LEFT", "Jd")
    child = create(api_client, leader, parent["id"], "LEFT", "Ravi")

    response = api_client.delete(f"{MEMBERS}/{parent['id']}", headers=leader.headers)

    assert response.status_code == 409
    assert error_code(response) == "member_has_children"
    assert read(api_client, leader, parent["id"]).status_code == 200
    assert member(api_client, leader, child["id"])["placement_parent"]["id"] == parent["id"]


# --- B. exactly one child ----------------------------------------------------------------


def test_a_single_left_child_is_promoted_into_the_deleted_members_position(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    parent = create(api_client, leader, root_id, "LEFT", "Jd")
    only_child = create(api_client, leader, parent["id"], "LEFT", "Ravi")

    previewed = get_plan(api_client, leader, parent["id"])
    assert previewed["requires_promotion_choice"] is False
    assert previewed["promoted"]["id"] == only_child["id"]
    assert previewed["reattachment"] is None

    reorganize(api_client, leader, parent["id"], promote=only_child["id"])

    promoted = member(api_client, leader, only_child["id"])
    assert promoted["placement_parent"]["id"] == root_id
    assert promoted["placement_position"] == "LEFT"
    assert read(api_client, leader, parent["id"]).status_code == 404


def test_a_single_right_child_is_promoted_into_the_deleted_members_position(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The promoted member takes the deleted member's side, not their own."""
    parent = create(api_client, leader, root_id, "RIGHT", "Jd")
    only_child = create(api_client, leader, parent["id"], "RIGHT", "Rk")

    reorganize(api_client, leader, parent["id"], promote=only_child["id"])

    promoted = member(api_client, leader, only_child["id"])
    assert promoted["placement_parent"]["id"] == root_id
    assert promoted["placement_position"] == "RIGHT"


def test_a_promoted_members_own_branch_moves_up_with_them(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    parent = create(api_client, leader, root_id, "LEFT", "Jd")
    only_child = create(api_client, leader, parent["id"], "LEFT", "Ravi")
    below_left = create(api_client, leader, only_child["id"], "LEFT", "Kiran")
    below_right = create(api_client, leader, only_child["id"], "RIGHT", "Meena")

    reorganize(api_client, leader, parent["id"], promote=only_child["id"])

    assert child_id(api_client, leader, only_child["id"], "LEFT") == below_left["id"]
    assert child_id(api_client, leader, only_child["id"], "RIGHT") == below_right["id"]


# --- C. two children ---------------------------------------------------------------------


@pytest.fixture
def two_child_tree(api_client: TestClient, leader: Leader, root_id: str) -> dict:
    """The example from the specification: root -> Jd, with Ravi LEFT and Rk RIGHT."""
    jd = create(api_client, leader, root_id, "LEFT", "Jd")
    ravi = create(api_client, leader, jd["id"], "LEFT", "Ravi")
    rk = create(api_client, leader, jd["id"], "RIGHT", "Rk")
    return {"jd": jd, "ravi": ravi, "rk": rk}


def test_a_member_with_two_children_asks_which_should_take_their_position(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    previewed = get_plan(api_client, leader, two_child_tree["jd"]["id"])

    assert previewed["requires_promotion_choice"] is True
    assert previewed["promoted"] is None
    assert previewed["reattachment"] is None
    # Both candidates, LEFT first, so the screen can offer them in that order.
    assert [candidate["id"] for candidate in previewed["promotable"]] == [
        two_child_tree["ravi"]["id"],
        two_child_tree["rk"]["id"],
    ]
    assert [candidate["placement_position"] for candidate in previewed["promotable"]] == [
        "LEFT",
        "RIGHT",
    ]


def test_promoting_the_left_child_reattaches_the_right_subtree(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    """The specification's own example, start to finish."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    assert previewed["promoted"]["id"] == ravi["id"]
    assert previewed["reattachment"]["member"]["id"] == rk["id"]
    assert previewed["reattachment"]["destination"]["id"] == ravi["id"]
    assert previewed["reattachment"]["destination_position"] == "LEFT"

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    # Ravi took Jd's place under the root.
    assert child_id(api_client, leader, root_id, "LEFT") == ravi["id"]
    # Rk hangs from Ravi's first free position.
    assert child_id(api_client, leader, ravi["id"], "LEFT") == rk["id"]
    assert read(api_client, leader, jd["id"]).status_code == 404


def test_promoting_the_right_child_is_equally_valid(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]

    reorganize(api_client, leader, jd["id"], promote=rk["id"])

    promoted = member(api_client, leader, rk["id"])
    assert promoted["placement_parent"]["id"] == root_id
    assert promoted["placement_position"] == "LEFT"  # Jd's side, not Rk's
    assert child_id(api_client, leader, rk["id"], "LEFT") == ravi["id"]


def test_a_member_who_is_not_a_direct_child_cannot_be_promoted(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd = two_child_tree["jd"]
    grandchild = create(api_client, leader, two_child_tree["ravi"]["id"], "LEFT", "Kiran")

    response = plan(api_client, leader, jd["id"], promote=grandchild["id"])

    assert response.status_code == 422
    assert error_code(response) == "invalid_promotion_choice"


def test_confirming_without_naming_a_promotion_is_refused(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """A member with children is never reorganized on a guess."""
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    response = confirm(api_client, leader, jd["id"], token=token)

    assert response.status_code == 422
    assert error_code(response) == "invalid_promotion_choice"
    assert read(api_client, leader, jd["id"]).status_code == 200


def test_naming_a_promotion_for_a_childless_member_is_refused(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    only = create(api_client, leader, root_id, "LEFT", "Palanivel")
    other = create(api_client, leader, root_id, "RIGHT", "Meena")
    token = get_plan(api_client, leader, only["id"])["plan_token"]

    response = confirm(api_client, leader, only["id"], token=token, promote=other["id"])

    assert response.status_code == 422
    assert error_code(response) == "invalid_promotion_choice"
    assert read(api_client, leader, only["id"]).status_code == 200
    assert read(api_client, leader, other["id"]).status_code == 200


def test_an_unrelated_member_cannot_be_promoted(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    elsewhere = create(api_client, leader, root_id, "RIGHT", "Meena")
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    response = confirm(api_client, leader, jd["id"], token=token, promote=elsewhere["id"])

    assert response.status_code == 422
    assert error_code(response) == "invalid_promotion_choice"
    assert member(api_client, leader, elsewhere["id"])["placement_parent"]["id"] == root_id


# --- D. the root member ------------------------------------------------------------------


def test_the_root_member_has_no_deletion_plan(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = plan(api_client, leader, root_id)

    assert response.status_code == 409
    assert error_code(response) == "root_member_undeletable"


def test_the_root_member_cannot_be_reorganized_away(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Not even with a plan token and a real child to promote."""
    child = create(api_client, leader, root_id, "LEFT", "Palanivel")
    # A token for a different, valid plan — the root refusal comes first regardless.
    token = get_plan(api_client, leader, child["id"])["plan_token"]

    response = confirm(api_client, leader, root_id, token=token, promote=child["id"])

    assert response.status_code == 409
    assert error_code(response) == "root_member_undeletable"
    assert member(api_client, leader, root_id)["is_root"] is True
    assert read(api_client, leader, child["id"]).status_code == 200


# --- E. a member who sponsors others -----------------------------------------------------


def test_a_member_who_sponsors_someone_cannot_be_reorganized_away(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Placement and sponsorship are separate, and this operation only moves placement."""
    sponsor = create(api_client, leader, root_id, "LEFT", "Jd")
    create(api_client, leader, sponsor["id"], "LEFT", "Ravi")
    create(api_client, leader, root_id, "RIGHT", "Meena", sponsor_id=sponsor["id"])

    previewed = plan(api_client, leader, sponsor["id"])
    assert previewed.status_code == 409
    assert error_code(previewed) == "member_sponsors_others"


def test_a_sponsor_refusal_survives_a_confirmation_attempt(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The plan is taken before the sponsorship exists, so the check must be at the end too."""
    sponsor = create(api_client, leader, root_id, "LEFT", "Jd")
    child = create(api_client, leader, sponsor["id"], "LEFT", "Ravi")
    token = get_plan(api_client, leader, sponsor["id"], promote=child["id"])["plan_token"]

    sponsored = create(api_client, leader, root_id, "RIGHT", "Meena", sponsor_id=sponsor["id"])

    response = confirm(api_client, leader, sponsor["id"], token=token, promote=child["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_sponsors_others"
    assert read(api_client, leader, sponsor["id"]).status_code == 200
    assert member(api_client, leader, sponsored["id"])["sponsor"]["id"] == sponsor["id"]


def test_sponsor_relationships_elsewhere_are_untouched_by_a_reorganization(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    # Ravi sponsors someone, and someone sponsors Rk. Neither involves Jd.
    sponsored_by_ravi = create(api_client, leader, root_id, "RIGHT", "Meena", sponsor_id=ravi["id"])
    api_client.patch(f"{MEMBERS}/{rk['id']}", json={"sponsor_id": root_id}, headers=leader.headers)

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    assert member(api_client, leader, sponsored_by_ravi["id"])["sponsor"]["id"] == ravi["id"]
    assert member(api_client, leader, rk["id"])["sponsor"]["id"] == root_id


# --- the breadth-first, LEFT-first search ------------------------------------------------


def test_an_empty_left_slot_under_the_promoted_member_is_used_first(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Both of Ravi's slots are free, so LEFT wins."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert previewed["reattachment"]["destination"]["id"] == ravi["id"]
    assert previewed["reattachment"]["destination_position"] == "LEFT"

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])
    assert child_id(api_client, leader, ravi["id"], "LEFT") == rk["id"]


def test_an_occupied_left_slot_sends_the_subtree_to_the_right(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    create(api_client, leader, ravi["id"], "LEFT", "Kiran")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert previewed["reattachment"]["destination"]["id"] == ravi["id"]
    assert previewed["reattachment"]["destination_position"] == "RIGHT"

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])
    assert child_id(api_client, leader, ravi["id"], "RIGHT") == rk["id"]


def test_two_occupied_slots_send_the_search_down_a_level(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Ravi is full, so the search moves to his children — his LEFT child first."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    create(api_client, leader, ravi["id"], "RIGHT", "Meena")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert previewed["reattachment"]["destination"]["id"] == ravi_left["id"]
    assert previewed["reattachment"]["destination_position"] == "LEFT"

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])
    assert child_id(api_client, leader, ravi_left["id"], "LEFT") == rk["id"]


def test_the_search_finishes_a_level_before_going_deeper(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """A free slot one level down beats a free slot two levels down.

    Ravi is full. His LEFT child is full too, but his RIGHT child has a free slot. The
    deeper openings under the LEFT child must be passed over for it.
    """
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    ravi_right = create(api_client, leader, ravi["id"], "RIGHT", "Meena")
    # The LEFT child is full, so its own children sit a level below the answer.
    create(api_client, leader, ravi_left["id"], "LEFT", "Arun")
    create(api_client, leader, ravi_left["id"], "RIGHT", "Divya")
    # The RIGHT child has its LEFT taken and its RIGHT free: the shallowest opening.
    create(api_client, leader, ravi_right["id"], "LEFT", "Sunil")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert previewed["reattachment"]["destination"]["id"] == ravi_right["id"]
    assert previewed["reattachment"]["destination_position"] == "RIGHT"

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])
    assert child_id(api_client, leader, ravi_right["id"], "RIGHT") == rk["id"]


def test_the_left_child_is_inspected_before_the_right_at_every_level(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Both of Ravi's children have a free RIGHT slot. The LEFT child's is chosen."""
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    ravi_right = create(api_client, leader, ravi["id"], "RIGHT", "Meena")
    create(api_client, leader, ravi_left["id"], "LEFT", "Arun")
    create(api_client, leader, ravi_right["id"], "LEFT", "Sunil")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert previewed["reattachment"]["destination"]["id"] == ravi_left["id"]
    assert previewed["reattachment"]["destination_position"] == "RIGHT"
    assert previewed["reattachment"]["destination"]["id"] != ravi_right["id"]


def test_the_destination_path_spells_out_the_way_down(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """From the promoted member to the destination, with the side of each step."""
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    create(api_client, leader, ravi["id"], "RIGHT", "Meena")
    create(api_client, leader, ravi_left["id"], "LEFT", "Arun")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    path = previewed["reattachment"]["destination_path"]

    assert [step["id"] for step in path] == [ravi["id"], ravi_left["id"]]
    assert [step["name"] for step in path] == ["Ravi", "Kiran"]
    # The first step is the promoted member, so it carries no side of its own.
    assert path[0]["placement_position"] is None
    assert path[1]["placement_position"] == "LEFT"
    assert previewed["reattachment"]["destination"]["id"] == ravi_left["id"]
    assert previewed["reattachment"]["destination_position"] == "RIGHT"


def test_the_detached_subtree_is_never_offered_as_a_destination(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Rk's own free slots cannot host Rk. The answer stays inside Ravi's branch.

    Ravi is full to two levels, so the search has somewhere to go; Rk's subtree has free
    slots much higher up, and all of them are ignored.
    """
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    create(api_client, leader, ravi["id"], "RIGHT", "Meena")
    # Rk's branch: plenty of room, none of it eligible.
    rk_left = create(api_client, leader, rk["id"], "LEFT", "Nisha")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    reattachment = previewed["reattachment"]

    destination_ids = {step["id"] for step in reattachment["destination_path"]}
    assert rk["id"] not in destination_ids
    assert rk_left["id"] not in destination_ids
    assert reattachment["destination"]["id"] == ravi_left["id"]

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])
    # Rk landed under Ravi's branch, and still carries their own branch.
    assert member(api_client, leader, rk["id"])["placement_parent"]["id"] == ravi_left["id"]
    assert child_id(api_client, leader, rk["id"], "LEFT") == rk_left["id"]


def test_the_whole_detached_subtree_keeps_its_internal_structure(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Only the relationship at the top of the moved branch changes."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    rk_left = create(api_client, leader, rk["id"], "LEFT", "Nisha")
    rk_right = create(api_client, leader, rk["id"], "RIGHT", "Vikram")
    deep_left = create(api_client, leader, rk_left["id"], "LEFT", "Latha")
    deep_right = create(api_client, leader, rk_right["id"], "RIGHT", "Gopal")

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    assert child_id(api_client, leader, rk["id"], "LEFT") == rk_left["id"]
    assert child_id(api_client, leader, rk["id"], "RIGHT") == rk_right["id"]
    assert child_id(api_client, leader, rk_left["id"], "LEFT") == deep_left["id"]
    assert child_id(api_client, leader, rk_right["id"], "RIGHT") == deep_right["id"]
    assert member(api_client, leader, deep_left["id"])["placement_position"] == "LEFT"
    assert member(api_client, leader, deep_right["id"])["placement_position"] == "RIGHT"


def test_the_promoted_members_own_children_are_not_displaced(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Ravi's children stay exactly where they are; Rk goes below them."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    ravi_right = create(api_client, leader, ravi["id"], "RIGHT", "Meena")

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    assert child_id(api_client, leader, ravi["id"], "LEFT") == ravi_left["id"]
    assert child_id(api_client, leader, ravi["id"], "RIGHT") == ravi_right["id"]
    assert child_id(api_client, leader, ravi_left["id"], "LEFT") == rk["id"]


def test_the_reattachment_says_how_many_members_are_moving(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    rk_left = create(api_client, leader, rk["id"], "LEFT", "Nisha")
    create(api_client, leader, rk["id"], "RIGHT", "Vikram")
    create(api_client, leader, rk_left["id"], "LEFT", "Latha")

    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    # Rk and the three below them.
    assert previewed["reattachment"]["member_count"] == 4


# --- integrity and data preservation -----------------------------------------------------


def test_every_surviving_member_keeps_their_identifier(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    create(api_client, leader, rk["id"], "RIGHT", "Vikram")
    before = {item["id"] for item in directory(api_client, leader)}

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    after = {item["id"] for item in directory(api_client, leader)}
    assert after == before - {jd["id"]}


def test_every_surviving_member_keeps_their_details(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    jd = create(api_client, leader, root_id, "LEFT", "Jd")
    ravi = create(
        api_client,
        leader,
        jd["id"],
        "LEFT",
        "Ravi",
        phone_number="+91 98765 43210",
        joining_date="2024-03-15",
        notes="Met at the Chennai meet.",
    )
    rk = create(
        api_client,
        leader,
        jd["id"],
        "RIGHT",
        "Rk",
        phone_number="044-2345-6789",
        joining_date="2023-11-01",
        notes="Runs the Coimbatore group.",
    )
    before = {
        record["id"]: record
        for record in (member(api_client, leader, ravi["id"]), member(api_client, leader, rk["id"]))
    }

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    for member_id, original in before.items():
        current = member(api_client, leader, member_id)
        for field in ("name", "mi_lifestyle_id", "phone_number", "joining_date", "notes"):
            assert current[field] == original[field], field


def test_photographs_survive_a_reorganization(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    below_rk = create(api_client, leader, rk["id"], "LEFT", "Nisha")
    ravi_photo = upload_photo(api_client, leader, ravi["id"])
    rk_photo = upload_photo(api_client, leader, rk["id"])
    deep_photo = upload_photo(api_client, leader, below_rk["id"])
    upload_photo(api_client, leader, jd["id"])

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    assert photo(api_client, leader, ravi["id"]).json()["data_uri"] == ravi_photo
    assert photo(api_client, leader, rk["id"]).json()["data_uri"] == rk_photo
    assert photo(api_client, leader, below_rk["id"]).json()["data_uri"] == deep_photo
    # The deleted member's photo went with them.
    assert photo(api_client, leader, jd["id"]).status_code == 404


def test_the_tree_is_still_a_tree_afterwards(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """Checked against the database: no cycles, no orphans, no shared positions."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    ravi_left = create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    create(api_client, leader, ravi["id"], "RIGHT", "Meena")
    create(api_client, leader, ravi_left["id"], "LEFT", "Arun")
    create(api_client, leader, rk["id"], "LEFT", "Nisha")
    create(api_client, leader, rk["id"], "RIGHT", "Vikram")

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    with session_factory() as session:
        assert_tree_is_sound(session, team_id)
        assert member_repository.get(session, team_id, uuid.UUID(jd["id"])) is None


def test_the_team_counts_are_right_after_a_reorganization(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    create(api_client, leader, rk["id"], "LEFT", "Nisha")
    create(api_client, leader, root_id, "RIGHT", "Meena")
    before = counts(api_client, leader)
    assert before == {"total_members": 6, "left_members": 4, "right_members": 1}

    result = reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    expected = {"total_members": 5, "left_members": 3, "right_members": 1}
    # Returned with the result, so the screen is correct without another request...
    assert result["counts"] == expected
    # ...and the team endpoint agrees.
    assert counts(api_client, leader) == expected


def test_a_reorganized_member_no_longer_appears_in_recently_added(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    recent = api_client.get(f"{MEMBERS}/recent", headers=leader.headers)
    assert recent.status_code == 200, recent.text
    assert all(entry["id"] != jd["id"] for entry in recent.json())


# --- team isolation ----------------------------------------------------------------------


def test_another_leaders_member_has_no_deletion_plan(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_child_tree: dict
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)

    response = plan(api_client, other_leader, two_child_tree["jd"]["id"])

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"


def test_another_leader_cannot_confirm_a_reorganization(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_child_tree: dict
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    # A perfectly valid token — but taken in someone else's team.
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    response = confirm(api_client, other_leader, jd["id"], token=token, promote=ravi["id"])

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"
    assert read(api_client, leader, jd["id"]).status_code == 200


def test_a_member_of_another_team_cannot_be_named_as_the_promotion(
    api_client: TestClient, leader: Leader, other_leader: Leader, two_child_tree: dict
) -> None:
    """A cross-team ID reads exactly like one that is not a child of this member."""
    other_team = api_client.post(INITIALIZE, json={}, headers=other_leader.headers).json()
    outsider = create(api_client, other_leader, other_team["root_member"]["id"], "LEFT", "Outsider")
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    response = confirm(api_client, leader, jd["id"], token=token, promote=outsider["id"])

    assert response.status_code == 422
    assert error_code(response) == "invalid_promotion_choice"
    # The outsider is untouched in their own team.
    assert (
        member(api_client, other_leader, outsider["id"])["placement_parent"]["id"]
        == (other_team["root_member"]["id"])
    )


def test_an_unauthenticated_reorganization_is_rejected(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    assert api_client.get(f"{MEMBERS}/{jd['id']}/deletion-plan").status_code == 401
    unconfirmed = api_client.post(
        f"{MEMBERS}/{jd['id']}/deletion",
        json={"plan_token": token, "promote_member_id": ravi["id"]},
    )
    assert unconfirmed.status_code == 401
    assert read(api_client, leader, jd["id"]).status_code == 200


# --- the preview is read-only ------------------------------------------------------------


def test_asking_for_a_plan_changes_nothing(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """A leader who looks and walks away leaves the team exactly as it was."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    create(api_client, leader, rk["id"], "LEFT", "Nisha")
    before = directory(api_client, leader)
    before_counts = counts(api_client, leader)

    for _ in range(3):
        get_plan(api_client, leader, jd["id"])
        get_plan(api_client, leader, jd["id"], promote=ravi["id"])
        get_plan(api_client, leader, jd["id"], promote=rk["id"])

    after = directory(api_client, leader)
    assert [item["id"] for item in after] == [item["id"] for item in before]
    assert [item["placement_position"] for item in after] == [
        item["placement_position"] for item in before
    ]
    assert counts(api_client, leader) == before_counts
    assert read(api_client, leader, jd["id"]).status_code == 200
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_both_promotion_choices_can_be_previewed_before_choosing(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Looking at one option does not commit the leader to it."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]

    promoting_ravi = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    promoting_rk = get_plan(api_client, leader, jd["id"], promote=rk["id"])

    assert promoting_ravi["reattachment"]["member"]["id"] == rk["id"]
    assert promoting_rk["reattachment"]["member"]["id"] == ravi["id"]
    # Different plans, so different fingerprints: one cannot confirm the other.
    assert promoting_ravi["plan_token"] != promoting_rk["plan_token"]


def test_a_token_for_one_choice_cannot_confirm_the_other(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    response = confirm(api_client, leader, jd["id"], token=token, promote=rk["id"])

    assert response.status_code == 409
    assert error_code(response) == "reorganization_preview_stale"
    assert read(api_client, leader, jd["id"]).status_code == 200


def test_a_token_from_before_a_choice_cannot_confirm_a_promotion(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """The leader has to have seen where the subtree is going."""
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    undecided = get_plan(api_client, leader, jd["id"])

    response = confirm(
        api_client, leader, jd["id"], token=undecided["plan_token"], promote=ravi["id"]
    )

    assert response.status_code == 409
    assert error_code(response) == "reorganization_preview_stale"


# --- stale previews ----------------------------------------------------------------------


def test_a_registration_into_the_destination_makes_the_preview_stale(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """The case this protection exists for: the destination filled up in the meantime."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    assert previewed["reattachment"]["destination_position"] == "LEFT"

    # Someone registers into exactly that position.
    newcomer = create(api_client, leader, ravi["id"], "LEFT", "Kiran")

    response = confirm(
        api_client, leader, jd["id"], token=previewed["plan_token"], promote=ravi["id"]
    )

    assert response.status_code == 409
    assert error_code(response) == "reorganization_preview_stale"
    # Nothing was written: the newcomer kept the slot and Jd is still there.
    assert child_id(api_client, leader, ravi["id"], "LEFT") == newcomer["id"]
    assert read(api_client, leader, jd["id"]).status_code == 200
    assert member(api_client, leader, rk["id"])["placement_parent"]["id"] == jd["id"]
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_a_fresh_preview_after_a_stale_one_succeeds(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """Being refused is a prompt to look again, not a dead end."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    stale = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]
    create(api_client, leader, ravi["id"], "LEFT", "Kiran")

    assert confirm(api_client, leader, jd["id"], token=stale, promote=ravi["id"]).status_code == 409

    refreshed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    assert refreshed["reattachment"]["destination_position"] == "RIGHT"
    assert (
        confirm(
            api_client, leader, jd["id"], token=refreshed["plan_token"], promote=ravi["id"]
        ).status_code
        == 200
    )
    assert child_id(api_client, leader, ravi["id"], "RIGHT") == rk["id"]


def test_a_new_second_child_makes_a_single_child_preview_stale(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A member who had one child now has two, so the plan is a different operation."""
    jd = create(api_client, leader, root_id, "LEFT", "Jd")
    ravi = create(api_client, leader, jd["id"], "LEFT", "Ravi")
    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])
    assert previewed["reattachment"] is None

    rk = create(api_client, leader, jd["id"], "RIGHT", "Rk")

    response = confirm(
        api_client, leader, jd["id"], token=previewed["plan_token"], promote=ravi["id"]
    )

    assert response.status_code == 409
    assert error_code(response) == "reorganization_preview_stale"
    assert member(api_client, leader, rk["id"])["placement_parent"]["id"] == jd["id"]


def test_a_made_up_token_cannot_confirm_anything(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]

    response = confirm(api_client, leader, jd["id"], token="f" * 64, promote=ravi["id"])

    assert response.status_code == 409
    assert error_code(response) == "reorganization_preview_stale"
    assert read(api_client, leader, jd["id"]).status_code == 200


def test_an_unusable_token_is_rejected_by_the_schema(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]

    assert confirm(api_client, leader, jd["id"], token="", promote=ravi["id"]).status_code == 422
    short = confirm(api_client, leader, jd["id"], token="abc", promote=ravi["id"])
    assert short.status_code == 422


def test_renaming_a_member_does_not_invalidate_a_plan(
    api_client: TestClient, leader: Leader, two_child_tree: dict
) -> None:
    """The fingerprint covers structure, not personal details."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    renamed = api_client.patch(
        f"{MEMBERS}/{rk['id']}", json={"name": "Rk Kumar"}, headers=leader.headers
    )
    assert renamed.status_code == 200, renamed.text

    response = confirm(api_client, leader, jd["id"], token=token, promote=ravi["id"])
    assert response.status_code == 200, response.text
    assert member(api_client, leader, rk["id"])["name"] == "Rk Kumar"


# --- repeated and failed attempts --------------------------------------------------------


def test_confirming_twice_deletes_once(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """A double tap, or a retry after a dropped response, cannot move anybody twice."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    first = confirm(api_client, leader, jd["id"], token=previewed["plan_token"], promote=ravi["id"])
    assert first.status_code == 200, first.text

    second = confirm(
        api_client, leader, jd["id"], token=previewed["plan_token"], promote=ravi["id"]
    )

    assert second.status_code == 404
    assert error_code(second) == "member_not_found"
    # Rk moved once, and is still where the first confirmation put them.
    assert child_id(api_client, leader, ravi["id"], "LEFT") == rk["id"]
    assert counts(api_client, leader)["total_members"] == 3
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_a_failure_while_reorganizing_rolls_everything_back(
    api_client: TestClient,
    leader: Leader,
    monkeypatch: pytest.MonkeyPatch,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """A database error after the writes must leave no trace of them.

    The promotion and the reattachment are already written when this fails, so this is
    the case that would otherwise leave a half-reorganized tree.
    """
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    below_rk = create(api_client, leader, rk["id"], "LEFT", "Nisha")
    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    def explode(*_args: object, **_kwargs: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection lost"))

    monkeypatch.setattr("app.services.placement_service._verify", explode)

    response = confirm(
        api_client, leader, jd["id"], token=previewed["plan_token"], promote=ravi["id"]
    )

    assert response.status_code == 503
    # Every relationship is exactly as it was before the attempt.
    assert read(api_client, leader, jd["id"]).status_code == 200
    assert child_id(api_client, leader, jd["id"], "LEFT") == ravi["id"]
    assert child_id(api_client, leader, jd["id"], "RIGHT") == rk["id"]
    assert child_id(api_client, leader, rk["id"], "LEFT") == below_rk["id"]
    assert children(api_client, leader, ravi["id"])["left"] is None
    assert counts(api_client, leader)["total_members"] == 5
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_a_result_that_would_not_be_a_tree_is_refused(
    api_client: TestClient,
    leader: Leader,
    monkeypatch: pytest.MonkeyPatch,
    two_child_tree: dict,
) -> None:
    """The invariant check is load-bearing: when it objects, nothing is committed."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    previewed = get_plan(api_client, leader, jd["id"], promote=ravi["id"])

    monkeypatch.setattr(
        "app.repositories.member_repository.has_duplicate_slots", lambda *_a, **_k: True
    )

    response = confirm(
        api_client, leader, jd["id"], token=previewed["plan_token"], promote=ravi["id"]
    )

    assert response.status_code == 409
    assert error_code(response) == "reorganization_conflict"
    assert read(api_client, leader, jd["id"]).status_code == 200
    assert child_id(api_client, leader, jd["id"], "RIGHT") == rk["id"]


def test_an_unknown_member_has_no_plan_and_cannot_be_confirmed(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    missing = str(uuid.uuid4())

    assert plan(api_client, leader, missing).status_code == 404
    unknown = confirm(api_client, leader, missing, token="f" * 64)
    assert unknown.status_code == 404
    assert error_code(unknown) == "member_not_found"


def test_a_malformed_member_id_is_rejected(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    assert plan(api_client, leader, "not-a-uuid").status_code == 422
    assert confirm(api_client, leader, "not-a-uuid", token="f" * 64).status_code == 422


# --- locking and concurrency -------------------------------------------------------------


def _team_for(session: Session, leader: Leader):
    team = team_repository.get_by_clerk_user_id(session, leader.clerk_user_id)
    assert team is not None
    return team


def test_the_structural_lock_is_exclusive(
    api_client: TestClient, leader: Leader, session_factory, team_id: uuid.UUID, team: dict
) -> None:
    """Two transactions cannot hold a team's structural lock at the same time."""
    with session_factory() as holder, session_factory() as other:
        team_repository.lock_structure(holder, team_id)

        with pytest.raises(OperationalError):
            other.execute(
                text("SELECT 1 FROM teams WHERE id = :id FOR UPDATE NOWAIT"), {"id": team_id}
            )


def test_registering_a_member_waits_for_the_structural_lock(
    api_client: TestClient, leader: Leader, session_factory, team_id: uuid.UUID, root_id: str
) -> None:
    """A registration cannot slip into a slot while a reorganization is in progress.

    The reorganization is represented by a transaction holding the team's structural
    lock, which is the first thing it takes. The registration is given a short lock
    timeout so the test can prove it blocks rather than proceeding.
    """
    with session_factory() as holder, session_factory() as registrar:
        team_repository.lock_structure(holder, team_id)

        registrar.execute(text("SET LOCAL lock_timeout = '400ms'"))
        with pytest.raises(OperationalError):
            member_service.create_member(
                registrar,
                _team_for(registrar, leader),
                MemberCreate(
                    name="Kiran",
                    placement_parent_id=uuid.UUID(root_id),
                    placement_position="RIGHT",
                    mi_lifestyle_id=next_mi_lifestyle_id(),
                ),
            )

    # The slot is still free: nothing was written while the lock was held.
    assert children(api_client, leader, root_id)["right"] is None


def test_a_reorganization_waits_for_the_structural_lock(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """And the other way round: a registration in progress holds a reorganization off."""
    from app.schemas.placement import MemberDeletionConfirm
    from app.services import placement_service

    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    with session_factory() as holder, session_factory() as reorganizer:
        team_repository.lock_structure(holder, team_id)

        reorganizer.execute(text("SET LOCAL lock_timeout = '400ms'"))
        with pytest.raises(OperationalError):
            placement_service.delete_with_reorganization(
                reorganizer,
                _team_for(reorganizer, leader),
                uuid.UUID(jd["id"]),
                MemberDeletionConfirm(promote_member_id=uuid.UUID(ravi["id"]), plan_token=token),
            )

    assert read(api_client, leader, jd["id"]).status_code == 200


def test_concurrent_confirmations_delete_at_most_one_member(
    api_client: TestClient,
    leader: Leader,
    db_settings,
    verifier,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """Two devices confirming the same plan at once: one wins, the tree stays sound."""
    from app.main import create_app

    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    create(api_client, leader, rk["id"], "LEFT", "Nisha")
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    results: list[int] = []
    lock = threading.Lock()

    def attempt() -> None:
        # Its own app, and so its own connection pool: two genuinely separate callers.
        with TestClient(
            create_app(db_settings, token_verifier=verifier), raise_server_exceptions=False
        ) as client:
            response = client.post(
                f"{MEMBERS}/{jd['id']}/deletion",
                json={"plan_token": token, "promote_member_id": ravi["id"]},
                headers=leader.headers,
            )
        with lock:
            results.append(response.status_code)

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert results.count(200) == 1, results
    # The loser either found the member gone or was refused as stale. Never a 500.
    assert all(status in (200, 404, 409) for status in results), results
    assert read(api_client, leader, jd["id"]).status_code == 404
    assert child_id(api_client, leader, ravi["id"], "LEFT") == rk["id"]
    assert counts(api_client, leader)["total_members"] == 4
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_registrations_during_reorganizations_keep_the_tree_sound(
    api_client: TestClient,
    leader: Leader,
    db_settings,
    verifier,
    session_factory,
    team_id: uuid.UUID,
    root_id: str,
) -> None:
    """Members arriving while branches are being reorganized cannot corrupt placement."""
    from app.main import create_app

    # A small tree with several members that can be reorganized away.
    jd = create(api_client, leader, root_id, "LEFT", "Jd")
    ravi = create(api_client, leader, jd["id"], "LEFT", "Ravi")
    rk = create(api_client, leader, jd["id"], "RIGHT", "Rk")
    create(api_client, leader, ravi["id"], "LEFT", "Kiran")
    create(api_client, leader, rk["id"], "RIGHT", "Vikram")

    errors: list[str] = []
    lock = threading.Lock()

    def worker(action: str) -> None:
        with TestClient(
            create_app(db_settings, token_verifier=verifier), raise_server_exceptions=False
        ) as client:
            try:
                if action == "register":
                    for side in ("LEFT", "RIGHT"):
                        client.post(
                            MEMBERS,
                            json={
                                "name": f"Arrival {side}",
                                "placement_parent_id": rk["id"],
                                "placement_position": side,
                                "mi_lifestyle_id": next_mi_lifestyle_id(),
                            },
                            headers=leader.headers,
                        )
                else:
                    previewed = client.get(
                        f"{MEMBERS}/{jd['id']}/deletion-plan?promote={ravi['id']}",
                        headers=leader.headers,
                    )
                    if previewed.status_code == 200:
                        client.post(
                            f"{MEMBERS}/{jd['id']}/deletion",
                            json={
                                "plan_token": previewed.json()["plan_token"],
                                "promote_member_id": ravi["id"],
                            },
                            headers=leader.headers,
                        )
            except Exception as error:  # pragma: no cover - reported, not swallowed
                with lock:
                    errors.append(f"{action}: {error}")

    threads = [
        threading.Thread(target=worker, args=(action,))
        for action in ("register", "reorganize", "register")
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert errors == []
    # Whatever order they landed in, the result is still one sound tree.
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


# --- members registered before the Mi Lifestyle ID rules ---------------------------------
#
# Migration 0005 added both identifier rules NOT VALID: they govern every insert and
# update from that point, while the rows already stored keep whatever they had. Those
# rows are real — the development team has two — and moving one is an UPDATE, which
# PostgreSQL re-checks against the *whole* new row. A member with no identifier therefore
# cannot be repositioned at all, however little the operation touches their identifier.


def make_legacy_member(session: Session, member_id: str, *, identifier: str | None) -> None:
    """Give a member an identifier that predates the rules, the way migration 0005 left them.

    The constraint is dropped and re-added NOT VALID around the write, which is exactly
    what the migration did: the row ends up stored and readable while failing a rule
    that now applies to every future write.
    """
    session.execute(
        text("ALTER TABLE members DROP CONSTRAINT ck_members_member_has_mi_lifestyle_id")
    )
    session.execute(
        text("ALTER TABLE members DROP CONSTRAINT ck_members_mi_lifestyle_id_is_ten_digits")
    )
    session.execute(
        text("UPDATE members SET mi_lifestyle_id = :value WHERE id = :id"),
        {"value": identifier, "id": uuid.UUID(member_id)},
    )
    session.execute(
        text(
            "ALTER TABLE members ADD CONSTRAINT ck_members_member_has_mi_lifestyle_id "
            "CHECK (is_root OR mi_lifestyle_id IS NOT NULL) NOT VALID"
        )
    )
    session.execute(
        text(
            "ALTER TABLE members ADD CONSTRAINT ck_members_mi_lifestyle_id_is_ten_digits "
            "CHECK (mi_lifestyle_id IS NULL OR mi_lifestyle_id ~ '^[0-9]{10}$') NOT VALID"
        )
    )
    session.commit()


def test_a_member_without_an_identifier_cannot_be_promoted(
    api_client: TestClient, leader: Leader, session_factory, two_child_tree: dict
) -> None:
    """The reported failure, reproduced: Jd, with Ravi LEFT and Rk RIGHT.

    Ravi was registered before the identifier rules and holds no Mi Lifestyle ID.
    Promoting Ravi is an update of Ravi's row, which the database refuses — so the
    preview has to say so rather than describe a reorganization that cannot happen.
    """
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    with session_factory() as session:
        make_legacy_member(session, ravi["id"], identifier=None)

    response = plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_identifier_missing"
    # Says who, so the leader knows whose profile to open.
    assert response.json()["error"]["details"]["member_name"] == "Ravi"
    assert response.json()["error"]["details"]["member_id"] == ravi["id"]
    # Nothing was touched.
    assert read(api_client, leader, jd["id"]).status_code == 200
    assert child_id(api_client, leader, jd["id"], "LEFT") == ravi["id"]
    assert child_id(api_client, leader, jd["id"], "RIGHT") == rk["id"]


def test_a_member_without_an_identifier_cannot_be_reattached_either(
    api_client: TestClient, leader: Leader, session_factory, two_child_tree: dict
) -> None:
    """Choosing the other child does not route around it: both members are written."""
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    with session_factory() as session:
        make_legacy_member(session, ravi["id"], identifier=None)

    response = plan(api_client, leader, jd["id"], promote=rk["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_identifier_missing"
    assert response.json()["error"]["details"]["member_name"] == "Ravi"


def test_an_identifier_that_breaks_the_ten_digit_rule_also_blocks_a_move(
    api_client: TestClient, leader: Leader, session_factory, two_child_tree: dict
) -> None:
    """Not only a missing one: a stored identifier the rule would now refuse blocks it too."""
    jd, ravi = two_child_tree["jd"], two_child_tree["ravi"]
    with session_factory() as session:
        make_legacy_member(session, ravi["id"], identifier="ML-0042")

    response = plan(api_client, leader, jd["id"], promote=ravi["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_identifier_missing"


def test_confirming_is_refused_for_the_same_reason_and_writes_nothing(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """A plan taken before the identifier was cleared cannot be confirmed afterwards.

    This is the path the device hit: the preview succeeded, the identifier problem was
    only discovered by the database half-way through the transaction. Now it is refused
    with the same specific code, and the team is untouched.
    """
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    token = get_plan(api_client, leader, jd["id"], promote=ravi["id"])["plan_token"]

    with session_factory() as session:
        make_legacy_member(session, ravi["id"], identifier=None)

    response = confirm(api_client, leader, jd["id"], token=token, promote=ravi["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_identifier_missing"
    assert read(api_client, leader, jd["id"]).status_code == 200
    assert child_id(api_client, leader, jd["id"], "LEFT") == ravi["id"]
    assert child_id(api_client, leader, jd["id"], "RIGHT") == rk["id"]
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_adding_the_identifier_unblocks_the_reorganization(
    api_client: TestClient,
    leader: Leader,
    session_factory,
    team_id: uuid.UUID,
    two_child_tree: dict,
) -> None:
    """The refusal is a blocked state with a way out, and the way out is the one named.

    End to end on the exact reported structure: Jd with Ravi on the LEFT and Rk on the
    RIGHT, Ravi promoted, Rk reattached breadth-first.
    """
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]
    hu = create(api_client, leader, ravi["id"], "LEFT", "Hu")
    with session_factory() as session:
        make_legacy_member(session, ravi["id"], identifier=None)

    assert plan(api_client, leader, jd["id"], promote=ravi["id"]).status_code == 409

    # Exactly what the message asks for: open their profile and add the identifier.
    fixed = api_client.patch(
        f"{MEMBERS}/{ravi['id']}",
        json={"mi_lifestyle_id": next_mi_lifestyle_id()},
        headers=leader.headers,
    )
    assert fixed.status_code == 200, fixed.text

    reorganize(api_client, leader, jd["id"], promote=ravi["id"])

    # Ravi took Jd's position; Rk went to Ravi's RIGHT, because Hu holds the LEFT.
    assert (
        member(api_client, leader, ravi["id"])["placement_parent"]["id"]
        == (jd["placement_parent"]["id"])
    )
    assert member(api_client, leader, ravi["id"])["placement_position"] == "LEFT"
    assert child_id(api_client, leader, ravi["id"], "LEFT") == hu["id"]
    assert child_id(api_client, leader, ravi["id"], "RIGHT") == rk["id"]
    assert read(api_client, leader, jd["id"]).status_code == 404
    with session_factory() as session:
        assert_tree_is_sound(session, team_id)


def test_a_member_with_no_children_is_removed_despite_a_legacy_identifier(
    api_client: TestClient, leader: Leader, session_factory, root_id: str
) -> None:
    """Deleting writes nothing to the member, so the identifier rules never apply."""
    only = create(api_client, leader, root_id, "LEFT", "Palanivel")
    with session_factory() as session:
        make_legacy_member(session, only["id"], identifier=None)

    reorganize(api_client, leader, only["id"])

    assert read(api_client, leader, only["id"]).status_code == 404


# --- confirming the way the app does it ---------------------------------------------------


def confirm_as_the_app_does(client: TestClient, leader: Leader, member_id: str, promote=None):
    """Preview, then send back exactly what the app sends back.

    The app names the promotion from the plan's own `promoted` member rather than from
    whatever the leader tapped, because a member with one child below them is never
    tapped: the backend fills the choice in and the screen goes straight to the review.
    These tests go through the same shape so that a mismatch between the two is caught
    here rather than on a device.
    """
    previewed = get_plan(client, leader, member_id, promote)
    promoted = previewed["promoted"]
    return confirm(
        client,
        leader,
        member_id,
        token=previewed["plan_token"],
        promote=promoted["id"] if promoted else None,
    )


def test_a_member_with_one_child_can_be_confirmed_the_way_the_app_sends_it(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The second failure from the device log: one child, and nothing to choose.

    The plan names the only candidate, so the confirmation must name them too. Sending
    no promotion was refused as `invalid_promotion_choice`, which made a member with one
    member below them impossible to delete from the app.
    """
    parent = create(api_client, leader, root_id, "LEFT", "Jd")
    only_child = create(api_client, leader, parent["id"], "LEFT", "Ravi")

    response = confirm_as_the_app_does(api_client, leader, parent["id"])

    assert response.status_code == 200, response.text
    assert read(api_client, leader, parent["id"]).status_code == 404
    assert child_id(api_client, leader, root_id, "LEFT") == only_child["id"]


def test_a_member_with_two_children_can_be_confirmed_the_way_the_app_sends_it(
    api_client: TestClient, leader: Leader, root_id: str, two_child_tree: dict
) -> None:
    jd, ravi, rk = two_child_tree["jd"], two_child_tree["ravi"], two_child_tree["rk"]

    response = confirm_as_the_app_does(api_client, leader, jd["id"], promote=ravi["id"])

    assert response.status_code == 200, response.text
    assert child_id(api_client, leader, root_id, "LEFT") == ravi["id"]
    assert child_id(api_client, leader, ravi["id"], "LEFT") == rk["id"]


def test_a_member_with_no_children_can_be_confirmed_the_way_the_app_sends_it(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    only = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = confirm_as_the_app_does(api_client, leader, only["id"])

    assert response.status_code == 200, response.text
    assert read(api_client, leader, only["id"]).status_code == 404


# --- larger trees ------------------------------------------------------------------------


def build_complete_tree(
    client: TestClient, leader: Leader, root_id: str, side: str, levels: int
) -> list[list[str]]:
    """A complete binary tree under one side of the root, returned level by level."""
    top = create(client, leader, root_id, side, "Level0")
    tree = [[top["id"]]]
    for level in range(1, levels):
        row: list[str] = []
        for index, parent in enumerate(tree[-1]):
            for position in ("LEFT", "RIGHT"):
                child = create(client, leader, parent, position, f"L{level}-{index}{position[0]}")
                row.append(child["id"])
        tree.append(row)
    return tree


def test_a_full_branch_sends_the_subtree_to_the_first_opening_on_the_next_level(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """31 members, complete to five levels: the answer is the leftmost slot below them.

    With every slot above it taken, breadth-first LEFT-first has exactly one answer —
    the LEFT slot of the leftmost member on the deepest level — and the preview has to
    name it before anything moves.
    """
    tree = build_complete_tree(api_client, leader, root_id, "LEFT", 5)
    promoted = tree[0][0]
    # The member who will be moved, placed on the root's other side so the full branch
    # above is untouched.
    moved = create(api_client, leader, root_id, "RIGHT", "Mover")

    # Re-home the mover under the member to be deleted, so the tree matches the case:
    # root -> target -> (full branch, mover).
    previewed = get_plan(api_client, leader, promoted)
    assert previewed["promotable"]  # the branch is there

    # The target is the top of the full branch; promote its LEFT child and reattach the
    # RIGHT one, which is the deepest-search case.
    target = promoted
    left_child, right_child = (candidate["id"] for candidate in previewed["promotable"])
    plan_for_left = get_plan(api_client, leader, target, promote=left_child)
    destination = plan_for_left["reattachment"]["destination"]

    # The promoted child's branch is complete to the bottom level, so every member
    # above it is full and the first opening is the LEFT slot of its leftmost leaf.
    expected = tree[4][0]
    assert destination["id"] == expected
    assert plan_for_left["reattachment"]["destination_position"] == "LEFT"
    # Four members on the way down: the promoted member and one per level below it.
    path = plan_for_left["reattachment"]["destination_path"]
    assert [step["id"] for step in path] == [tree[1][0], tree[2][0], tree[3][0], tree[4][0]]

    reorganize(api_client, leader, target, promote=left_child)
    assert child_id(api_client, leader, expected, "LEFT") == right_child
    assert read(api_client, leader, moved["id"]).status_code == 200


def test_a_large_tree_is_searched_level_by_level_not_member_by_member(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The cost of a preview tracks the depth of the branch, not its size.

    A complete branch of 31 members is searched with a handful of queries: one per
    level, plus the few reads the plan itself needs. A per-member search would be an
    order of magnitude more.
    """
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    tree = build_complete_tree(api_client, leader, root_id, "LEFT", 5)
    target = tree[0][0]
    left_child = tree[1][0]

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        previewed = get_plan(api_client, leader, target, promote=left_child)
    finally:
        event.remove(Engine, "before_cursor_execute", record)

    assert previewed["reattachment"]["destination"]["id"] == tree[4][0]
    # The promoted member's branch holds 15 members over four levels. A level-by-level
    # search needs four queries for it; a member-by-member one would need fifteen.
    assert len(statements) < 20, f"{len(statements)} statements for a 15-member search"


def test_a_long_thin_branch_is_searched_in_one_step(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A chain has a free slot at the top, so depth costs nothing."""
    target = create(api_client, leader, root_id, "LEFT", "Target")
    chain_top = create(api_client, leader, target["id"], "LEFT", "Chain0")
    moved = create(api_client, leader, target["id"], "RIGHT", "Mover")

    parent = chain_top["id"]
    for level in range(1, 25):
        parent = create(api_client, leader, parent, "LEFT", f"Chain{level}")["id"]

    previewed = get_plan(api_client, leader, target["id"], promote=chain_top["id"])

    # The chain only ever fills its LEFT slots, so the top member's RIGHT is free.
    assert previewed["reattachment"]["destination"]["id"] == chain_top["id"]
    assert previewed["reattachment"]["destination_position"] == "RIGHT"

    reorganize(api_client, leader, target["id"], promote=chain_top["id"])
    assert child_id(api_client, leader, chain_top["id"], "RIGHT") == moved["id"]
    assert member(api_client, leader, chain_top["id"])["placement_parent"]["id"] == root_id
