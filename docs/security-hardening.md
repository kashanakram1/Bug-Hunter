# Security fixes: 11 October 2026

The password minimum is six characters in both the form and server API, as requested. The API caps passwords at 72 UTF-8 bytes, matching bcrypt's input boundary. Staff passwords alone cannot authorize event operations: organizer/judge actions additionally require a verified TOTP authenticator and database JWT `aal2`.

## Sessions and requests

Vercel hosts a Next.js backend adapter to `backend/src/web-api.ts`. Authentication, token refresh, password recovery, and authenticated RPCs run server-side. AES-256-GCM encrypts the session cookie using a key derived from the existing server secret; HTTPS cookies use the `__Host-` prefix, HttpOnly, Secure, SameSite=Lax, and Path=/. Browser responses contain only the signed-in user's ID/email, never access/refresh tokens. Existing Supabase local-storage sessions are removed without reading their values. The only browser Supabase client is anonymous, for the timestamp-only realtime signal.

Every JSON POST requires an exact same-origin Origin, a custom request header, and a non-cross-site Fetch Metadata value. Bodies are bounded at 40 KB before parsing; RPC names come from a fixed allowlist. Email signup/recovery uses PKCE and a browser-bound HttpOnly verifier cookie. Old already-issued implicit links are validated server-side, imported once, and removed from the address bar. PKCE links must be opened in the browser that requested them. Cookies and API responses are not cached. Provider failures do not log credentials or request bodies.

The server holds the privileged key solely for gateway budgets, authentication forwarding, and limited public RPCs. Participant/staff RPCs use the user's token so SQL ownership and MFA remain authoritative. Vercel's trusted client IP is forwarded to Auth using its documented `Sb-Forwarded-For` mechanism; arbitrary IP headers are not trusted outside Vercel.

## MFA and recovery

After staff sign-in, the app offers authenticator setup or an existing-factor challenge. Scan the QR code or manually enter the setup key, then verify a six-digit code. A password reset does not bypass MFA. If a factor is lost, the Supabase project operator must verify identity before resetting the factor in the dashboard. No automatic email-only MFA bypass was added. Re-enrollment removes only unverified abandoned factors, not verified factors.

## Durable request budgets

`202610110001_security.sql` adds a private RLS-protected budget table and wraps public application functions without changing their signatures. Anonymous direct public RPCs are revoked; public data is served through the rate-limited gateway. Direct authenticated callers still encounter per-user/per-operation limits. Private implementations cannot be executed directly by browser roles.

| Budget | Limit |
| --- | --- |
| Gateway RPC IP | 12,000/minute |
| Gateway session IP | 12,000/minute |
| Login IP / normalized account | 1,000/minute / 10 per 10 minutes |
| Signup or recovery IP / account | 600/minute / 3 per hour |
| MFA verification IP / user | 600/minute / 10 per 10 minutes |
| Authenticated aggregate RPC user | 240/minute |
| Individual RPC user | 120/minute, except heartbeat 10/minute and registration/start/finish 20/minute |
| Public gateway database reads | 30,000/minute globally |
| Supabase Auth emails | Existing organizer setting preserved: 50/hour |

Large IP budgets accommodate 500 teams behind venue NAT; account/user budgets provide individual controls. Gateway counters commit separately from failed login/event requests, use HMAC subject hashes, and return Retry-After on denial. Counter outages fail closed. Database wrapper counters protect direct successful calls; PostgreSQL rolls back counters on transactions rejected for other errors, so unauthenticated/public revocation and upstream abuse protections remain important. Expired hashed gateway budgets are pruned in bounded batches after 24 hours. No event records are automatically deleted.

Provider Auth remains internet-accessible. Its built-in controls still apply; CAPTCHA needs separately configured provider keys, and the global free email quota can still be exhausted by distributed abuse. Request budgets do not constitute volumetric DDoS protection. Configure a supported CAPTCHA/WAF if that threat needs stronger coverage.

## Headers, dependencies, and logs

Next.js emits nosniff, no-referrer, HSTS, frame denial, and Permissions-Policy headers. HTML uses a fresh CSP nonce with strict-dynamic and no script unsafe-inline. Inline styles remain allowed for existing UI/QR/print controls. Browser source maps are disabled. Production-build browser tests verify actual headers and nonce-bearing scripts, rendering, and escaped XSS payloads.

Unused vulnerable Cloudflare/Vite/Vinext/Drizzle tooling was removed from the installed frontend dependencies and its hosting source archived under `backend/legacy/sites-hosting/`. ESLint's affected Next-specific dependency chain was replaced by TypeScript ESLint. Node is pinned to 24.x. Fresh full frontend audit reports zero known vulnerabilities; no blanket install-script approval or forced dependency downgrade was used.

New audit writes omit full submitted answers, team rosters, contact fields, and common credential keys while preserving decision provenance. Existing historical audit rows were not deleted or rewritten. Review them privately and apply institutional retention decisions explicitly; the event runbook requests a retention review after 90 days. Provider log retention remains an infrastructure responsibility.

## Rollout and verification

Deploy the Next.js preset with Root Directory `frontend`, default Output Directory, and server-only `SUPABASE_SECRET_KEY`. Allow `/api/auth/callback` in Supabase redirects. Apply the new migration with the server rollout; the historical static export lacks the new API/MFA flow. Secret-key rotation invalidates encrypted sessions and requires sign-in again.

Verification covers isolated database checks, API hardening checks, real production-build CSP/storage/MFA browser checks, a complete isolated competition workflow, dependency/secret scans, and a repeated 500-team local database concurrency test. Local results do not certify hosted Supabase Free capacity. Live Vercel inspection may encounter the provider security challenge; do not infer application response headers from its 403 page.
