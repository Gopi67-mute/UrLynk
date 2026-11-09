# UrLynk — Development Roadmap & Implementation Phases

**Project:** UrLynk  
**Product:** Private Team Growth Platform  
**Tagline:** Connect. Lead. Grow.  
**Platform:** Android  
**Development Framework:** React Native + Expo + TypeScript  
**Backend:** Python + FastAPI  
**Database:** PostgreSQL  
**Authentication:** Clerk  
**Development Assistant:** Claude Code  
**Document Status:** Approved V1 Development Roadmap

---

# 1. PURPOSE OF THIS DOCUMENT

This document defines the complete development roadmap for UrLynk.

It establishes:

- The order in which features must be implemented.
- The responsibilities of each development phase.
- Required dependencies and integrations.
- Testing and verification requirements.
- Acceptance criteria for completing each phase.
- Rules for progressing between phases.

Claude Code must treat this document as the source of truth for implementation order.

The application must be developed incrementally.

Do not attempt to implement the entire application in one operation.

Do not skip phases or implement future-phase features without approval.

A phase is complete only after its acceptance criteria have been satisfied and verified.

---

# 2. GLOBAL DEVELOPMENT RULES

Before starting any phase:

1. Read `AGENTS.md`.
2. Read `ARCHITECTURE.md`.
3. Read this `PHASES.md`.
4. Inspect the current project structure.
5. Identify existing implementation and dependencies.
6. Review the current phase requirements.
7. Prepare an implementation plan.
8. Identify files and configurations that will be affected.

During implementation:

- Follow the approved architecture.
- Preserve existing working code.
- Implement only the active phase.
- Use TypeScript strictly.
- Write maintainable and reusable code.
- Avoid unnecessary dependencies.
- Implement proper loading and error states.
- Test all relevant functionality.
- Document important decisions.

After implementation:

1. Run relevant tests.
2. Run TypeScript checks.
3. Run lint checks where configured.
4. Review the changes.
5. Verify acceptance criteria.
6. Report completed work and unresolved issues.
7. Wait for approval before starting the next phase.

---

# 3. COMPLETE DEVELOPMENT ROADMAP

The project is divided into the following phases.

| Phase | Name                                      |
| ----- | ----------------------------------------- |
| 01    | Project Foundation & Environment          |
| 02    | Design System & Application UI Foundation |
| 03    | Authentication & Account Management       |
| 04    | Backend Foundation & Database             |
| 05    | User Profiles & Team Initialization       |
| 06    | Member Management                         |
| 07    | Binary Tree & Placement Engine            |
| 08    | Branch Explorer & Team Directory          |
| 09    | Dashboard & Team Activity                 |
| 10    | Local Persistence & Synchronization       |
| 11    | Security, Performance & Reliability       |
| 12    | Testing & Quality Assurance               |
| 13    | Production Deployment & APK Release       |

The phases may have internal tasks, but their overall order must be preserved.

A phase may be divided into smaller implementation tasks without changing its scope.

---

# PHASE 01 — PROJECT FOUNDATION & ENVIRONMENT

## Objective

Establish a clean, reliable, and maintainable development environment for UrLynk.

The initial Expo application has already been created.

Claude must inspect the existing scaffold before modifying it.

## Tasks

### 1.1 Inspect the existing project

- Inspect the Expo application structure.
- Identify the installed Expo SDK version.
- Inspect `package.json`.
- Inspect `app.json` or `app.config`.
- Inspect TypeScript configuration.
- Inspect existing assets.
- Identify existing dependencies.
- Identify generated files that should be preserved.

### 1.2 Establish project organization

Prepare a maintainable mobile application structure.

Organize:

- Application routes.
- Components.
- Hooks.
- Services.
- API client.
- Types.
- Constants.
- Configuration.
- Assets.
- Utilities.
- Local database modules.
- Tests.

Do not create unnecessary empty folders or abstractions.

### 1.3 Development tooling

Configure:

- TypeScript strict mode.
- ESLint.
- Prettier if appropriate.
- Consistent import conventions.
- Environment variable handling.
- Development scripts.
- Build configuration.

