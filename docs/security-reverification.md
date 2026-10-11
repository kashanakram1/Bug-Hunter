# Security re-verification: 11 October 2026

Subsequent fixes are documented in [security hardening](security-hardening.md). This report records the findings before those fixes; the six-character policy is now an explicit organizer choice rather than a form/server mismatch.

Reviewed source commit `87f4e1a753e338a5e3e548c00724cbac2536dd32`, the local production export, current npm advisories, and the live Supabase backend. Frontend: `frontend/`. Migrations: `backend/supabase/migrations/`. Website: https://bug-hunter-plum.vercel.app.

The tested authorization and competition-integrity checks pass. Security work remains: enforced staff MFA, application request budgets, server password-policy alignment, browser token exposure, development dependency updates, and production header verification. The successful deployment does not establish readiness for unrestricted production traffic.

## Scope and limits

Live database inspection used read-only transactions. Selected Auth settings were read through the management API. Production HTTP probes were limited to requests expected to deny unauthorized access and public configuration. All test event mutations and synthetic logins occurred in isolated local databases or intercepted browser requests. No production records, passwords, settings, or permissions changed; no email was sent.

Vercel returned HTTP 403 with `x-vercel-mitigated: challenge` and a Security Checkpoint to HTTP/headless-browser requests at both the production and branch domains. These were challenge responses, not application pages. Their missing headers do **not** demonstrate missing headers on normal application responses. Live Vercel HTML, deployed bundles, source-map URLs, and authenticated account flows could not be re-verified this way. Local browser findings below are explicitly scoped to the production export. The challenge was not bypassed.

The organizer's successful deployment screenshot identifies commit `c1f5aa1`. The subsequent commit changes a browser verification assertion, not product behavior. GitHub's status for that subsequent commit still reports its earlier failed deployment; it does not contradict the successful older deployment screenshot.

## All 20 requested checks

