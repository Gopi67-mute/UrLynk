"""Pydantic request and response models.

Request models set `extra="forbid"`, so a client that tries to smuggle a field the
endpoint does not accept (a `team_id`, an `is_root`) is rejected with 422 instead of
having it quietly ignored. Authorization never reads anything from a request body.
"""
