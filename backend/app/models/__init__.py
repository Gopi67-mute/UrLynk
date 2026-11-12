"""Importing this package registers every model on Base.metadata (Alembic relies on it)."""

from app.models.member import Member, PlacementPosition
from app.models.member_photo import MemberPhoto
from app.models.team import Team
from app.models.user_profile import UserProfile

__all__ = ["Member", "MemberPhoto", "PlacementPosition", "Team", "UserProfile"]