### 1.4 Backend workspace preparation

Determine and document the repository layout for the future FastAPI backend.

Do not install or implement the entire backend in this phase.

Prepare only what is necessary for a clean mobile/backend project organization.

## Acceptance Criteria

- Existing Expo application runs successfully.
- Project structure is understandable.
- TypeScript configuration works.
- Linting and formatting are configured.
- Dependencies are compatible.
- Environment configuration is documented.
- No unnecessary files or existing work have been removed.

## Completion Gate

Stop and report the project foundation, configuration, dependencies, and verification results.

Wait for approval.

---

# PHASE 02 — DESIGN SYSTEM & APPLICATION UI FOUNDATION

## Objective

Establish UrLynk's visual identity and reusable mobile interface components.

The approved UrLynk logo and brand direction must be respected.

## Tasks

### 2.1 Brand integration

Implement:

- UrLynk logo assets.
- Purple/lavender brand palette.
- Neutral background colors.
- Typography system.
- Consistent spacing.
- Corner radius system.
- Iconography conventions.

Do not recreate or replace the finalized logo without approval.

### 2.2 Reusable UI components

Create reusable components for:

- Buttons.
- Input fields.
- Cards.
- Headers.
- Navigation elements.
- Badges.
- Member cards.
- Branch indicators.
- Loading indicators.
- Empty states.
- Error states.
- Confirmation dialogs.
- Status indicators.

### 2.3 Navigation foundation

Implement the approved navigation structure using Expo Router.

Prepare routes for:

- Authentication.
- Dashboard.
- Branch Explorer.
- Team Directory.
- Member details.
- Member registration.
- Settings.

Protect authenticated routes appropriately.

Do not implement unfinished business logic in this phase.

### 2.4 Screen foundations

Establish the visual structure of the main application screens.

Use realistic layout components and reusable patterns.

Do not fabricate production team data.

## Acceptance Criteria

- Brand styling is consistent.
- Reusable components work.
- Navigation works.
- Screen layouts are responsive.
- Android layouts are checked.
- Loading, empty, and error components are available.
- No dead navigation controls are presented as functional features.

## Completion Gate

Review the application visually and verify navigation.

Wait for approval.

---

# PHASE 03 — AUTHENTICATION & ACCOUNT MANAGEMENT

## Objective

Integrate Clerk and establish secure leader authentication.

## Tasks

### 3.1 Clerk integration

- Configure the Clerk application.
- Install compatible Clerk React Native dependencies.
- Configure the publishable key through the correct Expo environment configuration.
- Implement the supported Clerk provider and session integration.
- Keep secret keys exclusively on the backend.

### 3.2 Authentication screens

Implement:

- Registration.
- Login.
- Email verification where configured.
- Password recovery where supported.
- Logout.

### 3.3 Session management

Implement:

- Session restoration.
- Authentication state.
- Token retrieval.
- Expired-session handling.
- Account switching.
- Protected navigation.

### 3.4 API authentication preparation

Prepare a centralized method for obtaining valid Clerk session tokens.

Do not expose token values in application logs.

### 3.5 Authentication state handling

The application must distinguish:

- Initial session loading.
- Authenticated.
- Unauthenticated.
- Session expired.
- Authentication error.

Avoid unnecessary authentication loading screens after a valid session has already been restored.

## Acceptance Criteria

- A new leader can register.
- An existing leader can log in.
- Sessions restore after app restart.
- Logout works.
- Protected screens cannot be accessed without authentication.
- Invalid or expired sessions are handled correctly.
- No secret credentials are embedded in the application.

## Completion Gate

Verify authentication on an Android device or emulator.

Wait for approval.

---

# PHASE 04 — BACKEND FOUNDATION & DATABASE

## Objective

Build the secure FastAPI backend and establish PostgreSQL as the permanent source of truth.

## Tasks

### 4.1 Backend setup

Create the FastAPI backend.

Implement:

- Application entry point.
- Configuration management.
- Environment settings.
- Database connection.
- SQLAlchemy integration.
- Dependency injection.
- Exception handling.
- Structured logging.
- Health endpoint.

