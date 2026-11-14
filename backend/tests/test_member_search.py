"""Phase 6.4: finding a member by name or Mi Lifestyle ID, inside one team only."""

import pytest
from conftest import Leader, next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient

pytestmark = requires_database

INITIALIZE = "/api/v1/auth/initialize"
MEMBERS = "/api/v1/members"
SEARCH = "/api/v1/members/search"


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
    mi_lifestyle_id: str | None = None,
) -> dict:
    response = client.post(
        MEMBERS,
        json={
            "name": name,
            "placement_parent_id": parent_id,
            "placement_position": position,
            "mi_lifestyle_id": mi_lifestyle_id or next_mi_lifestyle_id(),
        },
        headers=leader.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def search(client: TestClient, leader: Leader, **params: object):
    return client.get(SEARCH, params=params, headers=leader.headers)


def names(response) -> list[str]:
    return [item["name"] for item in response.json()["items"]]


def error_code(response) -> str:
    return response.json()["error"]["code"]


@pytest.fixture
def small_team(api_client: TestClient, leader: Leader, root_id: str) -> dict[str, dict]:
    """A handful of members with deliberately overlapping names and known identifiers."""
    meera = create(api_client, leader, root_id, "LEFT", "Meera Nair", "0012345678")
    vijay = create(api_client, leader, root_id, "RIGHT", "Vijay Kumar", "9876543210")
    anil = create(api_client, leader, meera["id"], "LEFT", "anil nair", "0012349999")
    ajay = create(api_client, leader, meera["id"], "RIGHT", "Ajay Menon", "5555555555")
    return {"meera": meera, "vijay": vijay, "anil": anil, "ajay": ajay}


# --- matching ----------------------------------------------------------------------------


def test_an_exact_name_finds_that_member(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    response = search(api_client, leader, q="Vijay Kumar")

    assert response.status_code == 200
    assert names(response) == ["Vijay Kumar"]


def test_part_of_a_name_finds_everyone_who_has_it(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    # "Nair" is a surname here, so it matches in the middle of two different names.
    assert sorted(names(search(api_client, leader, q="nair"))) == ["Meera Nair", "anil nair"]


def test_name_matching_ignores_case_in_both_directions(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    # The query's case and the stored name's case are both irrelevant: "anil nair" is
    # stored in lower case and still matches a capitalised query.
    assert names(search(api_client, leader, q="ANIL")) == ["anil nair"]
    assert names(search(api_client, leader, q="meera")) == ["Meera Nair"]


def test_a_full_mi_lifestyle_id_finds_exactly_that_member(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    response = search(api_client, leader, q="9876543210")

    assert names(response) == ["Vijay Kumar"]
    assert response.json()["items"][0]["mi_lifestyle_id"] == "9876543210"


def test_the_first_digits_of_an_id_narrow_it_down_and_keep_leading_zeros(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    # Both of these identifiers begin "00123", and the leading zeros are part of them.
    assert sorted(names(search(api_client, leader, q="00123"))) == ["Meera Nair", "anil nair"]
    assert names(search(api_client, leader, q="0012345")) == ["Meera Nair"]
    # The zeros are not optional: the same digits without them match nobody.
    assert names(search(api_client, leader, q="12345")) == []


def test_a_query_with_letters_is_never_matched_against_identifiers(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    create(api_client, leader, root_id, "LEFT", "Zero Zero", "0000001234")

    # Not a possible identifier, so it is a name search and finds nothing.
    assert names(search(api_client, leader, q="00a0")) == []


def test_surrounding_whitespace_is_ignored(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    assert names(search(api_client, leader, q="   Vijay   ")) == ["Vijay Kumar"]
    assert names(search(api_client, leader, q="\t0012345678 ")) == ["Meera Nair"]


def test_wildcards_are_matched_literally_rather_than_as_patterns(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    # Without escaping, each of these would match every member in the team.
    assert names(search(api_client, leader, q="%")) == []
    assert names(search(api_client, leader, q="_")) == []
    assert names(search(api_client, leader, q="%a%")) == []


def test_a_member_matching_on_both_fields_is_returned_once(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    # A name made of the same digits as the identifier, so both conditions hit one row.
    create(api_client, leader, root_id, "LEFT", "7777777777", "7777777777")

    items = search(api_client, leader, q="7777777777").json()["items"]
    assert len(items) == 1


def test_the_leader_can_find_their_own_record(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    response = search(api_client, leader, q="Asha")

    assert names(response) == ["Asha Patel"]
    assert response.json()["items"][0]["is_root"] is True


def test_a_search_that_matches_nobody_is_an_empty_page_not_an_error(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    response = search(api_client, leader, q="Nobody At All")

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


# --- what a result carries ---------------------------------------------------------------


def test_a_result_states_where_the_member_sits(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    [result] = search(api_client, leader, q="anil").json()["items"]

    assert result["id"] == small_team["anil"]["id"]
    assert result["placement_position"] == "LEFT"
    assert result["placement_parent_id"] == small_team["meera"]["id"]
    assert result["placement_parent_name"] == "Meera Nair"
    assert result["photo_updated_at"] is None


def test_a_result_carries_no_personal_details_beyond_the_summary(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    api_client.post(
        MEMBERS,
        json={
            "name": "Private Person",
            "placement_parent_id": root_id,
            "placement_position": "LEFT",
            "mi_lifestyle_id": next_mi_lifestyle_id(),
            "phone_number": "+91 98765 43210",
            "notes": "Met at the regional meeting.",
        },
        headers=leader.headers,
    )

    [result] = search(api_client, leader, q="Private").json()["items"]
    assert "phone_number" not in result
    assert "notes" not in result


def test_the_root_result_has_no_placement_parent(
    api_client: TestClient, leader: Leader, team: dict
) -> None:
    [result] = search(api_client, leader, q="Asha Patel").json()["items"]

    assert result["placement_parent_id"] is None
    assert result["placement_parent_name"] is None
    assert result["placement_position"] is None


# --- validation --------------------------------------------------------------------------


def test_a_blank_query_is_refused_rather_than_answered_with_the_team(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    response = search(api_client, leader, q="   ")

    assert response.status_code == 422
    assert error_code(response) == "search_query_required"


def test_a_missing_or_empty_query_is_refused(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    assert api_client.get(SEARCH, headers=leader.headers).status_code == 422
    assert search(api_client, leader, q="").status_code == 422


def test_an_excessively_long_query_is_refused_before_it_is_searched_for(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    response = search(api_client, leader, q="a" * 500)

    assert response.status_code == 422
    assert error_code(response) == "validation_error"


def test_an_oversized_limit_is_refused_rather_than_honoured(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    assert search(api_client, leader, q="a", limit=51).status_code == 422
    assert search(api_client, leader, q="a", limit=0).status_code == 422


def test_a_cursor_this_api_did_not_issue_is_refused(
    api_client: TestClient, leader: Leader, small_team: dict
) -> None:
    response = search(api_client, leader, q="a", cursor="not-a-cursor")

    assert response.status_code == 400
    assert error_code(response) == "invalid_cursor"


def test_searching_without_a_token_is_refused(api_client: TestClient) -> None:
    assert api_client.get(SEARCH, params={"q": "anything"}).status_code == 401


# --- ordering, bounds and pagination ------------------------------------------------------


@pytest.fixture
def alphabet_team(api_client: TestClient, leader: Leader, root_id: str) -> list[str]:
    """Twelve members sharing a word, registered out of alphabetical order."""
    created_in = ["Mira", "Arun", "Zara", "Bala", "Priya", "Chitra"]
    created_in += ["Nisha", "Dev", "Yash", "Esha", "Kiran", "Farah"]

    parent, position = root_id, "LEFT"
    for name in created_in:
        member = create(api_client, leader, parent, position, f"{name} Sharma")
        parent, position = member["id"], "LEFT"
    return sorted(f"{name} Sharma" for name in created_in)


def test_results_are_ordered_by_name_not_by_registration_order(
    api_client: TestClient, leader: Leader, alphabet_team: list[str]
) -> None:
    assert names(search(api_client, leader, q="Sharma", limit=50)) == alphabet_team


def test_the_same_search_twice_returns_the_same_order(
    api_client: TestClient, leader: Leader, alphabet_team: list[str]
) -> None:
    first = names(search(api_client, leader, q="Sharma", limit=50))
    second = names(search(api_client, leader, q="Sharma", limit=50))

    assert first == second


def test_members_sharing_a_name_are_ordered_stably_and_both_returned(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    first = create(api_client, leader, root_id, "LEFT", "Same Name")
    second = create(api_client, leader, first["id"], "LEFT", "Same Name")

    pages = [search(api_client, leader, q="Same Name").json()["items"] for _ in range(3)]
    ids = [[item["id"] for item in page] for page in pages]

    assert sorted(ids[0]) == sorted([first["id"], second["id"]])
    assert ids[0] == ids[1] == ids[2]


def test_a_page_is_bounded_by_the_requested_limit(
    api_client: TestClient, leader: Leader, alphabet_team: list[str]
) -> None:
    body = search(api_client, leader, q="Sharma", limit=5).json()

    assert len(body["items"]) == 5
    assert body["next_cursor"] is not None


def test_paging_walks_every_match_once_in_order(
    api_client: TestClient, leader: Leader, alphabet_team: list[str]
) -> None:
    collected: list[str] = []
    cursor: str | None = None
    for _ in range(10):
        params: dict[str, object] = {"q": "Sharma", "limit": 5}
        if cursor:
            params["cursor"] = cursor
        body = search(api_client, leader, **params).json()
        collected.extend(item["name"] for item in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert cursor is None
    assert collected == alphabet_team
    assert len(collected) == len(set(collected))


def test_the_last_page_says_it_is_the_last(
    api_client: TestClient, leader: Leader, alphabet_team: list[str]
) -> None:
    body = search(api_client, leader, q="Sharma", limit=len(alphabet_team)).json()

    assert len(body["items"]) == len(alphabet_team)
    assert body["next_cursor"] is None


def test_a_name_containing_the_cursor_separator_still_pages_correctly(
    api_client: TestClient, leader: Leader, root_id: str
) -> None:
    # The cursor packs a name and an id together; a name carrying the separator must not
    # be able to split it in the wrong place.
    first = create(api_client, leader, root_id, "LEFT", "Pipe|Name A")
    create(api_client, leader, first["id"], "LEFT", "Pipe|Name B")

    page = search(api_client, leader, q="Pipe|Name", limit=1).json()
    assert page["items"][0]["name"] == "Pipe|Name A"

    rest = search(api_client, leader, q="Pipe|Name", limit=1, cursor=page["next_cursor"]).json()
    assert rest["items"][0]["name"] == "Pipe|Name B"


# --- team isolation -----------------------------------------------------------------------


def test_one_leader_cannot_find_another_leaders_members(
    api_client: TestClient, leader: Leader, other_leader: Leader, small_team: dict
) -> None:
    other = api_client.post(
        INITIALIZE, json={"display_name": "Other Leader"}, headers=other_leader.headers
    ).json()
    create(api_client, other_leader, other["root_member"]["id"], "LEFT", "Hidden Person")

    # Neither leader's search can reach into the other's team, by name...
    assert names(search(api_client, leader, q="Hidden")) == []
    assert names(search(api_client, other_leader, q="Nair")) == []
    # ...nor by an identifier they already know.
    assert names(search(api_client, other_leader, q="0012345678")) == []


def test_a_cursor_from_another_team_reveals_nothing(
    api_client: TestClient, leader: Leader, other_leader: Leader, small_team: dict
) -> None:
    api_client.post(INITIALIZE, json={"display_name": "Other Leader"}, headers=other_leader.headers)

    page = search(api_client, leader, q="a", limit=1).json()
    assert page["next_cursor"] is not None

    # The same cursor, used by the other leader, can only point into their own team.
    stolen = search(api_client, other_leader, q="a", limit=10, cursor=page["next_cursor"])
    assert stolen.status_code == 200
    assert all(item["name"] != "Meera Nair" for item in stolen.json()["items"])


def test_an_uninitialized_leader_gets_no_team_rather_than_someone_elses(
    api_client: TestClient, other_leader: Leader, small_team: dict
) -> None:
    response = search(api_client, other_leader, q="Nair")

    assert response.status_code == 404
    assert error_code(response) == "team_not_initialized"


# Search in a team of 1,000, with its timing and query plan, lives in
# tests/test_performance.py beside the other large-team measurements.
