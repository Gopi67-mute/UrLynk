"""Phase 5.1: profile photos stored in PostgreSQL and served back as data URIs.

The photo is an UrLynk value on the member record, not the Clerk account image, so it
is the one photo the app shows wherever the leader appears. These tests cover the round
trip, the limits that keep an avatar an avatar, and team isolation.
"""

import base64
import os
import struct
import uuid
import zlib

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"
MAX_PHOTO_BYTES = 64 * 1024


def png(width: int = 1, height: int = 1, *, noisy: bool = False) -> bytes:
    """A real, valid PNG. `noisy` fills it with random pixels so it cannot compress."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    row = os.urandom(3 * width) if noisy else b"\xff\x00\x00" * width
    raw = b"".join(b"\x00" + (os.urandom(3 * width) if noisy else row) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 0 if noisy else 9))
        + chunk(b"IEND", b"")
    )


def encode(image: bytes) -> str:
    return base64.b64encode(image).decode("ascii")


@pytest.fixture
def team(api_client: TestClient, leader: Leader) -> dict:
    return api_client.post(
        INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers
    ).json()


@pytest.fixture
def root_id(team: dict) -> str:
    return team["root_member"]["id"]


def put_photo(client: TestClient, leader: Leader, member_id: str, body: dict):
    return client.put(f"{MEMBERS}/{member_id}/photo", json=body, headers=leader.headers)


def put_png(client: TestClient, leader: Leader, member_id: str, image: bytes | None = None):
    return put_photo(
        client,
        leader,
        member_id,
        {"content_type": "image/png", "data": encode(image if image is not None else png())},
    )


def get_photo(client: TestClient, leader: Leader, member_id: str):
    return client.get(f"{MEMBERS}/{member_id}/photo", headers=leader.headers)


def error_code(response) -> str:
    return response.json()["error"]["code"]


# --- the round trip ---------------------------------------------------------------------


def test_a_photo_can_be_saved_and_read_back(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    image = png(4, 4)

    saved = put_png(api_client, leader, root_id, image)
    assert saved.status_code == 200, saved.text

    read = get_photo(api_client, leader, root_id)
    assert read.status_code == 200
    body = read.json()
    assert body["member_id"] == root_id
    assert body["content_type"] == "image/png"
    assert body["data_uri"].startswith("data:image/png;base64,")
    # Byte-for-byte what was uploaded, not a re-encoding of it.
    assert base64.b64decode(body["data_uri"].split(",", 1)[1]) == image


def test_a_member_starts_with_no_photo(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = get_photo(api_client, leader, root_id)

    assert response.status_code == 404
    # Its own code, so the app draws initials instead of reporting a failure.
    assert error_code(response) == "photo_not_found"


def test_a_photo_can_be_replaced(api_client: TestClient, leader: Leader, root_id: str) -> None:
    put_png(api_client, leader, root_id, png(2, 2))
    first = get_photo(api_client, leader, root_id).json()

    replacement = png(8, 8)
    put_png(api_client, leader, root_id, replacement)

    body = get_photo(api_client, leader, root_id).json()
    assert base64.b64decode(body["data_uri"].split(",", 1)[1]) == replacement
    assert body["updated_at"] >= first["updated_at"]


def test_a_photo_can_be_removed(api_client: TestClient, leader: Leader, root_id: str) -> None:
    put_png(api_client, leader, root_id)

    removed = api_client.delete(f"{MEMBERS}/{root_id}/photo", headers=leader.headers)

    assert removed.status_code == 204
    assert get_photo(api_client, leader, root_id).status_code == 404


def test_removing_a_photo_that_is_not_there_is_not_an_error(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = api_client.delete(f"{MEMBERS}/{root_id}/photo", headers=leader.headers)

    assert response.status_code == 204


def test_an_ordinary_member_can_have_a_photo(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    member = api_client.post(
        MEMBERS,
        json={
            "name": "Palanivel",
            "placement_parent_id": root_id,
            "placement_position": "LEFT",
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    ).json()

    assert put_png(api_client, leader, member["id"]).status_code == 200
    assert get_photo(api_client, leader, member["id"]).status_code == 200


# --- the marker on the member record ----------------------------------------------------


def test_the_member_record_reports_that_a_photo_exists(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """`photo_updated_at` lets a list or a dashboard know, without loading any image."""
    before = api_client.get(f"{MEMBERS}/{root_id}", headers=leader.headers).json()
    assert before["photo_updated_at"] is None

    saved = put_png(api_client, leader, root_id).json()

    after = api_client.get(f"{MEMBERS}/{root_id}", headers=leader.headers).json()
    assert after["photo_updated_at"] is not None
    # The same timestamp as the photo itself: the marker is the photo's own version.
    assert after["photo_updated_at"] == saved["updated_at"]


def test_the_team_overview_carries_the_leaders_photo_version(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """Home reads the leader's photo from the overview it already loads."""
    put_png(api_client, leader, root_id)

    overview = api_client.get("/api/v1/teams/me", headers=leader.headers).json()

    assert overview["root_member"]["photo_updated_at"] is not None


