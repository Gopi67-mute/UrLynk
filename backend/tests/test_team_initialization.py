"""Phase 5: every leader gets exactly one private team, with themselves as its root.

Covers the first-login flow, the returning-login flow, idempotency under repeated and
concurrent requests, and that the team always comes from the verified token.
"""

import threading

from conftest import Leader, requires_database
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.models import Member, Team, UserProfile
from app.services import initialization_service

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MY_TEAM = "/api/v1/teams/me"


def initialize(client: TestClient, leader: Leader, body: dict | None = None):
    return client.post(INITIALIZE, json=body, headers=leader.headers)


def _count(session_factory: sessionmaker[Session], table: str) -> int:
    with session_factory() as session:
        return session.scalar(text(f"SELECT count(*) FROM {table}"))  # noqa: S608 - fixed names


# --- first login ------------------------------------------------------------------------


def test_first_login_creates_one_profile_one_team_and_one_root_member(
    api_client: TestClient, leader: Leader, session_factory
) -> None:
    response = initialize(api_client, leader)

    assert response.status_code == 200
    assert _count(session_factory, "user_profiles") == 1
    assert _count(session_factory, "teams") == 1
    assert _count(session_factory, "members") == 1


def test_the_root_member_is_the_leader_and_has_no_placement(
    api_client: TestClient, leader: Leader, session_factory
) -> None:
    response = initialize(api_client, leader, {"display_name": "Asha Patel"})
    root = response.json()["root_member"]

    assert root["name"] == "Asha Patel"
    assert root["is_root"] is True
    assert root["placement_position"] is None

    with session_factory() as session:
        stored = session.query(Member).one()
        profile = session.query(UserProfile).one()
        team = session.query(Team).one()

    # The root is tied to both the team and the verified identity behind it.
    assert stored.team_id == team.id
    assert stored.user_profile_id == profile.id
    assert profile.clerk_user_id == leader.clerk_user_id
    assert team.owner_user_id == profile.id
    assert stored.placement_parent_id is None


def test_a_new_team_counts_only_its_leader(api_client: TestClient, leader: Leader) -> None:
    counts = initialize(api_client, leader).json()["counts"]
    assert counts == {"total_members": 1, "left_members": 0, "right_members": 0}


def test_the_team_name_is_derived_from_the_display_name(
    api_client: TestClient, leader: Leader
) -> None:
    body = initialize(api_client, leader, {"display_name": "Asha Patel"}).json()
    assert body["team"]["team_name"] == "Asha Patel's Team"


def test_without_a_display_name_the_defaults_are_used(
    api_client: TestClient, leader: Leader
) -> None:
    body = initialize(api_client, leader).json()
    assert body["team"]["team_name"] == initialization_service.DEFAULT_TEAM_NAME
    assert body["root_member"]["name"] == initialization_service.DEFAULT_LEADER_NAME


def test_an_explicit_team_name_is_used(api_client: TestClient, leader: Leader) -> None:
    body = initialize(api_client, leader, {"team_name": "Southern Region"}).json()
    assert body["team"]["team_name"] == "Southern Region"


# --- returning login --------------------------------------------------------------------


def test_repeated_initialization_creates_no_duplicates(
    api_client: TestClient, leader: Leader, session_factory
) -> None:
    first = initialize(api_client, leader, {"display_name": "Asha Patel"}).json()
    for _ in range(3):
        again = initialize(api_client, leader, {"display_name": "Asha Patel"}).json()
        assert again["team"]["id"] == first["team"]["id"]
        assert again["root_member"]["id"] == first["root_member"]["id"]

    assert _count(session_factory, "user_profiles") == 1
    assert _count(session_factory, "teams") == 1
    assert _count(session_factory, "members") == 1


def test_initialization_never_renames_an_existing_team(
    api_client: TestClient, leader: Leader
) -> None:
    initialize(api_client, leader, {"display_name": "Asha Patel"})

    body = initialize(
        api_client, leader, {"display_name": "Someone Else", "team_name": "Renamed"}
    ).json()

    assert body["team"]["team_name"] == "Asha Patel's Team"
    assert body["root_member"]["name"] == "Asha Patel"


