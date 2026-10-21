# Round 4 production update — 22 October 2026

## Scope and schedule

Round 4 opens at **2026-10-22 09:30:00 Asia/Karachi**, equivalent to **2026-10-22 04:30:00 UTC**. Database time controls access. There is no global closing or login deadline. Existing authentication, organizer approval, and four-device limits remain enforced; all three currently registered teams are approved, and no qualification, ranking, or earlier-round completion is required.

Each team's first explicit entry inserts its existing-schema `round_sessions` row under a team row lock. `ends_at` is exactly `started_at + 2,400 seconds`. Further entry requests reuse that row. A Round 4-only trigger prevents timer changes and reopening completed attempts. Existing legitimate attempts are never rewritten during deployment.

The Round 4 path takes precedence over Byte runners' expired Round 2 exception without changing its record or saved history. Earlier-round entry, editing and progression are blocked, and earlier-round records are not synchronized or rewritten.

## Finalization

One private `finalize_round4` function handles manual finish, expiry sweeps, and expiry catch-up during authorized state reads, entry, and heartbeat requests. It serializes with saves and submissions using the same team lock. The completion timestamp is capped at the stored deadline. Late writes are rejected by the database, independently of scheduler or browser timing.

An additive private `round4_finalizations` table retains the exact saved draft snapshot and each draft's outcome. Valid unsubmitted claim/report drafts enter the existing pending review queues, subject to existing field, word, claim, and attempt limits. Already submitted identical work is not duplicated. Incomplete, invalid, and attempt-limit drafts remain preserved with an explicit outcome; no answers are invented and no historical submission is overwritten. Scores continue through existing judging rules; finalization adds no points itself.

Offline expiry uses a dedicated Supabase `pg_cron` job, `bughunt-round4-expiry`, calling `bughunt.expire_round4()` once per minute. The database deadline is exact; finalization processing occurs on the next successful scheduler run (normally within 60 seconds) and can be delayed by scheduler/database availability or an in-flight lock. Saved work is finalized with the deadline timestamp even if processing is delayed. Never claim zero scheduler latency.

## Verification and deployment evidence

- 16 isolated real PostgreSQL checks cover opening boundaries, no timer on reads, late entry, no qualifications or earlier-round history, four concurrent entries, fixed shared deadlines, parallel work, write/expiry races, offline sweeps, duplicate safety, manual completion, private permissions and full protected-data comparisons.
- Four isolated browser contexts verify automatic opening refresh, first-entry timing, shared countdowns, reload/reconnect behavior, separate claim/report work, expiry locks, mobile layout and browser errors. API responses are fixtures; these are not live-team attempts.
- The Next.js production build and TypeScript checks passed; secret scanning passed.
- Before applying production changes, all 90 existing relevant functions matched a local replay of the applied migration history.
- A consistent custom-format PostgreSQL backup and private JSON baseline were captured before deployment. The archive contains 53 authentication/application table-data entries and is readable by `pg_restore --list`.

Production application, scheduler execution, deployed-source verification and protected-record comparisons must be checked after deployment. The private operator receipt records their actual results; this document alone is not evidence that deployment completed. No real production attempt may be entered, submitted or expired for testing.

## Changed surface and rollback

Only `team.tsx`, two Round 4 migration files, two dedicated verification scripts and this document change. The migrations add one private table, a Round 4 timer trigger, private Round 4 helpers, Round 4 access/state/finish/heartbeat/activity wrappers, and the schedule-based round status decorator. Public RPC signatures and existing RLS policies are unchanged. The new table has deny-all RLS; private functions and cron schema remain inaccessible to browser/service roles.

For a rollback, first stop new Round 4 entry, then unschedule only `bughunt-round4-expiry` and restore the previous function definitions/trigger configuration from the private baseline, after reviewing any attempts created since deployment. Preserve new attempts, submissions, drafts and finalization snapshots. Do not restore an entire database over newer competition work, delete finalizations, drop shared extensions, or roll back earlier competition data. Never run rollback automatically.
