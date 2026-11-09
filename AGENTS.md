# UrLynk — Complete Technical Architecture

**Project:** UrLynk  
**Product:** Private Team Growth Platform  
**Tagline:** Connect. Lead. Grow.  
**Platform:** Android (V1)  
**Architecture:** Cloud-backed mobile application  
**Status:** Approved architecture for V1

---

# 1. ARCHITECTURE OVERVIEW

UrLynk is a multi-tenant mobile application where independent team leaders can create, manage, and maintain their own private binary team structures.

Each leader uses the same Android application but accesses only their own team.

The application uses a cloud-based backend and PostgreSQL database for permanent storage. Local SQLite is used exclusively for offline data viewing and caching.

### Technology Stack

Mobile:

- React Native
- Expo
- TypeScript
- Expo Router
- TanStack Query
- Expo SQLite
- Expo SecureStore
- Clerk React Native SDK

Backend:

- Python
- FastAPI
- SQLAlchemy
- Alembic
- Pydantic

Database:

- PostgreSQL

Infrastructure:

- Render (or equivalent always-on hosting)
- Managed cloud PostgreSQL
- GitHub
- Expo EAS

Communication:

- HTTPS
- REST API
- JSON
- Bearer token authentication

Do not replace these technologies without presenting a technical justification and obtaining approval.

---

# 2. SYSTEM ARCHITECTURE

The application must follow this architecture:

Android Application
|
| React Native + Expo
|
|-----------------------------|
| |
Authentication Local Storage
| |
Clerk SDK Expo SQLite
| Expo SecureStore
|
| HTTPS REST API
| Authorization: Bearer Token
|
FastAPI Backend
|
| Authentication Verification
| Authorization
| API Routers
| Business Services
| Data Access Layer
|
SQLAlchemy ORM
|
PostgreSQL Database
|
Permanent Cloud Storage

The backend is the only component authorized to communicate with PostgreSQL.

The mobile application must never connect directly to the production database.

---

# 3. AUTHENTICATION SYSTEM

## 3.1 Authentication Provider

Use Clerk for authentication and identity management.

Clerk is responsible for:

- User registration.
- Login and logout.
- Email verification.
- Session management.
- Authentication tokens.
- Session restoration.
- Password recovery where supported by the configured authentication methods.

Do not implement custom password storage or authentication when Clerk already provides the functionality.

## 3.2 Authentication Flow

1. The user opens UrLynk.
2. The application checks the existing Clerk authentication session.
3. If no valid session exists, display authentication screens.
4. The user registers or signs in.
5. Clerk establishes the authenticated session.
6. The application obtains a valid session token using the supported Clerk SDK.
7. The token is attached to protected API requests.
8. FastAPI verifies the token.
9. The backend extracts the authenticated Clerk subject (`sub`).
10. The backend resolves the corresponding application profile and team.
11. The application loads the authenticated leader's team.

## 3.3 Backend Authentication Verification

FastAPI must independently verify every protected request.

Verification must include:

- JWT signature.
- Trusted Clerk issuer.
- Expiration.
- Relevant audience or authorized-party claims according to the configured Clerk integration.
- Valid subject claim.

Never trust user identity supplied through request-body fields.

The authenticated identity must come from the verified token.

## 3.4 Session Handling

Implement:

- Persistent authenticated sessions through Clerk's supported SDK.
- Session restoration after application restart.
- Expired-token handling.
- Sign-out.
- Account-switch handling.
- Unauthorized API response handling.

Do not implement a separate, conflicting authentication session system.

---

# 4. USER PROFILE AND TEAM INITIALIZATION

Each authenticated leader must have one application profile and one private team in V1.

## First Login Flow

When a leader authenticates for the first time:

1. Backend identifies the leader using the verified Clerk subject.
2. Check whether the application profile already exists.
3. If it does not exist, create the profile.
4. Check whether the leader already owns a team.
5. If no team exists, create the private team.
6. Create the root leader member record.
7. Link the root member to the team.
8. Return the team and profile information.
9. The application displays the dashboard.

## Returning Login Flow

When an existing leader signs in:

1. Verify authentication.
2. Retrieve the existing profile.
3. Retrieve the existing team.
4. Do not create another team.
5. Synchronize existing data.
6. Display the dashboard.

Team initialization must be idempotent and protected against duplicate requests and concurrent first-login attempts.

Use database constraints and transactions to guarantee one team per leader.

---

# 5. PERMANENT DATA STORAGE

## 5.1 PostgreSQL — Primary Database

PostgreSQL is the permanent source of truth.

Store:

- Leader application profiles.
- Team information.
- Member records.
- Sponsor relationships.
- Binary placement relationships.
- Member joining information.
- Team activity and audit history.
- Necessary synchronization metadata.

