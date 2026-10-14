# Email authentication

Signup and password recovery use eight-digit email codes. Supabase generates, expires and consumes codes; Brevo delivers Supabase's emails through custom SMTP. The browser never receives provider access/refresh tokens or server credentials.

```mermaid
sequenceDiagram
    participant User
    participant App as Next.js server
    participant Auth as Supabase Auth
    participant Mail as Brevo SMTP
    User->>App: Email and password (signup), or email (recovery)
    App->>App: Validate request and apply send budget
    App->>Auth: Signup / recover / resend
    Auth->>Mail: Email containing code
    Mail-->>User: Confirmation or recovery code
    User->>App: Email, code and purpose, in any browser
    App->>App: Apply independent verification budget
    App->>Auth: Verify code for signup or recovery
    Auth-->>App: Authenticated provider session
    alt Confirmation
      App->>App: Enforce team device admission
      App-->>User: Encrypted HttpOnly session; team registration
    else Recovery
      App-->>User: Restricted HttpOnly recovery session
      User->>App: New password
      App->>Auth: Update password and end recovery session
      App-->>User: Sign in normally with new password
    end
```

## Why replace the previous design

The old PKCE callback required a verifier stored in the browser that requested the email. Opening a message in another browser/profile, losing cookies or replacing the single verifier cookie could prevent exchange. Callback errors were rendered as JSON. Successful SMTP authentication and a sent timestamp did not test this user journey.

New requests create no PKCE flow cookie and no authentication session before code verification. Email buttons contain only a public app URL and the intended screen; they do not consume a code. Email scanners can follow those links without verifying anything. Users can enter email and code in any browser through “I already have a code.” Existing PKCE callbacks remain supported with the original cookie; failed callbacks redirect to helpful app UI without exposing their code.

## API and controls

| Endpoint | Purpose |
|---|---|
| `auth/signup` | Create a password account and request confirmation; confirmed duplicates get sign-in/recovery guidance. |
| `auth/resend` | Request signup confirmation without collecting or changing the password. |
| `auth/recover` | Request a recovery code; missing accounts use a neutral response. |
| `auth/verify-email` | Verify email, eight-digit code and explicit `signup`/`recovery` purpose. No browser verifier required. |
| `auth/password` | Update password after verification; recovery session is cleared and normal sign-in follows. |

- Codes expire after 600 seconds, are verified by Supabase, and are single use. Wrong, expired and consumed codes get actionable guidance.
- Confirmation/resend share the existing three-per-email/hour budget. Recovery retains its separate three-per-email/hour budget. Code attempts have a separate ten-per-email/ten-minute budget, plus an IP budget. Send throttling does not prevent entering an existing code.
- The browser guards concurrent submissions, scopes cooldowns by email and operation, and honors Retry-After. A 60-second resend cooldown starts after a successful request; provider and server limits remain authoritative across devices/reloads.
- Project mail remains limited to the requested 50/hour. Mail requests are described as accepted, not delivered. No automatic retry sends duplicate emails.
- Normal sessions retain device admission, CSRF checks, encrypted HttpOnly cookies and server-side tokens. Recovery sessions cannot call private competition RPCs or other protected account actions.
- Provider requests have individual timeouts. The browser allows longer bounded auth requests to avoid abandoning a multi-step request before the server's own timeouts.

## Provider configuration and rollout

Versioned templates are in `backend/supabase/templates/`. `backend/scripts/configure-email-codes.mjs` backs up the changed template/OTP fields privately, updates only those fields, and verifies that SMTP, Site URL, confirmation requirement, password policy and the 50/hour email quota are unchanged. It does not send email. Credentials belong only in private environment variables.

The additive email-code migration extends the existing service-only gateway budget. It does not modify registrations, competition attempts, scores or schedule. Deploy the new API/UI, then apply the matching provider templates and code expiry. Existing emails may need to be replaced by a fresh code request.

## Verification boundaries

API tests cover fresh-browser code verification, malformed/expired/reused responses, resend without password changes, four-device admission, restricted recovery, cookie clearing after reset, throttling and callback redirects. Browser tests cover signup, wrong code, a separate browser's confirmation, recovery, password update, sign-in and old-link help. Database and scheduling suites cover competition regressions.

For approved real-provider tests, actual signup and recovery email requests are sent to one temporary owner plus-address. Provider-generated test codes can exercise verification/reset without reading a private inbox; those fixture codes are not evidence of inbox delivery. Temporary test accounts are explicitly scoped and removed afterward. Inbox receipt and spam placement require a recipient check; accepted requests alone do not prove delivery. Provider outages, quotas, DNS authentication and spam filtering remain operational constraints.