| # | Check | Current finding |
| --- | --- | --- |
| 1 | SQL injection | **No issue demonstrated.** Active RPCs use typed parameters and static SQL. Dynamic migration SQL quotes operator-controlled identifiers or catalog signatures. Injection-shaped registration/answer values remained literal data in isolated tests; a malicious view selector did not disclose keys. Privileged migration files inherently require operator trust. |
| 2 | XSS | **Local targeted tests passed.** Image/onerror and SVG/onload strings injected into intercepted announcement/team responses rendered as text. Zero injected elements, payload execution, or browser exceptions. Active competition components have no raw HTML sink. The unused starter chart component has `dangerouslySetInnerHTML` for CSS; reassess before supplying it untrusted configuration. Live deployed XSS behavior and CSP remain unverified. |
| 3 | CSRF | **No protected API bypass demonstrated.** Mutations use explicit bearer tokens, not automatically attached auth cookies. A live foreign-origin unauthenticated admin request returned 401. Isolated anonymous registration/admin mutations were denied. A future cookie backend requires Origin and CSRF protections. Provider login/recovery internals were not comprehensively tested. |
| 4 | File uploads | **No active surface found.** No connected upload workflow/endpoint; the live project has zero Storage buckets. Reassess authorization, content type, size, and storage policies if uploads are introduced. |
| 5 | IDOR / object authorization | **Targeted tests passed.** Other teams could not read drafts/submissions, modify ownership, approve teams, grade submissions, or review claims. Judges could not invoke admin controls. Ownership derives from verified user/session identity. Certificate UUID lookup intentionally reveals limited public certificate fields. |
| 6 | Missing rate limiting | **Confirmed high-priority gap.** Most application RPCs lack a durable request-frequency limiter, including public reads, heartbeat, drafts, and staff actions. Item quotas, attempts, idempotency, and clarification cooldowns are not general request budgets. Auth limits exist; email is correctly 50/hour. CAPTCHA is disabled. The Vercel challenge does not protect direct requests to Supabase. |
| 7 | JWT secrets | **No active weakness demonstrated; partial coverage.** Published JWKS uses ES256/P-256; an unsigned token returned 401. No custom signer/verifier exists in the product. Auth configuration shows 3,600-second JWT expiry and refresh-token rotation with a 10-second reuse interval. Private-key entropy, legacy acceptance, rotation history, and provider internals remain outside coverage. |
| 8 | API secrets | **No configured-secret leak found in checked surfaces.** Scans covered actual service/database/management credentials and Brevo SMTP key, including encoded database password. Four Git commits and one local log had zero matches. Frontend source/export scan passed. Browser configuration promotes only URL/publishable key and rejects service keys. Local `/.env`, `/.env.local`, and `/.git/config` returned 404; live equivalents are unverified. External backups/provider logs were not comprehensively scanned. |
| 9 | Password hashing | **bcrypt verified; password-policy gap confirmed.** All three existing password records use bcrypt cost 10; no hashes were printed. The form requires 12 characters, but Supabase's server setting is `password_min_length: 6`, allowing a weaker direct-API policy. Leaked-password rejection and password-change reauthentication are disabled in configuration. No weak-password live account was created during testing. |
| 10 | MFA | **Confirmed high-priority gap.** One staff account, zero verified factors. Supabase TOTP enrollment/verification are enabled, but there is no app MFA workflow and `require_staff()` does not require `aal2`. Provider support alone does not enforce a second factor. Enrollment/challenge/recovery and backend enforcement must be introduced together to avoid staff lockout. |
| 11 | CORS | **Broad provider CORS; no bypass demonstrated.** Foreign-origin preflight permits `*` and Authorization/API-key headers without credentialed CORS. The unauthorized mutation still returned 401. Broad CORS alone is not a bearer-token authorization flaw, and restricting frontend origins cannot stop direct API clients. |
| 12 | Local-storage tokens | **Confirmed medium-priority exposure.** `persistSession: true` persists browser-readable access/refresh tokens. Synthetic local browser login confirmed presence without recording values. Same-origin XSS could steal them; shared-device persistence also matters. HttpOnly protection requires a session backend plus CSRF controls. Session storage remains JavaScript-readable. |
| 13 | Client-only permissions | **Server checks verified.** UI gates are backed by user/session, staff-role, ownership, lease, approval, round/deadline, and qualification checks. Team-to-staff and judge-to-admin escalation tests passed. RPC EXECUTE permission permits calling a function, not passing its internal authorization. |
| 14 | RLS | **Verified present live.** All 23 application tables have RLS and explicit policies. All 22 private-schema tables deny direct anon/authenticated access, and both roles lack private-schema USAGE. The public signal table deliberately allows timestamp-only SELECT and denies writes. All 28 inspected security-definer functions fix an empty search path; their internal authorization remains essential. |
| 15 | Webhook signatures | **No active handler found.** No application webhook receiver exists to test. Add raw-body provider signature verification and replay protection before introducing one. Provider-managed internal hooks are outside coverage. |
| 16 | SSRF | **No reachable application sink found.** Next.js static export has no application server endpoint fetching caller-selected URLs. Retained connector/preview tooling is outside the deployed static runtime. Reassess private-network destinations and redirects if server fetch features are added. |
| 17 | Source maps | **Local export passed; live unverified.** No `.map` files in `frontend/out`. Nine entry-page JS assets lacked source-map directives, and their local map URLs returned 404. Developer `.next` files are not evidence of public exposure. Vercel's challenge prevented equivalent live verification. |
| 18 | Default credentials | **No production default password found.** Staff provisioning reserves a verified email/role without creating a password. Synthetic isolated credentials are not provisioned live accounts. No password guessing or credential stuffing was performed. |
| 19 | Sensitive logs | **Partial coverage; retention gap remains.** One local log had zero configured-secret matches; active product components do not explicitly log passwords/tokens. Private audit records may retain prior team/member/submission data. Access is restricted, but retention/minimization needs documentation. Supabase/Vercel/Brevo log contents and retention were not inspected. |
| 20 | Dependencies | **20 affected frontend development packages: 13 high, seven moderate, zero critical.** Fresh frontend production-only audit: zero findings. Fresh full backend audit: zero findings. Chains include React Server DOM, Vite, esbuild, image-size, braces/micromatch, undici, ws, and retained Cloudflare/Drizzle tooling. Static hosting has no application Server Functions endpoint, but build/development exposure matters. Some forced fixes propose incompatible downgrades; update compatible upstreams or remove unused tooling after assessing retained workflows. |

