"""Phase 5 performance: the API has to stay responsive as a team grows.

AGENTS.md section 12 asks for a team of at least 1,000 members, and p95 under 500 ms
for common operations. These tests seed real trees in PostgreSQL and measure the
endpoints through the ASGI app, printing what they measured so the numbers can be
read rather than assumed.

The thresholds are deliberately loose — a developer machine running tests is not a
benchmark rig — so they catch a query that scales with team size (a missing index, a
full-tree download, an N+1), not small differences in hardware.
"""

import time
import uuid
from collections import deque

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient
from sqlalchemy import insert, text

from app.models import Member
from app.repositories import member_repository

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MY_TEAM = "/api/v1/teams/me"
MEMBERS = "/api/v1/members"

TEAM_SIZE = 1_000
DEEP_LEG_DEPTH = 400

# One request that reads the database, including app and HTTP overhead.
SINGLE_REQUEST_BUDGET_SECONDS = 1.5
# Paging the whole directory, 50 at a time.
FULL_PAGINATION_BUDGET_SECONDS = 10.0


def _elapsed(label: str, started: float) -> float:
    seconds = time.perf_counter() - started
    print(f"  {label}: {seconds * 1000:.0f} ms")
    return seconds


def _analyze(session) -> None:
    """Refresh planner statistics, which autovacuum would do on a live database.

    Without it the planner still thinks the table is empty right after a bulk insert,
    and the plans measured here would not be the plans production runs.
    """
    session.execute(text("ANALYZE members"))
    session.commit()


def _seed_balanced_tree(session, team_id: uuid.UUID, count: int) -> list[uuid.UUID]:
    """Insert `count` members as a complete binary tree under the team's root.

    Breadth first, so every parent exists before its children and the composite
    foreign keys hold. One executemany rather than `count` API calls: this is setting
    up the measurement, not part of it.
    """
    root = member_repository.get_root(session, team_id)
    assert root is not None

    rows: list[dict] = []
    free_slots: deque[tuple[uuid.UUID, str]] = deque([(root.id, "LEFT"), (root.id, "RIGHT")])
    while len(rows) < count:
        parent_id, position = free_slots.popleft()
        member_id = uuid.uuid4()
        rows.append(
            {
                "id": member_id,
                "team_id": team_id,
                "name": f"Member {len(rows) + 1:04d}",
                # Leading 1, so a seeded team's identifiers cannot collide with the
                # ones `next_mi_lifestyle_id` hands out to members added through the API.
                "mi_lifestyle_id": f"1{len(rows) + 1:09d}",
                "placement_parent_id": parent_id,
                "placement_position": position,
                "is_root": False,
            }
        )
        free_slots.append((member_id, "LEFT"))
        free_slots.append((member_id, "RIGHT"))

    session.execute(insert(Member), rows)
    session.commit()
    _analyze(session)
    return [row["id"] for row in rows]


def _seed_single_leg(session, team_id: uuid.UUID, depth: int) -> uuid.UUID:
    """One LEFT-only chain, the worst case for walking a placement chain upwards."""
    root = member_repository.get_root(session, team_id)
    assert root is not None

    rows: list[dict] = []
    parent_id = root.id
    for level in range(depth):
        member_id = uuid.uuid4()
        rows.append(
            {
                "id": member_id,
                "team_id": team_id,
                "name": f"Leg {level + 1:04d}",
                "mi_lifestyle_id": f"2{level + 1:09d}",
                "placement_parent_id": parent_id,
                "placement_position": "LEFT",
                "is_root": False,
            }
        )
        parent_id = member_id

    session.execute(insert(Member), rows)
    session.commit()
    _analyze(session)
    return parent_id  # the deepest member


@pytest.fixture
def large_team(api_client: TestClient, leader: Leader, session_factory) -> dict:
    overview = api_client.post(
        INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers
    ).json()
    with session_factory() as session:
        member_ids = _seed_balanced_tree(session, uuid.UUID(overview["team"]["id"]), TEAM_SIZE)
    return {"overview": overview, "member_ids": member_ids}


def test_a_team_of_a_thousand_loads_quickly(
    api_client: TestClient, leader: Leader, large_team: dict
) -> None:
    print(f"\nTeam of {TEAM_SIZE + 1} members (balanced tree):")

    started = time.perf_counter()
    overview = api_client.get(MY_TEAM, headers=leader.headers)
    overview_seconds = _elapsed("GET /teams/me (counts both branches)", started)

    assert overview.status_code == 200
    counts = overview.json()["counts"]
    assert counts["total_members"] == TEAM_SIZE + 1
    # A complete binary tree splits evenly, give or take the last, partial level.
    assert counts["left_members"] + counts["right_members"] == TEAM_SIZE
    assert overview_seconds < SINGLE_REQUEST_BUDGET_SECONDS


def test_one_page_of_a_large_directory_is_cheap(
    api_client: TestClient, leader: Leader, large_team: dict
) -> None:
    print(f"\nDirectory paging, team of {TEAM_SIZE + 1}:")

    started = time.perf_counter()
    first = api_client.get(MEMBERS, params={"limit": 50}, headers=leader.headers)
    first_seconds = _elapsed("GET /members (first page of 50)", started)

    assert first.status_code == 200
    body = first.json()
    assert len(body["items"]) == 50
    assert body["next_cursor"]
    assert first_seconds < SINGLE_REQUEST_BUDGET_SECONDS