### 4.2 Database integration

Configure PostgreSQL.

Implement:

- SQLAlchemy models.
- Database session management.
- Connection pooling.
- Alembic migrations.
- Initial migration.

### 4.3 Initial database schema

Create the approved initial entities:

- User profiles.
- Teams.
- Members.
- Audit logs.

Add synchronization metadata only when justified by the selected design.

### 4.4 Database constraints

Implement appropriate:

- Primary keys.
- Foreign keys.
- Unique constraints.
- Check constraints.
- Indexes.

Enforce team-level relationship integrity.

### 4.5 Clerk token verification

Implement backend verification of Clerk JWTs.

The backend must:

- Verify signatures.
- Validate issuer.
- Validate expiration.
- Validate applicable token claims.
- Extract the authenticated subject.

### 4.6 Tenant authorization foundation

Implement reusable authorization dependencies.

Resolve the authenticated leader and their authorized team from trusted backend data.

Never trust client-supplied team ownership information.

## Acceptance Criteria

- FastAPI starts successfully.
- PostgreSQL connection works.
- Alembic migrations run successfully.
- Initial schema is created.
- Health endpoint responds correctly.
- Clerk token verification works.
- Unauthorized requests are rejected.
- Team-scoped database access is established.
- Database credentials remain server-side.

## Completion Gate

Verify backend startup, database connectivity, migrations, and authentication.

Wait for approval.

---

# PHASE 05 — USER PROFILES & TEAM INITIALIZATION

## Objective

Connect authenticated Clerk users with permanent UrLynk profiles and independent private teams.

## Tasks

### 5.1 Profile initialization

Implement authenticated profile initialization.

Store the application profile using the verified Clerk subject.

### 5.2 Team creation

When a leader registers for the first time:

- Create their application profile.
- Create their private team.
- Create their root leader member.
- Associate the root with the team.
- Establish the ownership relationship.

### 5.3 Returning user handling

When an existing leader logs in:

- Retrieve their existing profile.
- Retrieve their existing team.
- Do not create duplicate records.
- Load the existing root member.

### 5.4 Initialization safety

Implement:

- Idempotent initialization.
- Database transactions.
- Unique constraints.
- Duplicate-request protection.
- Concurrent initialization protection.

### 5.5 Team isolation

Verify that one authenticated leader cannot retrieve another leader's team.

## Acceptance Criteria

- New leaders receive their own private team.
- Each leader has exactly one team in V1.
- Root leader record is created correctly.
- Repeated login does not create duplicates.
- Concurrent initialization does not create duplicate teams.
- Team ownership is enforced by the backend.

## Completion Gate

Test with at least two independent leader accounts.

Verify that their teams remain completely isolated.

Wait for approval.

---

# PHASE 06 — MEMBER MANAGEMENT

## Objective

Implement the complete member registration and management functionality.

## Tasks

### 6.1 Member registration

Implement:

- Add member screen.
- Input validation.
- Member registration API.
- Database persistence.
- Successful registration feedback.

### 6.2 Member information

Support approved fields:

- Member name.
- Mi Lifestyle ID.
- Optional phone number.
- Sponsor.
- Placement parent.
- LEFT or RIGHT position.
- Optional joining date.
- Optional notes.

Do not assume an unverified Mi Lifestyle ID format.

### 6.3 Member editing

Implement:

- Member detail retrieval.
- Member editing.
- Input validation.
- Update API.
- Database persistence.

### 6.4 Member search

Support searching by:

- Member name.
- Mi Lifestyle ID.

Search must be restricted to the authenticated leader's team.

Implement indexed, bounded, and paginated queries where appropriate.

### 6.5 Member deletion and status

Do not implement irreversible deletion without an approved business rule.

If member deactivation is required, define its effects on sponsorship, placement, history, and audit records before implementing it.

## Acceptance Criteria

