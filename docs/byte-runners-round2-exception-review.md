# Byte runners: proposed Round 2 exception

Status: implementation and isolated tests completed; final deployment and activation approval received on 18 October 2026. Production preflight matched all 82 relevant functions against the tested migration history, verified the exact approved team and empty original Round 2 work, and saved a private backup. Deployment and activation must pass the checks below; this review document is not an activation receipt.

## Exact scope

- Team: Byte runners, `laibanavaid15@gmail.com`.
- Team ID: `9345635c-aa5f-4361-9048-4a7c18aea8a9`.
- Owner ID: `c685974c-8b6c-44c4-a172-a9f122db29df`.
- Round 2 only, with existing question/attempt/scoring rules.
- Exactly 1,800 seconds from the first successful explicit entry request, shared by all team devices.

The new private `round2_exceptions` table holds authorization, first entry, deadline, and optional early completion. Constraints restrict grants to the exact team/owner IDs and enforce a 30-minute duration. Runtime checks also verify both team and account email and approved team status. Browser and service roles cannot directly read, insert, or update grants.

The migration inserts **no grant** and changes **no team, original round-session, submission, score, schedule, or global round-status records**. With no matching grant, all existing functions use their previous implementations. No new public API endpoint or organizer control is introduced.

## Timing and preservation

Authorization alone leaves `started_at` and `ends_at` null. Viewing the lobby does not start the countdown or disclose questions. The first explicit **Enter Round 2** action locks the team row, records server time, and sets the deadline 30 minutes later. Simultaneous entry calls return the same timestamps. Repeated entry, reloads, reconnects, and additional devices cannot reset that deadline.

Drafts and submissions are checked against the server deadline, including after waiting for the team lock. Expired or completed exceptions reject new writes and cannot be restarted by clients. Retrying a previously accepted submission remains idempotent and creates no new attempt.

The original Round 2 completion record is preserved alongside all Round 1/3 records. Exception reads do not invoke automatic round progression. Finishing changes only the exception's completion timestamp and never calls the transition into Round 3. The interface offers only reopened Round 2 to the authorized team; all other teams keep their existing interface and schedule behavior.

New Round 2 answers use normal pending review and scoring rules. Subsequent judging can change Byte runners' Round 2 contribution and total; it does not rewrite their Round 1/3 scores or other teams' stored scores. Rankings may naturally reflect a changed total.

## Completed checks

### Isolated PostgreSQL: 14 checks

1. Migration is inactive without an operator grant.
2. Exact team/owner grant restrictions and denial for other teams.
3. Lobby reads leave the clock unstarted; pre-entry writes fail.
4. Four simultaneous entries return one shared, exact 1,800-second window.
5. Four devices, repeated entry, and reconnects retain the deadline.
6. Four devices save and submit different questions without overwrites.
7. Concurrent submission retries create only one attempt.
8. Round 1, Round 3, and final access stay blocked for the target.
9. Expiry blocks new starts, drafts, and submissions on all devices.
10. A submission blocked on a database lock is rejected if the deadline passes while it waits.
11. Concurrent finish requests are idempotent and never reopen Round 3.
12. Finalized-result protections still block exception writes.
13. Anonymous, authenticated, and service roles cannot access the private grant directly.
14. Protected-data comparisons preserve original sessions, Round 1/3 work, other teams' records/scores/device leases, question content, and global settings.

Tests use local PostgreSQL with synthetic identities/session fixtures and private question-bank fixtures. They never load `.env`, contact production, or activate a live exception. Run `npm run test:round2-exception` in `backend/` with isolated PostgreSQL on `127.0.0.1:55432`.

### Browser: four isolated contexts

The local production build passed first-entry-only timing, synchronized countdowns, four independent question submissions, reload/reconnect persistence, no exception controls for another team, expiry on all four contexts, and finish without Round 3 navigation. Mobile overflow and browser runtime-error checks passed. API responses are isolated fixtures; these checks do not represent a live four-device session.

Run `node frontend/scripts/round2-exception-browser.mjs` against the local production preview specified by `BUGHUNT_TEST_URL`.

### Regression and build

- 25 normal scheduling/progression checks passed.
- 29 database checks passed.
- 46 API/security checks passed.
- Normal scheduled-round browser checks passed.
- Next.js production build and TypeScript checks passed.

## Approval and activation boundary

Before activation, the operator must back up the current team/global records and verify the exact identity, approved status, non-finalized results, completed original rounds, and still-empty original Round 2 work. If those conditions have changed, stop for review.

Apply the inactive migration and deploy the matching interface, verify the deployment, then insert exactly one operator-only grant for the pinned team/owner. The activation transaction must preserve global settings and all original round records, with before/after comparisons. Do not invoke `bh_start_round(2)` as an operator check: only the team's first explicit entry should start the clock. A read-only grant check must show both timer fields still null after activation.

No global schedule reopening, original deadline edits, original completion clearing, score resets, new attempts in other rounds, or authentication changes are part of this proposal.
