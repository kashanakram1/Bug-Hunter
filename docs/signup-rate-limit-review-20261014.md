# Signup rate-limit review — 14 October 2026

The reported signup error was a handled HTTP 429, not evidence of a process crash. Read-only production checks found an unconfirmed account for the reported email, a provider confirmation-sent timestamp, and four account signup requests in the current fixed hourly window. The app permits three signup requests per email per hour; the fourth was rejected. The IP signup budget was not exhausted. A provider sent timestamp does not establish receipt in the inbox.

Supabase's status page separately reported a Realtime latency incident under monitoring. Team state polls every 18–24 seconds and staff state every 25 seconds, independently of the Realtime notification channel. Answers and authentication use HTTP. No account or team records were reset during this review.

Changes:

- Preserve existing quotas and calculate Retry-After from the denied bucket's remaining fixed-window time.
- Explain signup/recovery throttling, including checking existing confirmation/reset emails.
- Honor provider Retry-After and distinguish provider email throttling.
- Disable repeat signup/recovery for 60 seconds after success, and show a countdown after throttling. Cooldowns are scoped by action and email; sign-in remains available during a signup cooldown. The server remains authoritative across reloads and devices.
- Guard concurrent form submissions.
- Preserve the encrypted session cookie when refresh encounters 429 or a server outage; invalid refresh credentials still clear it.

Verification: 33 API/security checks, 27 database checks, and 24 scheduling checks passed. TypeScript, production build, and the built-asset secret scan passed. Browser checks with Realtime disconnected verified throttling countdowns, repeat-submit prevention, independent sign-in, scheduled entry, timer expiry, focus recording and irreversible progression. Live probes returned public state 200, anonymous staff/submission 401, and private question access 404. Read-only configuration checks confirmed Brevo SMTP and the requested 50-email/hour project limit. The additive rate-limit feedback migration was applied without modifying existing event data or quotas.

The project email quota is shared by confirmation and recovery requests. This change does not increase the requested 50/hour quota or establish successful inbox delivery. Provider outages and email quotas cannot be eliminated by frontend changes.
