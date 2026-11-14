# UrLynk API

FastAPI backend for UrLynk. PostgreSQL is the permanent store; Clerk session tokens are
verified here with Clerk's public keys (JWKS). No Clerk secret key is needed.

## Layout

```
backend/
  app/
    main.py            App factory, lifespan (engine + token verifier), request logging, CORS
    core/config.py     Validated settings from environment variables / backend/.env
    core/security.py   Clerk token verification and JWKS cache (key rotation)
    core/errors.py     One JSON error shape for every failure
    core/logging.py    Logging setup (no tokens, credentials or query strings)
    db/base.py         Declarative base, constraint naming, timestamp columns
    db/session.py      Engine, connection pool, per-request session
    models/            SQLAlchemy models: user_profiles, teams, members, member_photos
    schemas/           Pydantic request and response models
    repositories/      Database access, always scoped by team
    services/          Business rules and transaction boundaries
    api/deps.py        get_current_user, get_current_team: the auth dependencies
    api/health.py      GET /health, GET /health/db
    api/v1/            Routers: me, auth, teams, members
  alembic/             Migrations (versions/ holds each revision)
  tests/               pytest suite
```

Requests flow in one direction: router -> service -> repository -> database. A router
applies the auth dependency and validates input; a service owns the rules and the
transaction; a repository owns the SQL and always filters by `team_id`.

## Endpoints

| Method | Path                                 | Auth   | Purpose                                                        |
| ------ | ------------------------------------ | ------ | -------------------------------------------------------------- |
| GET    | `/health`                            | none   | Liveness. Does not touch the database.                         |
| GET    | `/health/db`                         | none   | Runs `SELECT 1`. 200 when reachable, 503 otherwise.            |
| GET    | `/api/v1/me`                         | Bearer | The verified Clerk user ID and session ID. No database access. |
| POST   | `/api/v1/auth/initialize`            | Bearer | Idempotent first-login setup: profile, team and root member.   |
| GET    | `/api/v1/teams/me`                   | Bearer | The caller's team, its root member and its three counts.       |
| GET    | `/api/v1/members`                    | Bearer | One bounded, keyset-paginated page of the caller's team.       |
| POST   | `/api/v1/members`                    | Bearer | Register a member in a free LEFT or RIGHT slot.                |
| GET    | `/api/v1/members/recent`             | Bearer | The newest registrations, newest first. Bounded; excludes the root. |
| GET    | `/api/v1/members/search`             | Bearer | Find members by name or Mi Lifestyle ID. Bounded and paged.    |
| GET    | `/api/v1/members/{id}`               | Bearer | One member, with its parent, sponsor and slot availability.    |
| GET    | `/api/v1/members/{id}/placement-path`| Bearer | The exact root-to-member chain, with each LEFT/RIGHT step.     |
| PATCH  | `/api/v1/members/{id}`               | Bearer | Partial edit of a member's own details. Nothing structural.    |
| GET    | `/api/v1/members/{id}/children`      | Bearer | That member's two direct positions. `null` means free.         |
| GET    | `/api/v1/members/{id}/deletion-plan` | Bearer | Read-only preview of a reorganizing deletion. Writes nothing.  |
| POST   | `/api/v1/members/{id}/deletion`      | Bearer | Reorganize and delete, in one transaction. Needs a plan token. |
| GET    | `/api/v1/members/{id}/photo`         | Bearer | The member's profile photo as a data URI.                      |
| PUT    | `/api/v1/members/{id}/photo`         | Bearer | Set or replace the photo (base64, ≤ 64 KB, JPEG/PNG/WebP).     |
| DELETE | `/api/v1/members/{id}/photo`         | Bearer | Remove the photo. Removing a missing one is not an error.      |
| GET    | `/docs`                              | none   | Interactive API docs (disabled when `APP_ENV=production`).     |

