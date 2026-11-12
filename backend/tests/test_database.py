"""Tests against a real PostgreSQL database: migrations, constraints and sessions.

They run only when TEST_DATABASE_URL is set, and only if its database name contains
"test", because they migrate the schema down and up. Never point it at real data.
Fixtures live in conftest.py.
"""

import uuid

import pytest
from alembic.config import Config
from conftest import next_mi_lifestyle_id, requires_database
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.db.session import get_db
from app.main import create_app
from app.models import Member, PlacementPosition, Team, UserProfile

pytestmark = requires_database


# --- migrations -------------------------------------------------------------------------


def test_migration_creates_user_profiles(db_engine: Engine) -> None:
    inspector = inspect(db_engine)
    assert "user_profiles" in inspector.get_table_names()
    columns = {column["name"] for column in inspector.get_columns("user_profiles")}
    assert columns == {"id", "clerk_user_id", "created_at", "updated_at"}
    unique = {tuple(c["column_names"]) for c in inspector.get_unique_constraints("user_profiles")}
    assert ("clerk_user_id",) in unique


def test_migration_creates_teams_and_members(db_engine: Engine) -> None:
    inspector = inspect(db_engine)
    assert set(inspector.get_table_names()) == {
        "alembic_version",
        "user_profiles",
        "teams",
        "members",
        "member_photos",
    }

    team_unique = {tuple(c["column_names"]) for c in inspector.get_unique_constraints("teams")}
    assert ("owner_user_id",) in team_unique  # one team per leader

    member_columns = {column["name"] for column in inspector.get_columns("members")}
    assert member_columns == {
        "id",
        "team_id",
        "user_profile_id",
        "name",
        "mi_lifestyle_id",
        "phone_number",
        "joining_date",
        "notes",
        "photo_updated_at",
        "sponsor_id",
        "placement_parent_id",
        "placement_position",
        "is_root",
        "created_at",
        "updated_at",
    }


def test_members_has_the_indexes_the_queries_rely_on(db_engine: Engine) -> None:
    indexes = {index["name"] for index in inspect(db_engine).get_indexes("members")}
    assert {
        "ix_members_team_root",  # one root per team
        "ix_members_team_mi_lifestyle_id",  # unique ID per team
        "ix_members_team_placement_parent",  # reading a parent's children
        "ix_members_team_created_at_id",  # keyset pagination
    } <= indexes


def test_models_match_migrations(alembic_config: Config, db_engine: Engine) -> None:
    # Fails if a model changed without a matching migration.
    command.check(alembic_config)


def test_migrations_downgrade_and_upgrade_cleanly(
    alembic_config: Config, db_engine: Engine
) -> None:
    command.downgrade(alembic_config, "base")
    assert "members" not in inspect(db_engine).get_table_names()
    command.upgrade(alembic_config, "head")
    assert "members" in inspect(db_engine).get_table_names()


# --- connectivity and session behaviour -------------------------------------------------