def test_a_returning_leader_reads_the_same_team_without_initializing(
    api_client: TestClient, leader: Leader
) -> None:
    created = initialize(api_client, leader, {"display_name": "Asha Patel"}).json()

    response = api_client.get(MY_TEAM, headers=leader.headers)

    assert response.status_code == 200
    assert response.json() == created


def test_the_team_endpoint_reports_that_setup_has_not_happened_yet(
    api_client: TestClient, leader: Leader
) -> None:
    response = api_client.get(MY_TEAM, headers=leader.headers)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "team_not_initialized"


def test_two_leaders_get_two_separate_teams(
    api_client: TestClient, leader: Leader, other_leader: Leader, session_factory
) -> None:
    first = initialize(api_client, leader, {"display_name": "Asha"}).json()
    second = initialize(api_client, other_leader, {"display_name": "Bala"}).json()

    assert first["team"]["id"] != second["team"]["id"]
    assert first["root_member"]["id"] != second["root_member"]["id"]
    assert _count(session_factory, "teams") == 2


# --- concurrency and duplicate requests -------------------------------------------------


def test_concurrent_first_logins_create_exactly_one_team(session_factory) -> None:
    """Four simultaneous first logins for the same leader, one team at the end.

    This is the race the unique constraints and ON CONFLICT clauses exist for: the
    threads run their own transactions against the real database at the same time.
    """
    threads_count = 4
    start = threading.Barrier(threads_count)
    failures: list[BaseException] = []

    def first_login() -> None:
        session = session_factory()
        try:
            start.wait(timeout=10)
            initialization_service.initialize_account(
                session, clerk_user_id="user_race", display_name="Race"
            )
        except BaseException as exc:  # noqa: BLE001 - reported through `failures`
            failures.append(exc)
        finally:
            session.close()

    threads = [threading.Thread(target=first_login) for _ in range(threads_count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not failures, failures
    assert _count(session_factory, "user_profiles") == 1
    assert _count(session_factory, "teams") == 1
    assert _count(session_factory, "members") == 1


def test_a_failed_initialization_leaves_nothing_behind(session_factory, monkeypatch) -> None:
    """All three records are created in one transaction, or none of them are."""
    from app.repositories import member_repository

    def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(member_repository, "insert_root_if_absent", explode)

    with session_factory() as session:
        try:
            initialization_service.initialize_account(session, clerk_user_id="user_fails")
        except RuntimeError:
            session.rollback()

    assert _count(session_factory, "user_profiles") == 0
    assert _count(session_factory, "teams") == 0


# --- authentication and input ------------------------------------------------------------


def test_initialization_requires_a_token(api_client: TestClient) -> None:
    response = api_client.post(INITIALIZE, json={})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_reading_a_team_requires_a_token(api_client: TestClient) -> None:
    assert api_client.get(MY_TEAM).status_code == 401


def test_a_forged_token_cannot_initialize(
    api_client: TestClient, token_factory, attacker_key
) -> None:
    token = token_factory(key=attacker_key, sub="user_attacker")
    response = api_client.post(INITIALIZE, json={}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_initialization_rejects_fields_it_does_not_accept(
    api_client: TestClient, leader: Leader
) -> None:
    """A client cannot smuggle in a team, an owner or a root member of its choosing."""
    for body in (
        {"team_id": "11111111-1111-1111-1111-111111111111"},
        {"owner_user_id": "11111111-1111-1111-1111-111111111111"},
        {"clerk_user_id": "user_someone_else"},
        {"is_root": True},
    ):
        response = initialize(api_client, leader, body)
        assert response.status_code == 422, body


def test_initialization_rejects_unusable_names(api_client: TestClient, leader: Leader) -> None:
    for body in (
        {"display_name": "   "},
        {"display_name": "A" * 121},
        {"team_name": ""},
        {"team_name": "A" * 121},
        {"display_name": "Line\nBreak"},
    ):
        response = initialize(api_client, leader, body)
        assert response.status_code == 422, body