`PATCH /api/v1/members/{id}` has partial-update semantics: a field left out of the body
keeps its stored value, and an explicit `null` clears an optional one. `name` can be
changed but not cleared. The schema uses `extra="forbid"`, so a request naming
`team_id`, `id`, `is_root`, `placement_parent_id`, `placement_position`,
`photo_updated_at` or any Clerk identifier is refused with 422 rather than ignored — an
ordinary profile edit can never move a member, change their side, make them a leader or
reach another team. Placement changes are a separate operation, in a later phase.

The leader's own record is the root member, so the same endpoint maintains their
preferred name, photo and Mi Lifestyle ID. It is
independent of Clerk: `POST /api/v1/auth/initialize` never renames an existing root
member, so a later sign-in cannot put the Google account's name back over a saved one.

Errors always look like:
`{"error": {"code": "invalid_token", "message": "...", "request_id": "..."}}`

Codes a client is expected to act on:

| Code                      | Status | Meaning                                                      |
| ------------------------- | ------ | ------------------------------------------------------------ |
| `not_authenticated`       | 401    | No bearer token.                                             |
| `invalid_token`           | 401    | The token did not verify.                                    |
| `token_expired`           | 401    | Mint a fresh token and retry.                                |
| `team_not_initialized`    | 404    | Call `POST /api/v1/auth/initialize`, then retry.             |
| `member_not_found`        | 404    | Not in the caller's team (or does not exist — the same thing from outside). |
| `parent_not_found`        | 404    | The placement parent is not in the caller's team.            |
| `sponsor_not_found`       | 404    | The sponsor is not in the caller's team.                     |
| `photo_not_found`         | 404    | The member has no photo. Show their initials; not a failure. |
| `sponsor_invalid`         | 422    | A member cannot be recorded as their own sponsor.            |
| `invalid_photo`           | 422    | Not readable as an image of the declared type.               |
| `photo_too_large`         | 422    | Over the 64 KB limit. Resize before uploading.               |
| `placement_occupied`      | 409    | That LEFT/RIGHT slot is taken. Nothing was overwritten.      |
| `mi_lifestyle_id_taken`   | 409    | Another member of this team already has that ID.             |
| `placement_chain_invalid` | 409    | The chain does not reach the root; the branch needs attention. Raised when placing a member under such a parent, and when a placement path is asked for. |
| `member_has_children`     | 409    | Use the deletion-plan route; a plain `DELETE` never reorganizes.  |
| `root_member_undeletable` | 409    | The leader's own record. Never deletable, by either route.    |
| `member_sponsors_others`  | 409    | Another record names them as sponsor. Change that sponsor first. |
| `invalid_promotion_choice`| 422    | `promote_member_id` is not one of this member's direct children, or is missing when they have children. |
| `reorganization_preview_stale` | 409 | The team changed since the preview. Nothing was written; fetch the plan again. |
| `reorganization_conflict` | 409    | The result would not have been a sound tree. The whole transaction rolled back. |
| `invalid_cursor`          | 400    | The pagination cursor was not one this API issued.           |
| `search_query_required`   | 422    | The search query was blank. Nothing was searched for.        |
| `placement_path_too_deep` | 409    | The chain is longer than 1,000 steps and is not returned.    |
| `validation_error`        | 422    | Field-level problems, listed in `error.details`.             |

## Deleting a member who has a branch below them

`DELETE /api/v1/members/{id}` removes one member and never more, so it refuses anyone
with people placed below them (`member_has_children`). Removing such a member without
losing anybody is a separate, two-request operation:

1. `GET /api/v1/members/{id}/deletion-plan[?promote=<child id>]` — what would happen.
   Read-only: no row is written, no position is reserved, and no record is kept that it
   was asked for. With two children, `requires_promotion_choice` is true until `promote`
   names one of them.
2. `POST /api/v1/members/{id}/deletion` with `{"promote_member_id": ..., "plan_token": ...}`
   — carry it out.