def test_database_health_reports_ok(db_settings, verifier) -> None:
    app = create_app(db_settings, token_verifier=verifier)
    with TestClient(app) as client:
        response = client.get("/health/db")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_statement_timeout_is_applied(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        assert connection.execute(text("SHOW statement_timeout")).scalar_one() == "10s"


def test_server_defaults_fill_id_and_timestamps(session_factory) -> None:
    with session_factory() as session:
        session.execute(text("INSERT INTO user_profiles (clerk_user_id) VALUES ('user_raw')"))
        session.commit()
        profile = session.scalars(select(UserProfile)).one()
    assert profile.id is not None
    assert profile.created_at is not None
    assert profile.created_at.tzinfo is not None
    assert profile.updated_at is not None


def test_clerk_user_id_is_unique(session_factory) -> None:
    with session_factory() as session:
        session.add(UserProfile(clerk_user_id="user_same"))
        session.commit()
        session.add(UserProfile(clerk_user_id="user_same"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_empty_clerk_user_id_is_rejected(session_factory) -> None:
    with session_factory() as session:
        session.add(UserProfile(clerk_user_id=""))
        with pytest.raises(IntegrityError):
            session.commit()


def test_updated_at_changes_on_update(session_factory) -> None:
    with session_factory() as session:
        profile = UserProfile(clerk_user_id="user_update")
        session.add(profile)
        session.commit()
        session.refresh(profile)
        before = profile.updated_at

        session.execute(text("SELECT pg_sleep(0.01)"))
        profile.clerk_user_id = "user_updated"
        session.commit()
        session.refresh(profile)
    assert profile.updated_at > before


# --- team and member constraints ---------------------------------------------------------
#
# These check the database itself, not the services: the structure of a binary tree has
# to survive a bug in application code.


def _seed_team(session: Session, clerk_user_id: str = "user_owner") -> tuple[Team, Member]:
    profile = UserProfile(clerk_user_id=clerk_user_id)
    session.add(profile)
    session.flush()
    team = Team(owner_user_id=profile.id, team_name="Team")
    session.add(team)
    session.flush()
    root = Member(team_id=team.id, user_profile_id=profile.id, name="Leader", is_root=True)
    session.add(root)
    session.commit()
    return team, root


def _child(team: Team, parent: Member, position: PlacementPosition, name: str) -> Member:
    """A valid non-root member. Every one carries a unique ten-digit identifier."""
    return Member(
        team_id=team.id,
        name=name,
        mi_lifestyle_id=next_mi_lifestyle_id(),
        placement_parent_id=parent.id,
        placement_position=position,
    )


def test_a_leader_can_own_only_one_team(session_factory) -> None:
    with session_factory() as session:
        team, _ = _seed_team(session)
        session.add(Team(owner_user_id=team.owner_user_id, team_name="Second Team"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_a_team_can_have_only_one_root_member(session_factory) -> None:
    with session_factory() as session:
        team, _ = _seed_team(session)
        session.add(Member(team_id=team.id, name="Another Leader", is_root=True))
        with pytest.raises(IntegrityError):
            session.commit()


def test_a_root_member_cannot_have_a_placement(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        session.add(
            Member(
                team_id=team.id,
                name="Impossible",
                is_root=True,
                placement_parent_id=root.id,
                placement_position=PlacementPosition.LEFT,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_a_non_root_member_needs_a_parent_and_a_position(session_factory) -> None:
    with session_factory() as session:
        team, _ = _seed_team(session)
        session.add(Member(team_id=team.id, name="Floating"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_a_parent_cannot_have_two_children_on_one_side(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        session.add(_child(team, root, PlacementPosition.LEFT, "First"))
        session.commit()
        session.add(_child(team, root, PlacementPosition.LEFT, "Second"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_a_parent_can_have_one_child_on_each_side(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        session.add(_child(team, root, PlacementPosition.LEFT, "Left"))
        session.add(_child(team, root, PlacementPosition.RIGHT, "Right"))
        session.commit()
        assert session.scalar(text("SELECT count(*) FROM members")) == 3


def test_a_member_cannot_be_its_own_placement_parent(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        child = _child(team, root, PlacementPosition.LEFT, "Child")
        session.add(child)
        session.commit()

        with pytest.raises(IntegrityError):
            session.execute(
                text("UPDATE members SET placement_parent_id = id WHERE id = :id"),
                {"id": child.id},
            )
            session.commit()


def test_a_member_cannot_be_its_own_sponsor(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        child = _child(team, root, PlacementPosition.LEFT, "Child")
        session.add(child)
        session.commit()

        with pytest.raises(IntegrityError):
            session.execute(
                text("UPDATE members SET sponsor_id = id WHERE id = :id"), {"id": child.id}
            )
            session.commit()


def test_a_placement_parent_must_be_in_the_same_team(session_factory) -> None:
    with session_factory() as session:
        _, root_a = _seed_team(session, "user_owner_a")
        team_b, _ = _seed_team(session, "user_owner_b")

        # Leader B's team, placed under leader A's root: the composite foreign key
        # (team_id, placement_parent_id) -> (team_id, id) makes this impossible.
        session.add(
            Member(
                team_id=team_b.id,
                name="Cross team",
                placement_parent_id=root_a.id,
                placement_position=PlacementPosition.LEFT,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_a_sponsor_must_be_in_the_same_team(session_factory) -> None:
    with session_factory() as session:
        _, root_a = _seed_team(session, "user_owner_a")
        team_b, root_b = _seed_team(session, "user_owner_b")

        session.add(
            Member(
                team_id=team_b.id,
                name="Cross sponsor",
                sponsor_id=root_a.id,
                placement_parent_id=root_b.id,
                placement_position=PlacementPosition.LEFT,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_placement_position_only_accepts_left_and_right(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        with pytest.raises(IntegrityError):
            session.execute(
                text(
                    "INSERT INTO members"
                    " (team_id, name, mi_lifestyle_id, placement_parent_id, placement_position)"
                    " VALUES (:team_id, 'Sideways', '9000000001', :parent_id, 'UP')"
                ),
                {"team_id": team.id, "parent_id": root.id},
            )
            session.commit()


def test_mi_lifestyle_id_is_unique_within_a_team_but_not_across_teams(session_factory) -> None:
    with session_factory() as session:
        team_a, root_a = _seed_team(session, "user_owner_a")
        team_b, root_b = _seed_team(session, "user_owner_b")

        first = _child(team_a, root_a, PlacementPosition.LEFT, "First")
        first.mi_lifestyle_id = "0012345678"
        session.add(first)
        # The same ID in another leader's team is fine: teams are independent.
        elsewhere = _child(team_b, root_b, PlacementPosition.LEFT, "Elsewhere")
        elsewhere.mi_lifestyle_id = "0012345678"
        session.add(elsewhere)
        session.commit()

        clash = _child(team_a, root_a, PlacementPosition.RIGHT, "Clash")
        clash.mi_lifestyle_id = "0012345678"
        session.add(clash)
        with pytest.raises(IntegrityError):
            session.commit()


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("123456789", id="nine digits"),
        pytest.param("12345678901", id="eleven digits"),
        pytest.param("12345A7890", id="ten characters, not all digits"),
        pytest.param("ML0012A", id="letters"),
    ],
)
def test_the_database_refuses_an_identifier_that_is_not_ten_digits(
    session_factory, value: str
) -> None:
    """The last line of defence, below the API and the form.

    The constraint was added NOT VALID, which skips the rows already stored but still
    checks every row written afterwards — which is what this proves.
    """
    with session_factory() as session:
        team, root = _seed_team(session)
        member = _child(team, root, PlacementPosition.LEFT, "Wrong shape")
        member.mi_lifestyle_id = value
        session.add(member)
        with pytest.raises(IntegrityError):
            session.commit()


def test_the_database_refuses_a_member_without_an_identifier(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        member = _child(team, root, PlacementPosition.LEFT, "No identifier")
        member.mi_lifestyle_id = None
        session.add(member)
        with pytest.raises(IntegrityError):
            session.commit()


def test_the_root_member_is_the_one_exemption(session_factory) -> None:
    """Sign-up creates it from a Clerk account that has no Mi Lifestyle ID to give."""
    with session_factory() as session:
        _, root = _seed_team(session)
        assert root.is_root is True
        assert root.mi_lifestyle_id is None


def test_mi_lifestyle_id_keeps_leading_zeros(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        member = _child(team, root, PlacementPosition.LEFT, "Zero")
        member.mi_lifestyle_id = "0007001234"
        session.add(member)
        session.commit()

        stored = session.scalar(
            text("SELECT mi_lifestyle_id FROM members WHERE id = :id"), {"id": member.id}
        )
    assert stored == "0007001234"


def test_deleting_a_team_removes_its_whole_tree(session_factory) -> None:
    """A cascade has to clear a tree in one statement, not trip over its own parents."""
    with session_factory() as session:
        team, root = _seed_team(session)
        left = _child(team, root, PlacementPosition.LEFT, "Left")
        session.add(left)
        session.flush()
        session.add(_child(team, left, PlacementPosition.RIGHT, "Grandchild"))
        session.commit()

        session.execute(text("DELETE FROM teams WHERE id = :id"), {"id": team.id})
        session.commit()
        assert session.scalar(text("SELECT count(*) FROM members")) == 0


def test_a_member_with_children_cannot_be_deleted_on_its_own(session_factory) -> None:
    with session_factory() as session:
        team, root = _seed_team(session)
        left = _child(team, root, PlacementPosition.LEFT, "Left")
        session.add(left)
        session.commit()

        with pytest.raises(IntegrityError):
            session.execute(text("DELETE FROM members WHERE id = :id"), {"id": root.id})
            session.commit()


def test_a_member_cannot_point_at_a_missing_parent(session_factory) -> None:
    with session_factory() as session:
        team, _ = _seed_team(session)
        session.add(
            Member(
                team_id=team.id,
                name="Orphan",
                placement_parent_id=uuid.uuid4(),
                placement_position=PlacementPosition.LEFT,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


# --- request session behaviour -----------------------------------------------------------


class _FakeRequest:
    def __init__(self, factory: sessionmaker[Session]) -> None:
        self.app = type("App", (), {"state": type("State", (), {"session_factory": factory})})


def _count(session_factory) -> int:
    with session_factory() as session:
        return session.scalar(text("SELECT count(*) FROM user_profiles"))


def test_request_session_rolls_back_when_handler_fails(session_factory) -> None:
    dependency = get_db(_FakeRequest(session_factory))  # type: ignore[arg-type]
    session = next(dependency)
    session.add(UserProfile(clerk_user_id="user_rollback"))
    session.flush()

    with pytest.raises(RuntimeError):
        dependency.throw(RuntimeError("handler failed"))

    assert _count(session_factory) == 0


def test_request_session_discards_uncommitted_work(session_factory) -> None:
    dependency = get_db(_FakeRequest(session_factory))  # type: ignore[arg-type]
    session = next(dependency)
    session.add(UserProfile(clerk_user_id="user_uncommitted"))
    session.flush()

    with pytest.raises(StopIteration):
        next(dependency)  # request finished without commit

    assert _count(session_factory) == 0


def test_request_session_keeps_committed_work(session_factory) -> None:
    dependency = get_db(_FakeRequest(session_factory))  # type: ignore[arg-type]
    session = next(dependency)
    session.add(UserProfile(clerk_user_id="user_committed"))
    session.commit()

    with pytest.raises(StopIteration):
        next(dependency)

    assert _count(session_factory) == 1


def test_connections_return_to_the_pool(session_factory, db_engine: Engine) -> None:
    for _ in range(db_engine.pool.size() * 3):
        dependency = get_db(_FakeRequest(session_factory))  # type: ignore[arg-type]
        next(dependency).execute(text("SELECT 1"))
        with pytest.raises(StopIteration):
            next(dependency)
    assert db_engine.pool.checkedout() == 0