All permanent modifications must be performed through the authorized FastAPI backend.

## 5.2 Expo SQLite — Local Cache

SQLite is used for:

- Cached dashboard information.
- Cached member directory.
- Previously synchronized branch information.
- Cached member details.
- Last synchronization timestamps.
- Local cache version metadata.

SQLite is not the permanent database.

Do not allow offline database mutations in V1.

## 5.3 Expo SecureStore

Use SecureStore only for appropriate small sensitive local values when required.

Clerk's supported SDK must manage its authentication session storage.

Never store:

- PostgreSQL credentials.
- Backend secrets.
- Clerk secret keys.
- Private API credentials.

## 5.4 Account Isolation in Local Storage

Every cached record must be associated with the authenticated account and, where appropriate, its team.

When the user signs out or switches accounts:

- Prevent the previous account's data from appearing.
- Clear or invalidate account-specific cached data according to the cache policy.
- Reset account-specific TanStack Query state.
- Never expose another leader's cached information.

---

# 6. DATABASE ARCHITECTURE

Use PostgreSQL with SQLAlchemy ORM and Alembic migrations.

Initial core tables:

## 6.1 user_profiles

Purpose: Store UrLynk application profiles.

Suggested fields:

- id
- clerk_user_id
- display_name
- email (only when needed)
- created_at
- updated_at

Constraints:

- `clerk_user_id` must be unique.

## 6.2 teams

Purpose: Store private leader-owned teams.

Suggested fields:

- id
- owner_user_id
- team_name
- root_member_id (if used by the finalized schema)
- created_at
- updated_at

Constraints:

- One team per leader in V1.
- Owner must reference an existing application profile.

## 6.3 members

Purpose: Store team members and their relationships.

Suggested fields:

- id
- team_id
- name
- mi_lifestyle_id
- phone_number (optional)
- sponsor_id (nullable)
- placement_parent_id (nullable)
- placement_position (nullable)
- joining_date (optional)
- notes (optional)
- status (if required)
- created_at
- updated_at

Constraints:

- Every member belongs to exactly one team.
- Member identifiers must be unique within their team, subject to the confirmed identifier rules.
- A member can have at most one placement parent.
- A placement parent can have at most one LEFT child and one RIGHT child.
- Sponsor and placement relationships must be independent.
- All references must remain inside the same team.
- Root member must not have a placement parent or placement position.

Preserve leading zeros in Mi Lifestyle IDs.

Do not assume the official identifier format without verification.

## 6.4 audit_logs

Purpose: Record important team operations.

Suggested fields:

- id
- team_id
- actor_user_id
- affected_member_id (nullable)
- action_type
- previous_values (where appropriate)
- new_values (where appropriate)
- metadata
- created_at

Audit events must reflect real operations, not fabricated activity.

## 6.5 sync_metadata

Create this table only if needed by the selected synchronization design.

It may track:

- Team version.
- Last update sequence.
- Synchronization timestamps.
- Cache invalidation information.

Do not introduce unnecessary tables.

---

# 7. BINARY TREE AND RELATIONSHIP ENGINE

This is a critical business-logic component.

UrLynk maintains two separate relationship systems.

## 7.1 Sponsor Relationship

Represents who introduced or sponsored a member.

Rules:

- A sponsor may sponsor multiple members.
- Sponsor hierarchy is independent of binary placement.
- Sponsor changes must not automatically change binary placement.

## 7.2 Binary Placement Relationship

Represents the actual LEFT/RIGHT team structure.

Rules:

- One root member per initialized team.
- Each parent can have one LEFT child.
- Each parent can have one RIGHT child.
- Every non-root member has one placement parent.
- No member can be its own parent.
- No cycles are permitted.
- All placement references must belong to the same team.

## 7.3 Placement Changes

Placement operations must be implemented in backend services.

Before moving a member:

1. Validate the authenticated leader and team.
2. Load the member and target parent.
3. Verify team ownership.
4. Validate the target position.
5. Check whether the target slot is occupied.
6. Check for circular relationships.
7. Verify subtree integrity.
8. Apply the operation transactionally.
9. Preserve all descendants.
10. Record an audit event.
11. Return the updated hierarchy.

Never implement placement changes as a simple client-side parent ID update.

Use database constraints and appropriate locking/concurrency controls.

The application must require explicit confirmation before a placement change.

---

# 8. BACKEND ARCHITECTURE

Use FastAPI with separated responsibilities.

Recommended structure:

backend/
app/
main.py

        api/
            v1/
                routers/

        core/
            config.py
            security.py
            exceptions.py

        models/
            user.py
            team.py
            member.py
            audit_log.py

        schemas/
            user.py
            team.py
            member.py

        services/
            authentication_service.py
            team_service.py
            member_service.py
            placement_service.py
            dashboard_service.py
            synchronization_service.py

        repositories/
            user_repository.py
            team_repository.py
            member_repository.py

        db/
            session.py
            base.py

        middleware/

        tests/

    alembic/
    alembic.ini
    requirements.txt