def test_removing_a_photo_clears_the_marker(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    put_png(api_client, leader, root_id)

    api_client.delete(f"{MEMBERS}/{root_id}/photo", headers=leader.headers)

    body = api_client.get(f"{MEMBERS}/{root_id}", headers=leader.headers).json()
    assert body["photo_updated_at"] is None


def test_the_marker_cannot_be_set_through_an_ordinary_edit(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = api_client.patch(
        f"{MEMBERS}/{root_id}",
        json={"photo_updated_at": "2026-01-01T00:00:00Z"},
        headers=leader.headers,
    )

    assert response.status_code == 422


# --- what is not an acceptable photo ----------------------------------------------------


def test_a_photo_over_the_limit_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    too_big = png(200, 200, noisy=True)
    assert len(too_big) > MAX_PHOTO_BYTES, "the fixture must exceed the limit to be a test"

    response = put_png(api_client, leader, root_id, too_big)

    assert response.status_code == 422
    assert error_code(response) == "photo_too_large"
    assert get_photo(api_client, leader, root_id).status_code == 404


def test_a_payload_far_beyond_any_avatar_is_refused_before_decoding(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = put_photo(
        api_client,
        leader,
        root_id,
        {"content_type": "image/png", "data": "A" * (MAX_PHOTO_BYTES * 8)},
    )

    assert response.status_code == 422
    assert error_code(response) == "validation_error"


def test_bytes_that_are_not_the_declared_format_are_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    """A PNG labelled as a JPEG: stored and served back, it would not be an image."""
    response = put_photo(
        api_client, leader, root_id, {"content_type": "image/jpeg", "data": encode(png())}
    )

    assert response.status_code == 422
    assert error_code(response) == "invalid_photo"


def test_data_that_is_not_an_image_at_all_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = put_photo(
        api_client,
        leader,
        root_id,
        {"content_type": "image/png", "data": encode(b"this is just some text")},
    )

    assert response.status_code == 422
    assert error_code(response) == "invalid_photo"


def test_data_that_is_not_base64_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = put_photo(
        api_client, leader, root_id, {"content_type": "image/png", "data": "not base64 !!!"}
    )

    assert response.status_code == 422
    assert error_code(response) == "invalid_photo"


def test_an_unsupported_content_type_is_rejected(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = put_photo(
        api_client,
        leader,
        root_id,
        {"content_type": "image/svg+xml", "data": encode(b"<svg/>")},
    )

    assert response.status_code == 422
    assert error_code(response) == "validation_error"


def test_a_photo_request_rejects_fields_it_does_not_accept(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    response = put_photo(
        api_client,
        leader,
        root_id,
        {"content_type": "image/png", "data": encode(png()), "team_id": str(uuid.uuid4())},
    )

    assert response.status_code == 422


# --- team isolation ---------------------------------------------------------------------


def test_a_leader_cannot_read_another_leaders_photo(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)
    put_png(api_client, leader, root_id)

    response = get_photo(api_client, other_leader, root_id)

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"


def test_a_leader_cannot_set_a_photo_on_another_leaders_member(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)

    response = put_png(api_client, other_leader, root_id)

    assert response.status_code == 404
    assert error_code(response) == "member_not_found"
    assert get_photo(api_client, leader, root_id).status_code == 404


def test_a_leader_cannot_remove_another_leaders_photo(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    api_client.post(INITIALIZE, json={}, headers=other_leader.headers)
    put_png(api_client, leader, root_id)

    response = api_client.delete(f"{MEMBERS}/{root_id}/photo", headers=other_leader.headers)

    assert response.status_code == 404
    assert get_photo(api_client, leader, root_id).status_code == 200


def test_each_leader_keeps_their_own_photo(
    api_client: TestClient, leader: Leader, other_leader: Leader, root_id: str
) -> None:
    other_root = api_client.post(INITIALIZE, json={}, headers=other_leader.headers).json()[
        "root_member"
    ]["id"]
    mine, theirs = png(2, 2), png(6, 6)

    put_png(api_client, leader, root_id, mine)
    put_png(api_client, other_leader, other_root, theirs)

    def stored(who: Leader, member_id: str) -> bytes:
        body = get_photo(api_client, who, member_id).json()
        return base64.b64decode(body["data_uri"].split(",", 1)[1])

    assert stored(leader, root_id) == mine
    assert stored(other_leader, other_root) == theirs


def test_photo_requests_need_a_token(api_client: TestClient, root_id: str) -> None:
    assert api_client.get(f"{MEMBERS}/{root_id}/photo").status_code == 401
    assert (
        api_client.put(
            f"{MEMBERS}/{root_id}/photo",
            json={"content_type": "image/png", "data": encode(png())},
        ).status_code
        == 401
    )
    assert api_client.delete(f"{MEMBERS}/{root_id}/photo").status_code == 401


def test_a_photo_for_an_unknown_member_is_not_found(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    unknown = str(uuid.uuid4())

    assert error_code(get_photo(api_client, leader, unknown)) == "member_not_found"
    assert error_code(put_png(api_client, leader, unknown)) == "member_not_found"
