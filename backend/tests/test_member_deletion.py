"""Deleting a member through DELETE /api/v1/members/{id}.

The operation is deliberately narrow: one eligible member, never a branch. These tests
are mostly about what it refuses — the leader's own record, a member with anyone below
them, a member another record names as sponsor, and anything in another leader's team —
and about leaving the database exactly as it was whenever it refuses.
"""

import base64
import struct
import uuid
import zlib

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


def delete(client: TestClient, leader: Leader, member_id: str):
    return client.delete(f"{MEMBERS}/{member_id}", headers=leader.headers)


def read(client: TestClient, leader: Leader, member_id: str):
    return client.get(f"{MEMBERS}/{member_id}", headers=leader.headers)


def children(client: TestClient, leader: Leader, member_id: str) -> dict:
    response = client.get(f"{MEMBERS}/{member_id}/children", headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()


def directory(client: TestClient, leader: Leader) -> list[dict]:
    response = client.get(MEMBERS, headers=leader.headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]


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


# --- the one case that succeeds ----------------------------------------------------------


def test_a_leader_can_delete_an_eligible_member_of_their_own_team(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = delete(api_client, leader, member["id"])

    assert response.status_code == 204, response.text
    assert response.content == b""
    assert read(api_client, leader, member["id"]).status_code == 404


def test_a_deleted_member_frees_their_placement_slot(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The position becomes available again, and can be filled by someone else."""
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    assert delete(api_client, leader, member["id"]).status_code == 204

    assert children(api_client, leader, root_id)["left"] is None
    replacement = create(api_client, leader, root_id, "LEFT", "Meena")
    assert children(api_client, leader, root_id)["left"]["id"] == replacement["id"]


def test_deleting_one_member_leaves_every_other_relationship_intact(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    left = create(api_client, leader, root_id, "LEFT", "Palanivel")
    right = create(api_client, leader, root_id, "RIGHT", "Meena")
    below_right = create(api_client, leader, right["id"], "LEFT", "Kiran")

    assert delete(api_client, leader, left["id"]).status_code == 204

    # The other side of the root, and everything under it, is untouched.
    slots = children(api_client, leader, root_id)
    assert slots["left"] is None
    assert slots["right"]["id"] == right["id"]
    assert children(api_client, leader, right["id"])["left"]["id"] == below_right["id"]

    remaining = {item["id"] for item in directory(api_client, leader)}
    assert remaining == {root_id, right["id"], below_right["id"]}


def test_a_deleted_member_no_longer_appears_in_recently_added(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    assert delete(api_client, leader, member["id"]).status_code == 204

    recent = api_client.get(f"{MEMBERS}/recent", headers=leader.headers)
    assert recent.status_code == 200, recent.text
    assert all(entry["id"] != member["id"] for entry in recent.json())


# --- refusals ----------------------------------------------------------------------------


def test_the_root_member_cannot_be_deleted(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = delete(api_client, leader, root_id)

    assert response.status_code == 409
    assert error_code(response) == "root_member_undeletable"
    # Still there, and still the leader.
    assert read(api_client, leader, root_id).json()["is_root"] is True


def test_a_member_with_a_member_below_them_cannot_be_deleted(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    parent = create(api_client, leader, root_id, "LEFT", "Palanivel")
    child = create(api_client, leader, parent["id"], "RIGHT", "Kiran")

    response = delete(api_client, leader, parent["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_has_children"
    # Neither the parent nor the member below them was touched.
    assert read(api_client, leader, parent["id"]).status_code == 200
    assert read(api_client, leader, child["id"]).status_code == 200


def test_a_member_recorded_as_someone_elses_sponsor_cannot_be_deleted(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Sponsorship is independent of placement, so a leaf can still be referenced.

    `sponsor_id` has no cascade, so removing this member would either break the other
    record or silently discard the relationship. It is refused instead.
    """
    sponsor = create(api_client, leader, root_id, "LEFT", "Palanivel")
    sponsored = create(api_client, leader, root_id, "RIGHT", "Meena", sponsor_id=sponsor["id"])

    response = delete(api_client, leader, sponsor["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_sponsors_others"
    assert read(api_client, leader, sponsor["id"]).status_code == 200
    assert read(api_client, leader, sponsored["id"]).json()["sponsor"]["id"] == sponsor["id"]


def test_a_sponsor_becomes_deletable_once_the_relationship_is_cleared(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The refusal is a blocked state, not a permanent one."""
    sponsor = create(api_client, leader, root_id, "LEFT", "Palanivel")
    sponsored = create(api_client, leader, root_id, "RIGHT", "Meena", sponsor_id=sponsor["id"])

    assert delete(api_client, leader, sponsor["id"]).status_code == 409

    cleared = api_client.patch(
        f"{MEMBERS}/{sponsored['id']}", json={"sponsor_id": None}, headers=leader.headers
    )
    assert cleared.status_code == 200, cleared.text

    assert delete(api_client, leader, sponsor["id"]).status_code == 204


def test_an_unknown_member_is_a_404(api_client: TestClient, leader: Leader, team: dict) -> None:
    response = delete(api_client, leader, str(uuid.uuid4()))

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"


def test_a_malformed_member_id_is_rejected(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    assert delete(api_client, leader, "not-a-uuid").status_code == 422


# --- authentication and team isolation ---------------------------------------------------


def test_an_unauthenticated_delete_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = api_client.delete(f"{MEMBERS}/{member['id']}")

    assert response.status_code == 401
    # And the member is still there.
    assert read(api_client, leader, member["id"]).status_code == 200


def test_a_leader_cannot_delete_another_leaders_member(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    """Another team's member reads exactly as one that does not exist."""
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    response = delete(api_client, other_leader, member["id"])

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"
    # Untouched in its own team.
    assert read(api_client, leader, member["id"]).status_code == 200


def test_a_leader_cannot_delete_another_leaders_root_member(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    """A 404, not the 409 the owner would get: the member is simply not theirs to see."""
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)

    response = delete(api_client, other_leader, root_id)

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"


# --- related data -------------------------------------------------------------------------


def test_a_deleted_members_photo_goes_with_them(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """`member_photos` cascades from the member: a photo has no meaning without one."""
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")
    uploaded = api_client.put(
        f"{MEMBERS}/{member['id']}/photo",
        json={"content_type": "image/png", "data": base64.b64encode(png()).decode("ascii")},
        headers=leader.headers,
    )
    assert uploaded.status_code == 200, uploaded.text

    assert delete(api_client, leader, member["id"]).status_code == 204

    # The member is gone, so their photo is too — and asking is a 404, not a 500.
    photo = api_client.get(f"{MEMBERS}/{member['id']}/photo", headers=leader.headers)
    assert photo.status_code == 404


def test_the_leaders_own_photo_survives_a_deletion_elsewhere(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    uploaded = api_client.put(
        f"{MEMBERS}/{root_id}/photo",
        json={"content_type": "image/png", "data": base64.b64encode(png()).decode("ascii")},
        headers=leader.headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    assert delete(api_client, leader, member["id"]).status_code == 204

    assert api_client.get(f"{MEMBERS}/{root_id}/photo", headers=leader.headers).status_code == 200


# --- repeated and concurrent attempts ------------------------------------------------------


def test_deleting_the_same_member_twice_is_a_404_the_second_time(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """What a double-tap, or a retry after a dropped response, actually produces.

    The first delete wins and the second finds nothing — never a 500, and never a second
    member removed.
    """
    member = create(api_client, leader, root_id, "LEFT", "Palanivel")

    assert delete(api_client, leader, member["id"]).status_code == 204

    second = delete(api_client, leader, member["id"])
    assert second.status_code == 404
    assert error_code(second) == "member_not_found"


def test_a_refused_deletion_changes_nothing_at_all(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Every refusal path leaves the team exactly as it was."""
    parent = create(api_client, leader, root_id, "LEFT", "Palanivel")
    child = create(api_client, leader, parent["id"], "LEFT", "Kiran")
    before = directory(api_client, leader)

    assert delete(api_client, leader, root_id).status_code == 409
    assert delete(api_client, leader, parent["id"]).status_code == 409
    assert delete(api_client, leader, str(uuid.uuid4())).status_code == 404

    after = directory(api_client, leader)
    assert [item["id"] for item in after] == [item["id"] for item in before]
    assert children(api_client, leader, parent["id"])["left"]["id"] == child["id"]


def test_a_member_added_under_a_parent_blocks_that_parents_deletion(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """The check reads live state rather than anything cached from an earlier request.

    `create_member` locks the placement parent and `delete_member` locks the member
    itself, so a registration and a deletion aimed at the same row are serialized by the
    database instead of interleaving.
    """
    parent = create(api_client, leader, root_id, "LEFT", "Palanivel")
    # Deletable at this point — but nobody deletes it, and then a member arrives.
    create(api_client, leader, parent["id"], "RIGHT", "Kiran")

    response = delete(api_client, leader, parent["id"])

    assert response.status_code == 409
    assert error_code(response) == "member_has_children"
