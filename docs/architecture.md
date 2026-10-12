# Architecture and security

```mermaid
flowchart LR
  Team[Team browser] --> CDN[Next.js application on Vercel]
  Staff[Judge / admin browser] --> CDN
  Projector[Mission Control] --> CDN
  CDN --> API[Same-origin cookie session API]
  API --> Auth[Supabase Auth]
  API --> RPC[Permissioned PostgREST RPCs]
  RPC --> PG[Supabase PostgreSQL]
  PG --> Private[Private bughunt schema with RLS]
  PG --> Signal[Public timestamp-only control signal]
  Signal --> RT[Supabase Realtime]
  RT --> CDN
```

The application uses Next.js/React with same-origin server adapters to `backend/src/web-api.ts`. Sessions are encrypted HttpOnly cookies; browser code receives no persisted access/refresh tokens. Supabase Auth handles password verification, PKCE email confirmation/recovery, refresh, and MFA. Server-only secrets are used for gateway budgets and public reads. Protected RPCs forward the user's JWT: every private database entry point verifies `auth.uid()`, the session ID, the corresponding `auth.sessions` record, and role or team ownership. Team mutations also require an active competition lease. Staff operations require a server-verified staff/admin role. Mandatory MFA was removed at the organizer?s request. See [security hardening](security-hardening.md) for CSRF, rate limits, and rollout details.

All competition tables live in a schema with no anonymous/authenticated USAGE or table grants. RLS is enabled on every table with explicit deny-direct-access policies. Authorized security-definer RPCs return only the data appropriate for the caller, fix `search_path`, use qualified object names, and have explicitly revoked default PUBLIC EXECUTE privileges. The only public table is a timestamp-only realtime invalidation signal with read-only grants and explicit RLS policies. It contains no questions, keys, identities, or scores.

Admin and judge roles come from a protected database allowlist and staff table, never from client metadata. Email reservations activate only after the matching Auth email is confirmed. No staff credentials are shipped in the frontend. Answer keys and unreleased questions are never returned by participant/public endpoints. Participant submission responses hide scores and solutions during the event.

## Concurrency and integrity

- An answer mutation locks that team's row; unrelated teams proceed independently. Attempt allocation and insert happen in one transaction with unique team/question/attempt and request-ID constraints.
- A team row lock serializes answer writes, personal timer expiry, and forward transitions. Global round open/paused/closed states do not determine a team?s next-round eligibility in self-progression mode. Database deadlines remain authoritative.
- Each team has one current online round. ?Move to next round? atomically locks earlier answers and starts the next timer, regardless of the earlier global round status or unused time. Requests cannot skip rounds or reopen a completed team round. Scheduled mode enforces the entry window and personal overall deadline; the final retains qualification and date checks.
- Optimistic draft revisions detect cross-device overwrites and recognize an identical retry after a lost response.
- Claims are verified once. A unique team/bug constraint prevents duplicate points; a unique critical-bug row awards only one first-fix bonus globally. Rejected claims use unique penalty sources.
- Team scores are recalculated at mutation time from best judged attempts, verified claims, bonuses, and adjustments. Public leaderboard reads indexed team scores instead of grading or aggregating every answer on each refresh.
- Organizer and judge changes append an audit entry in the same transaction. Browser roles cannot edit or delete audit records. Database operators retain administrative privileges; this is an application-immutable audit trail, not a cryptographically tamper-proof ledger.
- Finalization rejects pending reviews and open rounds, freezes scoring, publishes results, and issues stable certificate IDs.

## Traffic behavior

There is no per-second timer request: displays advance from a server time anchor using `performance.now()`. Team state refreshes at staggered 18–24-second intervals, with a 45-second session heartbeat. Draft writes debounce after 1.8 seconds of inactivity. Public refreshes are staggered at 15–20 seconds. Organizer controls invalidate connected screens using one public realtime timestamp; normal score writes do not fan out notifications to every contestant. Polling continues if realtime connections are unavailable.

500 active teams imply roughly 21–28 state reads/second and 11 heartbeats/second before answer activity. Avoiding a whole-event lock for contestant writes, indexing owner/queue/ranking lookups, bounding all input and response collections, and shipping immutable static assets reduces contention. The local 500-team test is evidence about these database operations; production latency also depends on Supabase compute, connection pools, quota, network, and email infrastructure.

## Limits and deployment inputs

There is no arbitrary code execution, practical lab, or automated hidden-test sandbox. Judges verify written fixes. Certificates use the browser's print-to-PDF capability, with persistent database verification IDs and QR links. Backup/PITR and SMTP are infrastructure settings; the application cannot enable them with a publishable or service key. The event's date, institution, branding, staff roster, and hosting audience remain organizer settings or operational decisions.

The Next.js response configuration and proxy apply security headers and a per-response nonce CSP. Scripts have no unsafe-inline allowance; inline styles remain allowed for existing controls. Source maps are disabled. Local production-server header checks pass; the actual hosting responses must still be checked after deployment. Unused historical hosting integrations are archived and excluded from the active dependency tree.

## Team-owned progression

The global event schedule, published final qualification, and each team?s personal progress are separate concepts. `202610130004_team_progression.sql` adds self-progression to manual rehearsals as well as the scheduled flow. Administrators may open multiple rounds without closing earlier rounds first. Only Round 4 requires published qualification; online Rounds 2 and 3 require ordered team progression instead. Scheduled online rounds remain time-controlled, with manual round controls rejected.

The local frontend still uses the existing live Supabase database for ordinary sign-in. The organizer approved activation of these reviewed migrations on 13 October 2026. Isolated tests verify the new database behavior without modifying live records.