What the operation does: the promoted child takes the deleted member's placement parent
and side, keeping their own children exactly where they are. The other child, with
everyone below them, is reattached at the first free position under the promoted member,
found **breadth-first, LEFT before RIGHT** — the shallowest such position, and the
leftmost at that depth. Every surviving member keeps their ID, their details, their
photo, their sponsor and their own branch; exactly one member is removed and exactly one
parent-child relationship is created.

The destination is never accepted from a client. It is recalculated inside the
transaction that applies it. `plan_token` is a fingerprint of the structural facts of
the plan: the server rebuilds the plan under lock, fingerprints it again and compares,
so a confirmation of a plan the tree has outgrown is refused
(`reorganization_preview_stale`) rather than applied to something the leader never saw.
Editing a member's name or phone number does not invalidate a plan, because it does not
change what the operation would do.

Locking: every operation that changes the shape of a tree — registering a member,
deleting one, and this — first takes the team's structural lock (a `FOR UPDATE` on the
team's own row), then the member rows it will write. One lock per team, always in that
order, so two structural changes in a team are serialized without any possibility of a
deadlock, and different teams never wait for each other. Locking only the target member
would not be enough: a registration under *any* member of the searched subtree could
otherwise fill the destination between the search and the write.

Promoting a child into the deleted member's position is a swap, and no ordering of the
individual statements satisfies every rule at every step. The slot constraint is
therefore `DEFERRABLE INITIALLY IMMEDIATE` (migration 0006) and this one operation
defers it, re-arming it before the invariants are checked so that a duplicate slot is a
handled conflict rather than an error out of `COMMIT`. Default behaviour is unchanged
everywhere else, and every committed state still satisfies the constraint.

## Finding a member, and the path down to them

`GET /api/v1/members/search?q=` matches a **name** anywhere within it and without regard
to case, and — when the query is made entirely of digits — the **start of a Mi Lifestyle
ID**. An identifier is exactly ten digits, so typing the first few narrows it down and
typing all ten finds exactly one member; leading zeros are matched as typed, since the
column is text and is never parsed as a number. Letters are never matched against
identifiers, which spares a comparison per row for a hit that cannot exist. `%` and `_`
are escaped, so they are searched for rather than acting as wildcards.

Results are ordered by `(lower(name), id)`: alphabetical and total, so two identical
requests return the same order and paging cannot repeat or skip a member. Deliberately
not relevance-ranked — an order a leader can scan is worth more than one that reshuffles
as they type. Pages are bounded (default 25, maximum 50) and continued with
`next_cursor`. A blank query is refused (`search_query_required`) rather than answered
with the whole team.

**No index was added for it.** `ILIKE '%term%'` is not a prefix, so no B-tree can serve
it; the alternative is a pg_trgm GIN index, which means an extension and a migration. At
V1's stated scale the planner filters one team's rows and top-N sorts a bounded page —
measured at **1.6 ms of database time over a team of 1,001** (`tests/test_performance.py`
prints the plan and the timings with `-s`). The plan is printed by the test suite so the
decision can be revisited with evidence if teams grow well past that.

`GET /api/v1/members/{id}/placement-path` returns the exact chain from the team's root
down to one member: `steps` root first, the member last, and each step's
`placement_position` is the side it occupies under the step before it (the root has
none). It is one recursive walk up the real `placement_parent_id` edges plus one read for
the members on it — never a request per ancestor, and never a download of the tree. The
walk carries its path, so a cycle stops it: a chain that does not reach the root is
refused (`placement_chain_invalid`) rather than returned as a partial path, and one
longer than 1,000 steps is refused (`placement_path_too_deep`). Measured at **110 ms for
a 400-step leg**.

## Team and member rules

Every rule below is enforced by PostgreSQL, not only by application code, so a bug in
a service cannot corrupt a team's structure:

- **One team per leader** — `teams.owner_user_id` is unique.
- **One root per team** — partial unique index `members (team_id) WHERE is_root`.
- **The root has no placement; everyone else has both** — `ck_members_root_has_no_placement`.
- **One LEFT and one RIGHT child per parent** — `uq_members_placement_parent_id_placement_position`
  (`DEFERRABLE INITIALLY IMMEDIATE` since migration 0006, so the default is still an
  immediate check; only the reorganizing deletion defers it, and only within its own
  transaction).
- **No self-parenting or self-sponsoring** — `ck_members_placement_parent_not_self`, `ck_members_sponsor_not_self`.
- **Placement parents and sponsors stay inside the team** — composite foreign keys on
  `(team_id, placement_parent_id)` and `(team_id, sponsor_id)` against `(team_id, id)`.
- **Mi Lifestyle IDs are unique per team, case-insensitively** — partial unique index on
  `(team_id, lower(mi_lifestyle_id))`. Stored as text, so leading zeros survive.
- **A photo belongs to a member of its own team** — `member_photos` carries `team_id`
  beside `member_id` as a composite foreign key against `(team_id, id)`, and its
  `CHECK` constraints bound the size and confine the content type.

Multi-member cycles are the one rule a constraint cannot express. `create_member`
walks the parent's chain upwards (a recursive query that carries its path, so a cycle
stops it) and refuses to build on a branch that does not reach the root.

Authorization never reads a team from the request. `get_current_team` resolves it from
the verified token's subject, and every member query is filtered by that team, so a
member ID belonging to another leader is indistinguishable from one that does not exist.

## Windows notes (this development machine)

Windows **Smart App Control** is enabled here. It blocks some unsigned files that pip
installs, which shapes these instructions:

- **Never run `.venv\Scripts\alembic.exe` or `uvicorn.exe`** (pip's launcher programs are
  blocked). Always use `.\.venv\Scripts\python.exe -m alembic` / `-m uvicorn` / `-m pytest`.
- psycopg's compiled build is blocked, so on Windows psycopg runs in pure-Python mode and
  needs **`libpq.dll` from a PostgreSQL installation on `PATH`** (step 1 below).
  `requirements.txt` installs the compiled build only on non-Windows systems (e.g. Render).
  Without it the API cannot start and every test errors with `libpq library not found`,
  because building the database engine loads psycopg, even for endpoints that never query.
- SQLAlchemy is pinned to 2.0.x, which falls back to pure Python when its compiled
  extensions are blocked.
- Calling `.venv\Scripts\python.exe` directly avoids needing `Activate.ps1`.

## Local setup (Windows PowerShell, no Docker)

All commands run from the `backend` folder: `cd C:\Users\PALANI\UrLynk\backend`

### 1. Install PostgreSQL 17

This is a system-wide install: it needs administrator approval (a UAC prompt) and adds a
Windows service that starts with the computer. PostgreSQL 17 is the recommended version:
it is current, supported by managed providers, and newer than the 13+ the schema needs
(`gen_random_uuid()`).

```powershell
winget install --id PostgreSQL.PostgreSQL.17 --exact --interactive
```

`--interactive` opens the EDB installer so you choose the settings yourself:

| Installer page          | Choose                                                    |
| ----------------------- | --------------------------------------------------------- |
| Components              | PostgreSQL Server, Command Line Tools. Untick pgAdmin 4 and Stack Builder (not needed). |
| Data directory          | Keep the default.                                         |
| Password                | A password for the `postgres` superuser. Keep it to yourself; the app never uses it. |
| Port                    | `5432`                                                    |
| Locale                  | Default locale.                                           |
| Finish                  | Untick "Launch Stack Builder".                            |

