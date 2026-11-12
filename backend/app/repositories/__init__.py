"""Database access, kept out of services and routers.

Every member query here takes a `team_id` and filters on it. Nothing in this package
looks a member up by ID alone, which is what makes cross-team reads (IDOR) impossible
to write by accident: the team always comes from the verified token.
"""