- Leaders can register members.
- Leaders can retrieve member details.
- Leaders can edit member information.
- Member data persists in PostgreSQL.
- Duplicate identifiers are rejected according to the approved rules.
- Search works correctly.
- Cross-team member access is rejected.
- Invalid data is handled correctly.

## Completion Gate

Test registration, editing, searching, validation, and persistence.

Wait for approval.

---

# PHASE 07 — BINARY TREE & PLACEMENT ENGINE

## Objective

Implement the complete binary placement business logic.

This is one of the most important phases of UrLynk.

## Tasks

### 7.1 Relationship implementation

Implement separate relationships for:

- Sponsor hierarchy.
- Binary placement hierarchy.

Never treat them as the same relationship.

### 7.2 Tree structure

Support:

- One root per team.
- LEFT child.
- RIGHT child.
- Multiple hierarchy levels.
- Parent-child navigation.
- Descendant traversal.

### 7.3 Placement validation

Validate:

- Target parent exists.
- Target parent belongs to the same team.
- Target slot is available.
- Member is not its own parent.
- No circular relationship is created.
- Root cannot be moved through ordinary placement operations.
- Existing descendants remain valid.

### 7.4 Placement operations

Implement a transactional placement service.

Support approved placement changes while preserving the complete descendant subtree.

### 7.5 Concurrency protection

Prevent two concurrent operations from occupying the same LEFT or RIGHT position.

Use appropriate database constraints, transactions, and locking.

### 7.6 Audit history

Record:

- Actor.
- Affected member.
- Previous parent.
- Previous position.
- New parent.
- New position.
- Timestamp.
- Operation metadata.

### 7.7 Placement confirmation

Prepare API responses that allow the UI to display the proposed move and request explicit confirmation.

## Acceptance Criteria

- Binary relationships work correctly.
- LEFT and RIGHT slots are enforced.
- Sponsor relationships remain independent.
- Cycles are rejected.
- Cross-team moves are rejected.
- Subtrees are preserved.
- Concurrent conflicting moves are handled safely.
- Placement changes are audited.
- Transaction rollback works correctly.

## Completion Gate

Run extensive hierarchy and placement tests.

Do not proceed until tree integrity is verified.

Wait for approval.

---

# PHASE 08 — BRANCH EXPLORER & TEAM DIRECTORY

## Objective

Implement the main hierarchical team-navigation experience.

## Tasks

### 8.1 Branch Explorer

Display the leader's:

- LEFT branch.
- RIGHT branch.

Allow the leader to explore either branch.

### 8.2 Hierarchical Team Directory

Implement a clear representation of descendants.

Requirements:

- Show parent-child relationships.
- Group descendants by parent.
- Display placement levels.
- Identify LEFT and RIGHT positions.
- Show each member's parent.
- Avoid ambiguous flat lists.

### 8.3 Member interactions

Each member must support two separate actions:

1. Open member details.
2. Explore that member's own team.

Do not combine these into one confusing action.

### 8.4 Breadcrumb navigation

Display exact navigation paths.

Example:

My Team / LEFT / D / RIGHT

The breadcrumb must represent the actual hierarchy path.

### 8.5 Empty positions

Display clear empty states:

- LEFT available.
- RIGHT available.

### 8.6 Global search navigation

Search results must navigate to the correct member and branch context.

### 8.7 Large-team support

Use:

- FlatList or suitable virtualization.
- Pagination.
- Bounded API queries.
- Efficient branch retrieval.

Do not download the entire 1,000-member hierarchy for every navigation action.

## Acceptance Criteria

- LEFT and RIGHT navigation works.
- Parent-child relationships are understandable.
- Breadcrumbs are accurate.
- Member details open correctly.
- Explore Team opens the selected member's branch.
- Search navigates correctly.
- Empty positions are displayed.
- Large lists remain responsive.

## Completion Gate

Test shallow and deep hierarchies, empty branches, and large directories.

Wait for approval.

---

# PHASE 09 — DASHBOARD & TEAM ACTIVITY

## Objective

Implement the main dashboard using real backend data.

## Tasks

### 9.1 Dashboard information

Display:

