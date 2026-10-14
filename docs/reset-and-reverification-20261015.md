# Team/organizer reset and reverification — 15 October 2026

The organizer selected a reset of team data and explicitly requested removal of organizer accounts and access. Participant authentication accounts, official content and email configuration were preserved. The organizer separately selected restoration of the official 17 October, 16:00 Asia/Karachi schedule.

## Reset result

- Removed four team registrations and their progress, sessions, scores, drafts, submissions, clarifications, claims, qualifications and certificates.
- Cleared organizer console records, old application audit records and the two rehearsal archives. One new audit receipt records this approved reset without copying participant data.
- Removed one organizer authentication account, staff membership and email allowlist access. No organizer remains automatically authorized; a fresh organizer must register and receive a new explicit role assignment.
- Preserved eight participant login accounts, 23 questions, 23 answer keys, 12 final-round bugs, schema/migrations, and email credentials/settings.
- Confirmed zero remaining teams, staff memberships, competition sessions, submissions, rehearsal archives and authenticator factors.
- Restored online start to 17 October 2026 at 16:00 Pakistan time, entry closing at 16:20, latest online cutoff 17:40; on-site date remains 22 October.

Before deletion, a private custom PostgreSQL archive of the auth/application/public schemas and a complete application-data snapshot were saved under `private/team-organizer-reset-1792010201992/`. SHA-256 checks protect the archive, snapshot and exact reset SQL. Archive table-of-contents verification passed. Every saved application table was restored into an isolated database and compared; the exact reset SQL and organizer identity deletion were rehearsed there before live use. Provider-managed auth-schema restoration itself was not exercised. Private backups contain sensitive material and are excluded from Git.

## Email architecture checks

| Architecture item | Verification |
|---|---|
| Password minimum six | Provider setting and API tests pass. |
| Signup confirmation required | Provider configuration remains enabled; new/duplicate/unconfirmed response cases tested. |
| Supabase codes through Brevo | Live configuration matches code templates and custom SMTP. Recipient previously confirmed both real test emails arrived. No additional delivery batch was sent in this pass. |
| Eight digits, 600-second expiry | Both provider settings verified. Malformed and wrong-purpose codes rejected by API tests. |
| Cross-browser verification | Browser test uses a fresh context without a request cookie; API test verifies without a browser verifier. |
| Code entry and resend | Reset field is immediately visible; code entry stays enabled during send cooldown; confirmation entry is accessible from sign-in. |
| Confirmation/recovery send quotas | Separate three/email/hour counters retained, with shared confirmation/resend quota. |
| Verification quota | Separate ten/email/ten-minute budget retained; email send cooldown does not lock code entry. |
| Shared project email budget | Live setting remains 50/hour. |
| Password recovery | Verify code, restrict recovery session, update password, clear recovery cookie and normal sign-in tested. |
| Four-device admission | Database and API tests reject a fifth device, including code verification. |
| Authenticator policy | Live enrollment disabled, zero factors; gateway blocks new enrollments. |
| Cookie and session errors | Encrypted HttpOnly cookies retained. Deleted-account sessions are now cleared on 401/403/404 user lookup; 429/server outages preserve cookies. |
| Old links and rate errors | Callback redirects into helpful app UI; Retry-After and explicit guidance tested. |

## Fresh-data verification

- 40 API/security checks, 27 database checks and 24 scheduling/progression checks passed.
- Deployed email browser tests passed confirmation, cross-browser entry, recovery, password update and sign-in with isolated API responses.
- Fresh isolated PostgreSQL fixtures passed team workflow, saved drafts, submissions, clarification, mobile workspace, organizer approval/grading/announcement, final claims, results and certificate verification.
- Local concurrency: 500 independent authenticated test teams, 2,500 requests, zero unexpected errors. A 20-request duplicate-submission race accepted one and rejected 19.
- Production build and TypeScript passed. Tests used isolated fixtures so the live reset remains clean.
- Foreground session checks return deleted accounts to sign-in when an old tab regains focus; temporary provider lookup failures leave the current workspace in place.

The load measurement is local PostgreSQL performance; it does not establish hosted Supabase plan capacity. SMTP acceptance/configuration and prior recipient receipt do not guarantee future inbox delivery or eliminate provider quotas/outages.
