# Pre-launch account cleanup and registration verification

Completed for the competition scheduled on 18 October 2026. This review changed no competition structure, round durations, opening/closing times, qualification rules, or email-provider settings.

## Participant cleanup

- Removed five existing participant authentication accounts using the Supabase Admin API, with exact ID/email guards protecting the sole administrator.
- Removed nine participant request-budget records, six participant-owned application audit entries, and two participant practice archives. There were no remaining teams or live team-progress rows at the start of this cleanup.
- Preserved administrator-authored records, staff membership/allowlist, announcements, question content, accepted answers, rubrics, and event/round configuration.
- Confirmed that all five removed addresses return `exists: false, confirmed: false` and can register again from scratch.
- Final account inventory: one account, the original administrator; zero participant accounts and zero teams. The temporary verification account and its team were removed after testing.

A private custom PostgreSQL backup of the auth, application, and public schemas is stored under `private/final-participant-reset-1792263115972/`. Its integrity and table-of-contents checks passed. All saved application tables were restored into an isolated database, compared with the snapshot, and subjected to the exact scoped deletion plan before live deletion. The provider-managed auth schema itself was not restored during the rehearsal. Backup files contain sensitive records and are excluded from Git.

Immediately after participant deletion, the administrator account and all captured administrator authentication records matched the backup. A later comparison after the human inbox test found one previous administrator session absent, a refresh-token row absent, and a retained refresh token marked revoked. Account/password/profile and identity records still matched exactly, as did administrator access. Those session changes occurred after the cleanup's initial verification; the cleanup did not target administrator IDs, and no attempt was made to restore or alter administrator sessions.

## Real deployed registration test

One unique temporary Gmail plus-address delivered to the administrator's selected inbox was used. No administrator password or login was used for the test.

1. The deployed signup endpoint accepted a fresh account and requested a real confirmation email. Request duration: 4,348 ms; this is API latency, not a measurement of inbox delivery time.
2. The recipient confirmed actual receipt and entered the emailed code on the deployed confirmation screen. The application displayed “Build your crew.” No admin-generated replacement code was used.
3. Normal password sign-in succeeded for that confirmed temporary account: 1,876 ms.
4. A two-member temporary team registered through the real deployed API: 1,238 ms.
5. Bootstrap returned that account's own team, with status `pending`, and workspace/session access succeeded: bootstrap 1,558 ms.
6. The team could not bypass organizer approval or the finalized competition lock.
7. Repeating signup for the confirmed address returned existing-account/sign-in guidance without sending another confirmation email.
8. The test signed out. Its team, related records, account, and request budgets were removed. The final inventory was rechecked.

This verifies real delivery to the selected Gmail inbox and the complete signup → confirmation → sign-in → registration → pending-approval workspace journey. It does not establish deliverability to every email provider or production email throughput.

## Automated verification

| Check | Result | Boundary |
|---|---|---|
| API/security suite | 46 checks passed | Includes missing/pending/confirmed accounts, duplicate signup, code format/type/replay errors, resend behavior, SMTP/configuration errors, throttling, recovery restrictions, secure cookies, deleted sessions, and device admission. Provider transport is simulated. |
| Database suite | 29 checks passed | Includes confirmed-email registration, normalized uniqueness, access isolation, ownership, device limits, RLS, and protected content. Isolated PGlite. |
| Email browser suite | Passed | Code entry, cross-browser confirmation, resend cooldown, recovery/reset/sign-in, duplicates/missing accounts, deleted sessions, and temporary outages. Isolated responses. |
| Security browser suite | Passed | Signup feedback, repeat-click protection, throttling, independent sign-in, CSP, XSS, and staff access. Isolated responses. |
| Registration concurrency | 6 grouped checks passed; zero unexpected errors | Real gateway code and local PostgreSQL; Auth and SMTP are test doubles. |
| Live schedule and page | Passed | Entry remains locked until 18 October 16:00 PKT, closes at 16:30, latest online cutoff 17:50; final remains locked for 22 October. |

The new concurrency test runs 25 independent accounts simultaneously through signup, code verification, and team registration, then checks ownership and pending approval. It also tests invalid/reused codes, unconfirmed/anonymous registration denial, duplicate handling, invalid teams, and 20 concurrent incorrect-code requests for one address: ten reached verification and ten were rate-limited, with no authentication cookies issued.

Measured local gateway/database latency, including pool contention:

| Operation | Requests | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Signup | 25 | 733 ms | 2,005 ms | 2,221 ms |
| Code verification | 25 | 431 ms | 640 ms | 651 ms |
| Team registration | 25 | 74 ms | 144 ms | 157 ms |

Run with `npm run test:registration` from `backend/`, with the isolated local PostgreSQL server running on `127.0.0.1:55432`. It never reads production credentials or sends email. These results do not measure hosted Supabase/Auth/SMTP capacity.

## Email configuration and limits

Live read-only checks confirmed custom Brevo SMTP, mandatory email confirmation, eight-digit codes, 600-second expiry, and disabled authenticator enrollment. Existing API send/verification quotas were retained. The project-wide email quota remains 50/hour, shared by confirmation, resend, and recovery requests. The organizer expects up to 25 teams in the busiest hour; repeat requests still consume the remaining allowance.

No application defect was reproduced in the completed checks, so no production authentication/registration code or provider settings were changed. The additions are a repeatable registration-concurrency test and this evidence report.

SMTP/API acceptance is separate from final delivery. Supabase documents that delivery after handoff depends on the email provider; one successful inbox test cannot guarantee future delivery or eliminate delays, filtering, quotas, and outages. See [Supabase's missing-email troubleshooting](https://supabase.com/docs/guides/troubleshooting/not-receiving-auth-emails-from-the-supabase-project-OFSNzw) and [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