- Leader profile summary.
- Total team members.
- LEFT branch count.
- RIGHT branch count.
- LEFT and RIGHT branch cards.
- Quick Add Member action.
- Find Member action.
- Recent Team Activity.
- Synchronization status.

### 9.2 Statistics

Calculate statistics from actual database records.

Define clearly whether counts include:

- The root member.
- All descendants.
- Active or inactive members, if status is implemented.

Use consistent definitions across the application.

### 9.3 Recent Team Activity

Use actual audit events.

Examples:

- Member registered.
- Member information updated.
- Member placement changed.

Do not fabricate activity entries.

### 9.4 Dashboard performance

Use a bounded dashboard API response.

Avoid unnecessary requests for information already available in the dashboard response.

### 9.5 Quick actions

Ensure each action navigates to its actual implemented feature.

## Acceptance Criteria

- Dashboard displays real data.
- Statistics are accurate.
- LEFT and RIGHT counts are correct.
- Activity comes from audit logs.
- Quick actions work.
- Loading, empty, error, and offline states work.
- Dashboard does not block on unnecessary requests.

## Completion Gate

Verify dashboard data against PostgreSQL records.

Wait for approval.

---

# PHASE 10 — LOCAL PERSISTENCE & SYNCHRONIZATION

## Objective

Implement reliable cache-first application behavior.

PostgreSQL remains the permanent source of truth.

SQLite is used only for local read caching.

## Tasks

### 10.1 SQLite integration

Implement:

- Local database initialization.
- Cache schema.
- Account/team-scoped records.
- Cache versioning.
- Cache update operations.
- Cache invalidation.

### 10.2 TanStack Query integration

Configure:

- Query keys.
- Query caching.
- Mutation handling.
- Background refresh.
- Error handling.
- Query invalidation.

### 10.3 Cache-first loading

On application launch:

1. Restore authentication.
2. Identify the account.
3. Read permitted cached data.
4. Display cached content.
5. Refresh from the backend in the background.
6. Update SQLite.
7. Update TanStack Query.
8. Refresh visible screens.

### 10.4 Offline mode

Implement:

- Offline detection.
- Cached dashboard.
- Cached directory.
- Cached branch data.
- Cached member details.
- Offline status indicator.
- Last successful synchronization information.

### 10.5 Write restrictions

All V1 write operations require an active network connection.

Disable:

- Member registration.
- Member editing.
- Placement changes.
- Other permanent mutations.

Do not silently queue offline writes.

### 10.6 Account isolation

On logout or account switching:

- Prevent previous account data from appearing.
- Clear or isolate account-specific cache.
- Reset TanStack Query state.
- Verify the newly authenticated account before displaying its cached information.

## Acceptance Criteria

- Previously synchronized information displays offline.
- Background refresh works.
- SQLite cache updates correctly.
- Offline writes are disabled.
- Account switching is safe.
- Interrupted synchronization is handled.
- Stale information is clearly identified.

## Completion Gate

Test online, offline, interrupted-network, logout, and account-switch scenarios.

Wait for approval.

---

# PHASE 11 — SECURITY, PERFORMANCE & RELIABILITY

## Objective

Strengthen the complete system before release testing.

## Tasks

### 11.1 Security review

Audit:

- Clerk token verification.
- Backend authorization.
- Team isolation.
- Database constraints.
- API input validation.
- Secret management.
- Local cache isolation.
- Sensitive logging.

### 11.2 Cross-team isolation tests

Create at least two independent leader accounts.

Verify that:

- One cannot read another's team.
- One cannot search another's members.
- One cannot edit another's members.
- One cannot perform placement operations on another's team.
- One cannot retrieve another's audit logs.

### 11.3 Performance optimization

Test:

- Dashboard requests.
- Member search.
- Branch queries.
- Directory pagination.
- Database indexes.
- Connection pooling.
- Application startup.
- Cache-first loading.

### 11.4 Reliability

Implement or verify:

- Request timeouts.
- Controlled retry behavior.
- Safe error responses.
- Backend health checks.
- Database connection handling.
- Transaction rollback.
- Structured logging.

