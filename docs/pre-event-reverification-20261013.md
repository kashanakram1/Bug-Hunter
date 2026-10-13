# Pre-event re-verification: 13 October 2026

## Email incident

The signup screenshot uses kashanakram16@gmail.com. Read-only Auth metadata shows that this account already existed and was confirmed before the current attempt. The recent signup request returned HTTP 200. Existing-account signup can produce a neutral result rather than a new confirmation email; the UI's old unconditional instruction was misleading. See [Supabase signup behavior](https://supabase.com/docs/reference/javascript/auth-signup).

The UI now gives a conditional confirmation message and directs existing users to sign in/recover. The API now normalizes only known account-existence errors; validation, SMTP/provider, configuration, and throttling failures propagate as errors without issuing a confirmation-flow cookie. A garbled online-round label was corrected. Live-check/browser tools now target the current gateway and support an explicit local URL.

## Live configuration and evidence

- SMTP: Brevo relay configured, TLS verified, authentication accepted (235); no email sent by that connection check.
- Confirmation enabled; signup enabled; email limit preserved at 50/hour; production Site URL and callback are correct. Exact localhost/127.0.0.1 callback URLs for port 5175 were added to fix local-preview confirmation/recovery redirects.
- Supabase allows multiple Auth sessions per user; application device admission is fixed at four.
- 25 competition/signal/archive tables have RLS; no private-table browser grants were found. All 13 existing migrations are applied.
- Live signing keys use ES256/P-256. No new signing secret is implemented in the app.
- Live gateway/public response is 200; anonymous staff/submission attempts are 401; private table access is 404. Unsigned-token checks are rejected.
- Production responses have nonce CSP without script unsafe-inline, HSTS, nosniff, frame denial, no-referrer and Permissions-Policy. Sample browser assets have no source-map directive; attempted map requests were blocked (403).
- Frontend and backend full dependency audits: zero known vulnerabilities. Source/build secret scan passes.

## Rechecked risk classes

| Area | Result |
| --- | --- |
| SQL injection | Typed RPC arguments; static application queries; isolated mutation/validation tests pass. |
| XSS | React text escaping and injected-payload browser checks pass. |
| CSRF / CORS | Cookie mutations require exact origin/custom JSON request headers; foreign-origin/form requests rejected. Provider bearer-token CORS remains broad; no permission bypass demonstrated. |
| Uploads / webhook signatures | No application upload or webhook endpoint; no live storage buckets. |
| IDOR / client-only permissions / RLS | Ownership, lease, staff/admin role and direct-access denial checks pass in isolated suites and public live probes. |
| Rate limits / JWT / API secrets | Durable budgets and four-device limits tested; provider signing and private server-side keys verified; no token/secret logging in reviewed handlers. |
| Password hashing / MFA | Provider bcrypt retained; minimum six and mandatory staff MFA disabled as explicitly requested. |
| Browser token storage | Encrypted HttpOnly cookies; legacy local-storage removal and no persisted tokens verified. |
| SSRF | Fixed provider origin and RPC allowlist; arbitrary proxy destinations rejected. |
| Maps / defaults / logs / dependencies | No exposed maps demonstrated, no production default credentials found, new audit minimization retained; fresh known-dependency audits are clean. |

## Verification results

- 29 API/security checks; 27 competition/database checks; 24 scheduling/progression checks pass.
- Browser security, scheduled entry, irreversible progression, desktop/mobile navigation and a full isolated workflow through grading, final claims, finalization and certificate verification pass.
- Production build, TypeScript and secret scan pass.
- Isolated PostgreSQL load: 500 authenticated teams, 2,500 requests, no unexpected errors. Twenty simultaneous duplicate submissions yield one accepted and nineteen rejected.
- Live public-read exercise: 500 requests with 25 workers, all 200; p95 approximately 1.95 seconds. This checks public-read traffic, not 500 simultaneous authenticated teams on hosted Supabase.

## Remaining readiness decisions

One team's latest practice progress remains: three online round sessions and five pending submissions. It must be archived/reset before that team can enter fresh on the official date; the guarded reset is prepared for organizer approval. No current practice records were cleared during this review.

A real temporary signup/inbox-delivery check is awaiting permission. SMTP authentication alone cannot establish inbox receipt. The account in the screenshot is already confirmed and should use sign-in/recovery. All confirmations must open in the browser that requested their PKCE link.

The official schedule remains 17 October, 16:00 Pakistan time, with entry closing at 16:20, 80 minutes per entered team, and the 22 October on-site final. The review is bounded to the listed checks; hosted authenticated concurrency and mail-provider quotas still need event-operation planning.
