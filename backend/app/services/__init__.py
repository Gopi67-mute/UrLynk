"""Business rules and transaction boundaries.

Routers call these; services call repositories. A service receives the caller's own
`Team` (resolved from the verified token by `app.api.deps.get_current_team`) and never
a team identifier taken from a request.
"""