### 11.5 Large-team testing

Test a team containing at least 1,000 members.

Verify:

- Search performance.
- Branch navigation.
- Pagination.
- Memory usage.
- UI responsiveness.
- Database query performance.

## Acceptance Criteria

- No known cross-team data access vulnerability.
- Critical database integrity tests pass.
- No secrets exposed in the mobile bundle.
- API error handling is consistent.
- Large-team navigation works.
- Performance results are measured and documented.
- No critical unresolved security issue remains.

## Completion Gate

Prepare a security and performance audit report.

Wait for approval.

---

# PHASE 12 — TESTING & QUALITY ASSURANCE

## Objective

Perform end-to-end verification of the complete UrLynk V1 application.

## Tasks

### 12.1 Mobile testing

Test:

- First launch.
- Registration.
- Login.
- Session restoration.
- Dashboard.
- Member registration.
- Member editing.
- Member search.
- Branch Explorer.
- Team Directory.
- Member details.
- Placement operations.
- Logout.

### 12.2 Backend testing

Test:

- Authentication.
- Authorization.
- API validation.
- Database transactions.
- Error responses.
- Pagination.
- Team isolation.

### 12.3 Database testing

Verify:

- Constraints.
- Relationships.
- Migrations.
- Transactions.
- Referential integrity.
- Backup and restoration procedure.

### 12.4 Offline testing

Verify:

- Cached data availability.
- Offline indicators.
- Disabled write operations.
- Reconnection behavior.
- Background synchronization.

### 12.5 Android device testing

Test on a real Android device.

Check:

- Application launch.
- Navigation.
- Layout.
- Keyboard behavior.
- Screen sizes.
- App restart.
- Network changes.
- Session persistence.
- Memory and responsiveness.

### 12.6 Regression testing

Verify that changes made during later phases have not broken previously completed functionality.

## Acceptance Criteria

- Critical user journeys work end to end.
- Relevant automated tests pass.
- TypeScript checks pass.
- Lint checks pass.
- Backend tests pass.
- Database migrations are verified.
- Android smoke tests pass.
- No known critical release-blocking issue remains.

## Completion Gate

Produce a complete QA report.

Wait for approval before production release preparation.

---

# PHASE 13 — PRODUCTION DEPLOYMENT & APK RELEASE

## Objective

Prepare and release the first production-ready UrLynk Android application.

## Tasks

### 13.1 Backend production deployment

Deploy FastAPI to Render or the approved always-on hosting provider.

Configure:

- Production environment variables.
- HTTPS.
- Database connection.
- Health checks.
- Logging.
- Connection pooling.
- Production database backups.

### 13.2 PostgreSQL production configuration

Verify:

- Managed database availability.
- Secure credentials.
- Alembic migrations.
- Indexes.
- Backup configuration.
- Restoration procedure.
- Production access restrictions.

### 13.3 Clerk production configuration

Verify:

- Production Clerk configuration.
- Allowed application origins and redirect settings.
- JWT verification.
- Production publishable key.
- Backend verification settings.

Never place the Clerk secret key in the APK.

### 13.4 Expo production configuration

Configure:

- Application name.
- Android package identifier.
- Application icon.
- Splash screen.
- Version number.
- EAS build profiles.
- Production API URL.
- Production Clerk publishable key.

### 13.5 EAS APK build

Generate the approved Android APK.

Verify:

- Build succeeds.
- APK installs.
- Authentication works.
- Backend connection works.
- Database operations work.
- Team isolation remains enforced.
- Offline viewing works.

### 13.6 Release documentation

Document:

- Installation procedure.
- Backend deployment.
- Environment configuration.
- Database setup.
- Build commands.
- APK distribution.
- Known limitations.
- Recovery and rollback procedures.

## Acceptance Criteria

- Production backend is accessible.
- PostgreSQL is connected.
- Clerk production authentication works.
- APK builds successfully.
- APK installs on Android.
- Core application functionality works.
- Production data is persisted correctly.
- Cross-team isolation is verified.
- Release documentation is complete.

## Completion Gate

Present the production deployment report and APK build result.