## Configuration verification

All five migration-file checksums match the live migration ledger. This detects edited applied files; it does not prove absence of every out-of-band schema change. Policies, grants, function metadata, and selected Auth settings were independently inspected live.

The Site URL is `https://bug-hunter-plum.vercel.app`. The redirect allowlist includes that URL, localhost/127.0.0.1 development URLs, and the previous Sites URL. Email confirmation is required, signup enabled, and Brevo SMTP configured. Email rate remains 50/hour. No email was sent to test delivery in this review, and no SMTP login/key is included here.

`frontend/public/_headers` exists, but the repository has no Vercel header configuration or Next.js header configuration. That file is not proof the host applies its policy. Configure supported host response headers and verify a normal 200 response before claiming CSP/header protection. The previous Sites-host finding must not be reported as a newly proven Vercel finding. [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json).

Node engines remain `>=22.13.0`, allowing future major upgrades. Pin a supported major version for predictable builds. Deprecated esbuild-kit packages and npm install-script review warnings remain maintenance work. Successful builds do not justify blanket script approval.

## Evidence and validation

- 11/11 isolated security checks passed: injection-shaped values, cross-team objects, role escalation, anonymous mutation denial, and preservation of private keys.
- 26/26 database workflow checks passed: session limits, approval, deadlines, draft concurrency, idempotency, answer privacy, grading bounds, qualification, claims/bonuses, finalization, certificates, and fixed search paths.
- Local XSS/storage checks passed with zero browser exceptions. Desktop/mobile navigation, auth tabs, live read-only Mission Control, walkthrough, and legal pages passed.
- Complete isolated browser/database workflow passed: team login, round entry, saved-draft recovery, locked submissions, clarification, organizer review, final claims, first-critical bonus, report review, finalization, and certificate verification. Authentication transport was simulated; PostgreSQL authorization and event writes were real within the isolated test database.
- TypeScript checking and a fresh optimized Next.js static production build passed.
- Repeated isolated PostgreSQL concurrency test: 500 teams, 50 pooled connections, 2,500 measured successful requests, zero unexpected errors. Worst operation p95: 1,280 ms. Same-team race: one of 20 submissions accepted, 19 rejected. Includes pool waiting. This does not establish hosted Supabase capacity. Metrics: `docs/load-test-results.json`.
- Live denied probes: unauthenticated foreign-origin admin mutation 401, unsigned JWT 401, private REST lookup 404.
- Four Git commits, frontend source/export, and one local log showed no configured-secret matches. Nine local source-map probes returned 404.

Sanitized evidence is in ignored `private/security-*.json`; helpers are ignored under `tools/`. Historical report preserved in `private/security-audit-20261009.md`. Credentials, real tokens, and password hash values are absent from report output.

## Remaining work

1. Add staff MFA enrollment/challenge/recovery and enforce `aal2` in privileged database functions. [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa).
2. Match the server password minimum to the form's 12 characters; review reauthentication and provider-supported compromised-password protection. [Supabase password security](https://supabase.com/docs/guides/auth/password-security).
3. Add atomic per-user RPC request budgets and anonymous direct-API protections. Protect signup/recovery against email quota exhaustion while preserving the requested 50/hour limit.
4. Configure and verify live Vercel security headers/CSP while preserving Auth, realtime, and printing.
5. Update affected development dependencies safely, review install scripts, and stabilize the Node major version.
6. Assess HttpOnly staff sessions, document log/audit retention, and run a scoped hosted concurrency rehearsal. Local tests cannot certify Supabase Free hosting capacity.

This review documented findings; it did not apply security fixes, push code, or redeploy.
