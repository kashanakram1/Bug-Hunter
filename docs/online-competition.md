# Scheduled online competition (local draft)

The organizer approved the database migration, GitHub push, Vercel deployment, and scoped rehearsal archive/reset on 13 October 2026.

Confirmed plan: Bug Hunter Module-5. Online rounds start Saturday, 17 October 2026 at 16:00 Pakistan time (Asia/Karachi). The on-site final is Thursday, 22 October 2026, lasting 40 minutes. The organizer corrected the originally supplied Tuesday weekday to Thursday. The confirmed schedule is prepared in a local configuration migration; it is approved for production activation.

## Agreed timing

- Rounds 1, 2, and 3 are available from the scheduled start without administrator opening or intermediate qualification.
- Teams enter through Round 1; entry closes exactly 20 minutes after the start. Entry is allowed before that boundary, not at or after it.
- Following the organizer's clarification, each team gets up to 80 minutes from its first entry. A 16:19 entrant can continue until 17:39. The latest possible global cutoff is 17:40.
- Per-round maximum times remain 20, 30, and 30 minutes. Early forward movement starts the next round immediately and permanently locks the earlier round. A team can finish all three early.
- An expired round advances at its original deadline. Reconnection does not restart or pause the next timer. The personal 80-minute deadline overrides remaining work.
- Only already-entered teams can reconnect after the entry window closes. Existing single-device leases and approval checks remain enforced.
- Round 4 is a 40-minute on-site final on Thursday, 22 October 2026. Only approved teams with published final qualification can enter. The existing ranking/qualification rules remain; organizers review pending online submissions before publishing finalists. The final cannot open before or after its on-site date. Expired online sessions are synchronized before selecting finalists.

## Architecture and security

Migration `202610130001_online_schedule.sql` is additive. It preserves the existing manual final and previous migration checksums. Online status is computed from server timestamps rather than relying on a browser, cron job, administrator, or continuously running process. Server checks close access at the boundary, and overdue session rows are synchronized on the next request. The team row serializes answer writes and transitions.

Online questions are disclosed only for the current entered round. Earlier questions, draft content, and submission content are withheld from team-state responses after progression; records remain stored for judging. Moving forward does not turn unfinished drafts into submitted answers. Normal submission rules and scoring remain.

Manual round opening, closing, pausing, extension, and qualification for Rounds 1-3 are removed from the organizer UI and rejected by the database. The pause-all action is unavailable in online mode. Staff/admin roles, RLS, encrypted HttpOnly sessions, CSRF checks, and durable request limits remain.

A normal website cannot prevent operating-system Alt+Tab or prove which application the user opened. The browser records focus loss and hidden-tab events, deduplicates a combined observation, and retries buffered idempotent reports while the page remains open. Telemetry is best effort, bounded to 200 records per team per round; organizers can review it. Existing warning/penalty rules remain. Reports for entered rounds can retry for five minutes after the personal cutoff without reopening answers. Closing the page can discard unsent observations.

## Configuration and approval

The migration introduces `online_enabled`, `online_starts_at`, `online_entry_closes_at`, and `online_ends_at` on the existing private RLS-protected event table. The database checks that entry closes after 20 minutes and the latest event cutoff is after 100 minutes. The feature migration defaults scheduling off; configuration migration `202610130002_module5_plan.sql` enables it with the confirmed plan. Final access and opening are restricted to the on-site calendar date in Asia/Karachi. The on-site start time is unspecified, so the organizer opens Round 4 on that day.

The configuration migration uses explicit timezone-aware timestamps and refuses activation when online rehearsal sessions already exist; they must not silently become official event entries. No event records have been reset or deleted by this work. Any destructive cleanup needs a separate organizer decision.

After review and permission: apply migrations and schedule configuration, push the reviewed changes, then deploy to Vercel. Review final readiness using confirmed timestamps and official questions.

## Local verification

- `node backend/scripts/test-online-schedule.mjs`: start/entry/personal cutoff, ordered progression, irreversible locking, disconnected expiry, delayed telemetry, approval, manual-control rejection, and direct helper access.
- `node backend/scripts/test-database.mjs`: existing competition and authorization regression suite.
- `node backend/scripts/test-security.mjs`: session, authorization, CSRF, request budgets, and secret-handling regressions.
- `node frontend/scripts/online-browser.mjs`: isolated API browser scenario for scheduled entry, round expiry, focus recording, and forward movement.
- Production build and TypeScript checks; browser security regression suite.

## Production preflight (read only, 13 October 2026)

The existing backend has 5 online rehearsal round sessions belonging to 3 teams, and 7 applied migrations. The organizer explicitly approved archiving their practice records and resetting only competition progress. Migration `202610130000_archive_rehearsal.sql` preserves the snapshot in an RLS-protected private archive, preserves accounts/registrations/approval/audit history, and guards the expected cohort of 3 teams and 5 sessions before scoped cleanup.

## Organizer action confirmations

Manual reason and review-note inputs are removed from organizer confirmations, rubric grading, and claim verification. Actions still require confirmation and valid scores/verdicts. Automatic audit descriptions record the operation and actor; optional empty/null database note parameters are normalized by migration `202610130003_automatic_action_notes.sql`. The frontend sends automatic descriptions to remain compatible with the existing backend until deployment. Participant answer fields and official marking guides remain unchanged.

## Flexible progression update

Migration `202610130004_team_progression.sql` separates team progress from global round status in both scheduled competition and manual rehearsal mode. Teams advance in order when ready, locking earlier answers, without waiting for the previous round to close, resume, or run out of time. Administrators can open multiple rehearsal rounds independently. The final continues to require published qualification and its on-site date. Existing legacy suites explicitly select historical mode; scheduling/progression tests cover the new mode.

## Four-device team access

Every registered team automatically receives four active competition sessions using the same email/password. The server atomically admits sessions under a team row lock, refuses a fifth admission, and revokes a newly issued Auth session when login cannot reserve a slot. A device means an active authenticated browser session, not a hardware identifier. Signing out releases that session; a disconnected session expires after two minutes. Staff still may release stale sessions but cannot lower or raise the fixed four-device policy. The historical session_limit field remains for migration compatibility; device_limit is the authoritative fixed-four policy. All devices share one team timer and progression; submissions retain their transactional attempt/draft protections. Heartbeat budgets allow four members to connect and renew together.