Wait for explicit release approval.

---

# 4. PHASE COMPLETION REPORT FORMAT

At the end of every phase, Claude must provide a report in this format:

## Phase [Number] — [Phase Name]

### Completed

- List completed functionality.

### Files Created

- List new files.

### Files Modified

- List modified files.

### Dependencies

- List added, removed, or upgraded dependencies.

### Database Changes

- Describe schema changes and migrations.

### Tests Executed

- List actual tests and their results.

### Verification

- Explain which acceptance criteria were satisfied.

### Remaining Issues

- List unresolved problems and limitations.

### Manual Actions Required

- Explain any configuration or account actions needed from the product owner.

### Phase Status

Choose one:

- Completed and verified.
- Partially completed.
- Blocked.
- Awaiting approval.

Never mark a phase completed if required acceptance criteria remain unverified.

---

# 5. CHANGE CONTROL

A phase may require adjustments due to technical discoveries.

Claude must:

1. Explain the issue.
2. Explain why the current plan cannot proceed as written.
3. Present the proposed adjustment.
4. Identify affected files and future phases.
5. Explain security, data, and performance implications.
6. Obtain approval for significant architectural or scope changes.

Do not silently change the architecture or skip required functionality.

Routine implementation details and compatible dependencies may be handled within the approved phase, following AGENTS.md.

---

# 6. DEPENDENCY BETWEEN PHASES

The following dependencies must be respected:

- Phase 01 establishes the project foundation.
- Phase 02 establishes reusable UI and navigation.
- Phase 03 establishes authentication.
- Phase 04 establishes the backend and database.
- Phase 05 connects authenticated users to their teams.
- Phase 06 implements member management.
- Phase 07 implements binary placement logic.
- Phase 08 builds hierarchy navigation using the placement engine.
- Phase 09 builds dashboard functionality using real data and audit events.
- Phase 10 adds local persistence and synchronization.
- Phase 11 strengthens the complete application.
- Phase 12 verifies the complete system.
- Phase 13 prepares production deployment and APK release.

Some preparatory work may overlap where technically necessary, but acceptance criteria and phase approval must remain explicit.

---

# 7. FINAL V1 DEFINITION

UrLynk V1 is considered complete when:

1. A leader can register and authenticate.
2. Each leader receives one independent private team.
3. A leader can manually register and manage members.
4. Sponsor relationships are separate from placement relationships.
5. Binary LEFT/RIGHT placement works correctly.
6. Placement changes preserve subtree integrity.
7. Leaders can explore their complete team hierarchy.
8. Search and member details work.
9. Dashboard statistics reflect real database data.
10. Team activity reflects actual audit events.
11. Permanent information is stored in cloud PostgreSQL.
12. Previously synchronized data can be viewed offline.
13. Offline writes are disabled.
14. Team isolation is verified.
15. The application performs acceptably with 1,000+ members.
16. The Android APK is successfully built and tested.

Features outside the approved V1 scope must not be added merely to declare the application complete.

---

# 8. FUTURE DEVELOPMENT

The following possibilities are deliberately outside V1.

Do not implement them during V1 without explicit approval:

- Member login and member accounts.
- Multiple teams per leader.
- Commission calculations.
- Financial reporting.
- Payment integration.
- Inventory and product management.
- Push notifications.
- Advanced analytics.
- AI-based recommendations.
- Advanced team reports.
- Offline write synchronization.

These may be considered for future versions after V1 is stable.

---

# 9. FINAL DEVELOPMENT PRINCIPLE

Build UrLynk in controlled, verifiable phases.

Prioritize:

1. Security.
2. Data integrity.
3. Correct business logic.
4. Reliable cloud persistence.
5. Fast application experience.
6. Maintainable architecture.
7. Consistent user experience.

**Never sacrifice security or permanent data integrity to finish a phase faster.**

**Never move to the next phase without completing the current phase's acceptance criteria and receiving the product owner's approval.**

**The goal is not simply to make UrLynk run. The goal is to build a secure, reliable, scalable, and production-ready team management application.**
