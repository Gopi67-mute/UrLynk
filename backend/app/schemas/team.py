import uuid
from datetime import datetime
from typing import Annotated

from pydantic import StringConstraints, field_validator

from app.models.member import MEMBER_NAME_MAX_LENGTH
from app.schemas.common import RequestModel, ResponseModel
from app.schemas.member import MemberSummary

TEAM_NAME_MAX_LENGTH = 120

TeamName = Annotated[str, StringConstraints(min_length=1, max_length=TEAM_NAME_MAX_LENGTH)]
LeaderName = Annotated[str, StringConstraints(min_length=1, max_length=MEMBER_NAME_MAX_LENGTH)]


def _reject_control_characters(value: str) -> str:
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("That name contains characters that aren't allowed.")
    return value


class AccountInitializeRequest(RequestModel):
    """Optional labels for a first-time setup.

    Both are display text only and are never used to decide who the caller is: the
    identity always comes from the verified token. They are ignored once the team
    exists, so repeating the request cannot rename an existing team.
    """

    display_name: LeaderName | None = None
    team_name: TeamName | None = None

    @field_validator("display_name", "team_name")
    @classmethod
    def _check_text(cls, value: str | None) -> str | None:
        return None if value is None else _reject_control_characters(value)


class TeamSummary(ResponseModel):
    id: uuid.UUID
    team_name: str
    created_at: datetime


class TeamCounts(ResponseModel):
    """`total_members` counts the leader too, so it is always left + right + 1."""

    total_members: int
    left_members: int
    right_members: int


class TeamOverview(ResponseModel):
    """Everything the Team screen needs in one request."""

    team: TeamSummary
    root_member: MemberSummary
    counts: TeamCounts