def test_paging_the_whole_directory_visits_every_member_once(
    api_client: TestClient, leader: Leader, large_team: dict
) -> None:
    """Keyset pagination over rows that share a created_at, which is the hard case.

    The seeded rows all carry the same `now()`, so the cursor has nothing but the id
    to break ties on. Every member must still appear exactly once.
    """
    print(f"\nFull pagination, team of {TEAM_SIZE + 1}:")
    started = time.perf_counter()

    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, object] = {"limit": 50}
        if cursor:
            params["cursor"] = cursor
        page = api_client.get(MEMBERS, params=params, headers=leader.headers).json()
        seen.extend(item["id"] for item in page["items"])
        pages += 1
        cursor = page["next_cursor"]
        if not cursor:
            break
        assert pages <= 40, "pagination did not terminate"

    total_seconds = _elapsed(f"{pages} pages of 50", started)

    assert len(seen) == TEAM_SIZE + 1
    assert len(set(seen)) == len(seen)  # no member returned twice
    assert total_seconds < FULL_PAGINATION_BUDGET_SECONDS


def test_reading_one_members_positions_does_not_depend_on_team_size(
    api_client: TestClient, leader: Leader, large_team: dict
) -> None:
    print(f"\nSingle member reads, team of {TEAM_SIZE + 1}:")
    member_id = large_team["member_ids"][TEAM_SIZE // 2]

    started = time.perf_counter()
    children = api_client.get(f"{MEMBERS}/{member_id}/children", headers=leader.headers)
    children_seconds = _elapsed("GET /members/{id}/children", started)

    started = time.perf_counter()
    detail = api_client.get(f"{MEMBERS}/{member_id}", headers=leader.headers)
    detail_seconds = _elapsed("GET /members/{id}", started)

    assert children.status_code == 200
    assert detail.status_code == 200
    assert children_seconds < SINGLE_REQUEST_BUDGET_SECONDS
    assert detail_seconds < SINGLE_REQUEST_BUDGET_SECONDS


def test_adding_a_member_to_a_large_team_is_quick(
    api_client: TestClient, leader: Leader, large_team: dict
) -> None:
    print(f"\nRegistration into a team of {TEAM_SIZE + 1}:")
    # A member deep in the tree, whose LEFT and RIGHT are both still free.
    parent_id = str(large_team["member_ids"][-1])

    started = time.perf_counter()
    response = api_client.post(
        MEMBERS,
        json={
            "name": "Newcomer",
            "placement_parent_id": parent_id,
            "placement_position": "LEFT",
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    )
    seconds = _elapsed("POST /members (lock, chain check, insert)", started)

    assert response.status_code == 201, response.text
    assert seconds < SINGLE_REQUEST_BUDGET_SECONDS


def test_a_very_deep_single_leg_stays_workable(
    api_client: TestClient, leader: Leader, session_factory
) -> None:
    """The worst case for the placement-chain check: one leg, 400 deep.

    Single-leg building is normal in a binary structure, so the ancestor walk that
    guards against cycles has to cope with it.
    """
    overview = api_client.post(
        INITIALIZE, json={"display_name": "Asha Patel"}, headers=leader.headers
    ).json()
    with session_factory() as session:
        deepest = _seed_single_leg(session, uuid.UUID(overview["team"]["id"]), DEEP_LEG_DEPTH)

    print(f"\nSingle leg {DEEP_LEG_DEPTH} deep:")

    started = time.perf_counter()
    response = api_client.post(
        MEMBERS,
        json={
            "name": "Bottom",
            "placement_parent_id": str(deepest),
            "placement_position": "RIGHT",
            "mi_lifestyle_id": next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    )
    insert_seconds = _elapsed("POST /members at the bottom of the leg", started)

    assert response.status_code == 201, response.text
    assert insert_seconds < SINGLE_REQUEST_BUDGET_SECONDS

    started = time.perf_counter()
    counts = api_client.get(MY_TEAM, headers=leader.headers).json()["counts"]
    counts_seconds = _elapsed("GET /teams/me over the deep leg", started)

    assert counts["left_members"] == DEEP_LEG_DEPTH + 1
    assert counts["right_members"] == 0
    assert counts_seconds < SINGLE_REQUEST_BUDGET_SECONDS


def test_reading_a_parents_children_uses_an_index(
    api_client: TestClient, leader: Leader, large_team: dict, session_factory
) -> None:
    """The per-request hot path must be an index lookup, never a table scan.

    "A parent's two children" is read by the Team screen, by every member detail and
    by the slot checks before a placement, so it is the query that must not grow with
    the team. `ix_members_team_placement_parent` is what keeps it flat.

    The recursive branch count is not asserted here: for a balanced tree PostgreSQL
    costs a hash join over one pass of the table as cheaper than an index lookup per
    level, and which it picks is the planner's business. What that query costs is
    measured by the timing tests above instead.
    """
    team_id = large_team["overview"]["team"]["id"]
    root_id = large_team["overview"]["root_member"]["id"]

    with session_factory() as session:
        plan = "\n".join(
            row[0]
            for row in session.execute(
                text(
                    "EXPLAIN ANALYZE SELECT * FROM members"
                    " WHERE team_id = :team_id AND placement_parent_id = :parent_id"
                ),
                {"team_id": team_id, "parent_id": root_id},
            ).all()
        )

    print(f"\nChildren lookup plan:\n{plan}")
    assert "ix_members_team_placement_parent" in plan, plan
    assert "Seq Scan" not in plan, plan