Add PostgreSQL's `bin` folder to your **user** `PATH` (for `psql` and psycopg's
`libpq.dll`). This changes only your account, not the system:

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Program Files\PostgreSQL\17\bin", "User")
```

**Close and reopen VS Code / the terminal**, then check:

```powershell
psql --version                                   # psql (PostgreSQL) 17.x
Get-Service postgresql-x64-17                    # Status: Running
cd C:\Users\PALANI\UrLynk\backend
.\.venv\Scripts\python.exe -c "import psycopg; print(psycopg.pq.__impl__, psycopg.pq.version())"
# python 170000-something: psycopg found libpq.dll
```

### 2. Create the database user and databases

`psql` prompts for the `postgres` password from step 1 each time. Choose a password for
the `urlynk` role and put it in place of `choose-a-password`. **Use only letters and digits**
so it can go into `DATABASE_URL` as is (characters such as `@ : / ? # %` would need
URL-encoding).

```powershell
psql -U postgres -h localhost -c "CREATE ROLE urlynk LOGIN PASSWORD 'choose-a-password';"
psql -U postgres -h localhost -c "CREATE DATABASE urlynk OWNER urlynk;"
psql -U postgres -h localhost -c "CREATE DATABASE urlynk_test OWNER urlynk;"
```

Check the app role can log in: `psql -U urlynk -h localhost -d urlynk -c "SELECT current_user;"`

### 3. Configure `backend/.env`

Copy `.env.example` to `.env` if it does not exist, then set at least:

- `DATABASE_URL=postgresql://urlynk:<your password>@localhost:5432/urlynk`
- `CLERK_ISSUER=` your Clerk Frontend API URL (Clerk Dashboard -> API keys). It must be
  the same Clerk instance as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in the project root `.env`.

`backend/.env` is git-ignored. Do not paste its contents anywhere.

### 4. Install Python dependencies

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

### 5. Apply migrations

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current     # shows: 0002 (head)
psql -U urlynk -h localhost -d urlynk -c "\d members"
```

The data lives in PostgreSQL's data directory, so it survives API and computer restarts.
To confirm, restart the service (`Restart-Service postgresql-x64-17` in an administrator
terminal, or reboot) and run `alembic current` again: it still shows `0002 (head)`.

### 6. Start the API

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check it in another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/health/db
```

### 7. Reach it from the phone over USB

The phone reaches the laptop through the USB cable, just like Metro. `adb` is not on
`PATH` on this machine, so use its full path:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices                       # the phone is listed as "device"
& $adb reverse tcp:8000 tcp:8000     # API
& $adb reverse tcp:8082 tcp:8082     # Metro, if started with --port 8082 (Expo's default is 8081)
& $adb reverse --list
```

`adb reverse` forwards the phone's `localhost:8000` to this computer's `127.0.0.1:8000`
through USB. The API binds only to `127.0.0.1`, so it is not reachable over Wi-Fi or the
local network. Run the `reverse` commands again whenever the phone reconnects.

The project root `.env` must contain `EXPO_PUBLIC_API_URL=http://localhost:8000`; restart
Metro after changing it (values are inlined at bundle time). Debug builds allow plain
`http://`; release builds require `https://`.

### 8. End-to-end check from the phone (temporary, development only)

`src/app/dev-api-check.tsx` is a debug-build-only screen that calls the API with the real
Clerk session token and shows only pass/fail results; the token is never displayed or
logged. With the API running, Metro running, the reverse forwards in place and the app
signed in:

```powershell
& $adb shell am start -a android.intent.action.VIEW -d "urlynk://dev-api-check" com.jdaloo.UrLynk
```

Tap **Run checks**. All six should pass: `/health`, `/health/db`, `/api/v1/me` refused
without a token, refused with a forged token, accepted with the session token (user and
session IDs match Clerk), and accepted with a freshly minted token. Delete the screen and
its `Stack.Screen` entry in `src/app/_layout.tsx` once the API is trusted end to end;
it is still useful for confirming that a device can reach a newly started backend.

### 9. Walk the team workflows on the phone

With the API and Metro running and the reverse forwards in place, sign in and:

1. **Home** shows Total / Left / Right. A brand-new account reads 1 / 0 / 0 — the team
   is created on the first load, with the leader as its root member.