This is a proposed structure. Adjust it based on the actual implementation rather than creating empty or unnecessary modules.

## Layer Responsibilities

API routers:

- Receive HTTP requests.
- Apply authentication dependencies.
- Validate inputs.
- Call services.
- Return structured responses.

Authentication:

- Verify Clerk tokens.
- Resolve authenticated identities.

Authorization:

- Resolve the leader's team.
- Enforce team ownership.

Services:

- Implement business rules.
- Coordinate multi-step operations.
- Manage transactions.

Repositories:

- Encapsulate database access.
- Apply team-scoped queries.

Models:

- Define database representation and relationships.

Schemas:

- Validate request and response data.

---

# 9. API ARCHITECTURE

Use versioned REST APIs:

/api/v1/

Proposed API groups:

Authentication and profile:

- GET /api/v1/auth/me
- POST /api/v1/auth/initialize

Teams:

- GET /api/v1/teams/me
- GET /api/v1/teams/me/dashboard

Members:

- POST /api/v1/members
- GET /api/v1/members/{member_id}
- PATCH /api/v1/members/{member_id}
- GET /api/v1/members/search

Branches:

- GET /api/v1/branches/{member_id}

Placement:

- POST /api/v1/placements/move

Activity:

- GET /api/v1/activity

Synchronization:

- GET /api/v1/sync/status

These are proposed endpoint contracts, not existing implementations. Finalize their schemas, authorization, pagination and semantics before building dependent screens.

## API Requirements

- HTTPS only outside local development.
- JSON request and response bodies.
- Bearer token authentication.
- Pydantic validation.
- Consistent error responses.
- Appropriate HTTP status codes.
- Pagination for large collections.
- Bounded query results.
- No sensitive information in responses.
- No cross-team data leakage.

Never use client-side visibility rules as a replacement for backend authorization.

---

# 10. MOBILE DATA ARCHITECTURE

Use the following separation:

Screens
|
Reusable UI Components
|
Hooks
|
TanStack Query
|
Typed Data Services
|
Central API Client
|
FastAPI Backend

## Responsibilities

Screens:

- Display information.
- Handle user interaction.
- Avoid containing complex business logic.

Hooks:

- Encapsulate reusable application behavior.
- Connect UI to query and mutation operations.

TanStack Query:

- Manage server-state caching.
- Track loading and error states.
- Deduplicate requests.
- Invalidate and refresh affected data.

Data Services:

- Provide typed functions for API operations.
- Keep network operations out of screen components.

API Client:

- Centralize base URL.
- Attach Clerk session tokens.
- Handle timeouts.
- Normalize errors.
- Handle unauthorized responses.

Local Repository:

- Read and update SQLite cache.
- Keep local persistence independent of screen components.

Do not duplicate API request logic across screens.

---

# 11. DATA SYNCHRONIZATION

Use a cache-first, background-refresh approach.

## Returning User Flow

1. Restore the Clerk session.
2. Resolve the authenticated account.
3. Read permitted cached data from SQLite.
4. Render cached dashboard and directory information immediately.
5. Check network availability.
6. Request updated information from FastAPI.
7. Backend verifies the token and team ownership.
8. Backend retrieves current PostgreSQL records.
9. Mobile receives the latest response.
10. Update SQLite cache.
11. Update TanStack Query cache.
12. Refresh the visible UI.

## Offline Behavior

- Previously synchronized data remains viewable.
- Display an offline indicator.
- Display the last successful synchronization time where available.
- Disable all write operations.
- Do not queue offline changes in V1.
- Do not display stale cached information as live information.

## Synchronization Safety

- Handle interrupted requests.
- Avoid duplicate data creation.
- Use stable IDs.
- Use versioning or update timestamps where appropriate.
- Define cache invalidation rules.
- Handle account switching safely.

---

# 12. APPLICATION PERFORMANCE

Avoid the loading delays experienced in previous projects.

Requirements:

- Do not block app shell rendering on API requests.
- Render cached content immediately.
- Refresh in the background.
- Use FlatList or suitable virtualization for large lists.
- Use pagination.
- Load only the requested branch.
- Avoid unnecessary full-tree downloads.
- Avoid duplicate network calls.
- Optimize database indexes.
- Configure SQLAlchemy connection pooling.
- Use an always-on backend service for production.
- Use timeouts and controlled retries.
- Monitor API response times.

Initial targets to measure:

- Cached dashboard: under 1 second.
- Cached directory: under 1 second.
- Common API operations: p95 under 500 ms.

These are measurable acceptance targets, not guaranteed performance claims.

