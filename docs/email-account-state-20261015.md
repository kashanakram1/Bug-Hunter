# Email request outcomes — 15 October 2026

The team/organizer reset preserved participant authentication accounts. Clearing team registrations does not make those email addresses new accounts. A confirmed participant must sign in or recover their password; they do not need another confirmation email.

The previous UI treated a successful provider response as an email request even when confirmation was unnecessary or the account did not exist. Supabase deliberately returns a neutral success in these cases: [confirmation resend implementation](https://github.com/supabase/auth/blob/master/internal/api/resend.go), [recovery implementation](https://github.com/supabase/auth/blob/master/internal/api/recover.go).

The gateway now checks account existence and confirmation through a service-role-only database function before requesting email. This function returns two booleans and exposes no account IDs, credentials or records. Direct anonymous/authenticated invocation is denied. Existing request budgets run before this lookup.

| Request | Missing account | Unconfirmed account | Confirmed account |
|---|---|---|---|
| Signup | Request signup confirmation | Request signup confirmation | Return to sign-in with recovery guidance; no email |
| Confirmation resend | Show signup form; no email | Request confirmation | Return to sign-in with recovery guidance; no email |
| Password recovery | Show signup form; no email | Request recovery | Request recovery |

The UI retains the email address when changing screens. Ineligible requests do not display the accepted-request notice or start a send cooldown. Provider validation, SMTP, configuration and throttling failures remain errors. Concurrent duplicate-signup and missing-user recovery responses also remain explicit outcomes.

No accounts, passwords, team data, competition dates or email quotas are changed by this fix. The existing eight-digit, ten-minute, single-use code flow and restricted recovery session remain in place.

Verification: 46 backend/API/security checks, 27 database checks, and 24 scheduling checks passed. Production build, TypeScript, changed-component lint and publishable-secret scanning passed. Browser tests passed signup, cross-browser confirmation, duplicate/signup recovery guidance, missing-account guidance, resend outcomes, wrong codes, password update/sign-in, team-registration rendering, session revocation and outage resilience using isolated API responses. These browser fixtures do not establish actual inbox delivery. Repository-wide lint still reports existing errors outside the authentication component.