2. **Team** shows the leader card with a `ROOT` badge and two open positions.
3. Tap an open position. **Add Member** opens with that parent and side already chosen.
4. Save a member with a name only, then one with a Mi Lifestyle ID beginning `00`;
   confirm the ID keeps its leading zeros on the member's detail screen.
5. Try the same Mi Lifestyle ID again — expect a message on that field, not a crash.
6. Try the position you just filled — expect "Already taken", with the field disabled.
7. Pull to refresh on Home and Team; the counts should match the structure.
8. Stop the API and pull to refresh: expect "You appear to be offline" and a retry
   action, with positions reading "Not available" rather than claiming to be open.
9. Sign out and in as a second account: it gets its own empty team, and none of the
   first account's numbers or members appear.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Database tests are skipped unless `TEST_DATABASE_URL` is set. They migrate the schema
down and up and truncate every table between tests, so they refuse to run unless the
database name contains `test`:

```powershell
$env:TEST_DATABASE_URL = "postgresql://urlynk:<your password>@localhost:5432/urlynk_test"
.\.venv\Scripts\python.exe -m pytest
```

Tests never need real Clerk credentials: they sign tokens with throwaway keys.

Every test needs `libpq.dll` on `PATH` (step 1), even those that do not use a database.

| Module                        | Covers                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| `test_config.py`              | Settings validation and production rules.                     |
| `test_health.py`              | Liveness and database health.                                 |
| `test_auth.py`                | Clerk token verification, JWKS caching and key rotation.      |
| `test_database.py`            | Migrations, and every team/member constraint, in PostgreSQL.   |
| `test_team_initialization.py` | First login, returning login, idempotency, concurrent setup.  |
| `test_members.py`             | Placement, validation, pagination, counts, persistence.       |
| `test_member_updates.py`      | PATCH: partial edits, refused fields, duplicates, isolation.  |
| `test_member_photos.py`       | Photos: round trip, size and format limits, isolation.        |
| `test_member_schemas.py`      | The request schemas on their own: every field rule.            |
| `test_member_deletion.py`     | DELETE: eligibility, refusals, photos, isolation.              |
| `test_member_reorganization.py` | Reorganizing deletion: promotion, reattachment, staleness.   |
| `test_member_search.py`       | Search: matching, ordering, paging, validation, isolation.    |
| `test_placement_path.py`      | Placement path: ordering, LEFT/RIGHT edges, cycles, bounds.   |
| `test_recent_members.py`      | Recently Added: ordering, bounds, the root's exclusion.       |
| `test_dashboard.py`           | Dashboard: branch counts at every depth, and after every change. |
| `test_team_isolation.py`      | One leader against another: reads, writes, cursors, switching. |
| `test_performance.py`         | A team of 1,000 and a 400-deep leg, with timings printed.      |

`test_performance.py` prints what it measured; run it with `-s` to see the numbers:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_performance.py -s
```

Lint and format:

```powershell
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

## Creating a migration

After changing a model:

```powershell
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "describe the change"
```

Review the generated file before applying it. `tests/test_database.py` fails if models and
migrations drift apart.

## Token verification rules

A request to a protected endpoint is accepted only if the bearer token:

- is signed with **RS256** by a key in Clerk's JWKS (`CLERK_ISSUER/.well-known/jwks.json`),
  matched by `kid`; other algorithms, including `none` and `HS256`, are refused;
- has `iss` exactly equal to `CLERK_ISSUER`;
- has `exp`, `iat`, `iss` and `sub`, is not expired, and is past `nbf` (5 s leeway);
- has an `azp` in `CLERK_AUTHORIZED_PARTIES`, when both are present
  (Clerk omits `azp` when the request had no Origin header, as in native apps);
- is not for a `pending` session (`sts`), matching Clerk's SDK default.

Keys are cached for an hour. An unknown `kid` triggers a refetch (Clerk rotated keys),
at most once a minute. If Clerk's JWKS cannot be fetched and no keys are cached, the API
returns **503 `auth_unavailable`** rather than 401, so clients do not treat an outage as
an invalid session.