Test on a representative Android device and with a team containing at least 1,000 members.

---

# 13. SECURITY AND DATA PROTECTION

Mandatory requirements:

- Verify Clerk JWT tokens on the backend.
- Derive leader identity from the verified token subject.
- Never trust client-supplied team IDs.
- Scope every database operation by authorized team.
- Validate every related member reference.
- Prevent cross-team relationships.
- Keep database credentials server-side.
- Never expose backend secrets in the app.
- Use environment variables for configuration.
- Do not commit real secrets.
- Use HTTPS in production.
- Avoid sensitive information in logs.
- Clear or isolate account-specific local cache.
- Use database transactions for critical operations.

PostgreSQL Row-Level Security may be added as defense in depth.

If enabled, configure transaction-local tenant context safely and test pooled-connection reuse. RLS does not replace explicit backend authorization and query scoping.

---

# 14. ERROR HANDLING AND RELIABILITY

Handle these conditions explicitly:

Authentication:

- Expired session.
- Invalid token.
- Signed-out user.
- Unauthorized request.

Network:

- No internet.
- Request timeout.
- Server unavailable.
- Interrupted synchronization.

Database:

- Connection failure.
- Constraint violation.
- Transaction failure.
- Concurrent placement update.

Application:

- Invalid form input.
- Missing member.
- Occupied placement.
- Invalid hierarchy operation.
- Empty team or branch.

Show useful user-facing error messages.

Never silently swallow exceptions or return fabricated success responses.

Log technical details safely on the backend without exposing secrets or sensitive information.

---

# 15. DEPLOYMENT AND INFRASTRUCTURE

## Mobile

- Expo development environment.
- Expo EAS for Android APK builds.
- Separate development and production environment configuration.

## Backend

- FastAPI deployed on Render or an equivalent always-on service.
- HTTPS enabled.
- Health endpoint.
- Environment-based configuration.
- Secure database connection.
- Appropriate connection pooling.
- Production logging.

## Database

- Managed cloud PostgreSQL.
- Automated backups where supported.
- Migration management through Alembic.
- Appropriate indexes.
- Secure credentials.
- Tested restoration strategy.

## Configuration

Maintain separate development and production settings.

Mobile public configuration may contain:

- API base URL.
- Clerk publishable key.

Backend-only configuration may contain:

- Database connection URL.
- Clerk verification configuration.
- Private service credentials.
- Other backend secrets.

Never put backend secrets in EXPO*PUBLIC* variables.

---

# 16. TESTING REQUIREMENTS

Test the complete architecture.

Authentication:

- Registration.
- Login.
- Session restoration.
- Token verification.
- Expired sessions.

Tenant security:

- Leader A cannot access Leader B's team.
- Leader A cannot edit Leader B's members.
- Search cannot reveal another team's records.
- Cached data cannot leak after account switching.

Database:

- Unique constraints.
- Foreign keys.
- Transaction rollback.
- Migration correctness.

Binary hierarchy:

- Root initialization.
- LEFT and RIGHT placement.
- Duplicate position rejection.
- Cycle prevention.
- Subtree preservation.
- Cross-team relationship rejection.

Synchronization:

- Cache-first rendering.
- Background refresh.
- Offline viewing.
- Disabled offline writes.
- Interrupted synchronization.

Performance:

- Large team directory.
- Branch pagination.
- Search.
- Dashboard loading.
- Database query performance.

Never declare a feature complete without running its relevant tests.

---

# 17. IMPLEMENTATION RULES

Before implementing architecture-dependent features:

1. Read AGENTS.md.
2. Read PHASES.md.
3. Read this ARCHITECTURE.md.
4. Inspect the existing codebase.
5. Confirm the active phase and acceptance criteria.
6. Plan the affected files and dependencies.
7. Implement incrementally.
8. Run relevant tests.
9. Review security and data integrity.
10. Report actual results.

Do not implement the entire architecture in one uncontrolled operation.

Do not introduce unnecessary dependencies.

Do not overwrite existing files unnecessarily.

Do not perform destructive database operations without explicit approval.

Do not begin the next development phase without approval.

---

# 18. ARCHITECTURAL PRIORITIES

When making engineering decisions, follow this priority:

1. Tenant isolation and privacy.
2. Data integrity and relationship correctness.
3. Authentication and authorization.
4. Permanent data reliability.
5. Application responsiveness.
6. Offline read reliability.
7. Maintainability.
8. User experience and visual quality.

Any architectural change that affects authentication, database ownership, team isolation, permanent storage, or binary-tree integrity must be explained and approved before implementation.

**Final principle: PostgreSQL is the permanent source of truth, FastAPI is the trusted business and security layer, Clerk manages authentication, and the mobile application provides a fast, account-isolated user experience with local read caching.**
