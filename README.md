# Bug Hunt 2026

A four-round written debugging competition using Supabase Auth and PostgreSQL. Document B, practice activities, and executable contestant code are excluded. The official Document A questions and answer keys are loaded privately into Supabase.

## Run locally

Requires Node 22.13+ and npm. Run from the `app` directory:

```powershell
npm ci
npm run config:env
npm run dev
```

Open http://localhost:5173. For the optimized static build:

```powershell
npm run build
npm start
```

The root `.env` contains server credentials. `config:env` copies only the URL and publishable key into ignored `app/.env.local`; no secret or database password enters the browser. `.env.example` is a placeholder template.

## Operator setup

The Supabase schema and private official bank are already initialized for this workspace. All rounds begin in draft. Administrator access is reserved for the confirmed email provided in this conversation. Create/confirm that account through the application and sign in to reach the control room.

Add the production URL, `http://localhost:5173`, and `http://127.0.0.1:5173` to Supabase Authentication → URL Configuration → Redirect URLs. Configure a production email provider and review signup/login rate limits before opening registration to attendees. The production URL is recorded in the hosting configuration and handoff.

From `app`, database commands use `psql` and the root environment, never print credentials, and preserve applied migration checksums:

```powershell
npm run db:check
npm run db:migrate
npm run db:seed
node scripts/database.mjs staff judge@example.edu judge
```

The canonical migrations are in `supabase/migrations/`. Private official content lives in the ignored `private/official-content.json`; back it up securely outside public source control. The seed command preserves existing rows and refuses to run once a round has opened. Do not modify an applied migration; add a new one. No destructive maintenance is automated.

## Included workflows

- Email-confirmed team accounts, 2–4 members, approval, and administrator-managed staff access.
- Server deadlines, stable shuffled Round 1 questions, atomic answer locks, idempotent submissions, three-attempt limits in Rounds 2–3, best-attempt scoring, and autosaved drafts.
- Judge rubrics and private keys, equivalent-answer review, final claims, duplicate detection, one global critical-fix bonus, wrong-claim penalties, and a 150-word report limit.
- Qualification, pause/resume, audited reopen/time/score overrides, announcements, private clarifications, session recovery, and activity review.
- Mission Control, hidden/live standings, results export, finalization, special awards, and verifiable printable certificates with QR codes.
- Low-volume realtime control notifications, bounded staggered polling fallback, and a static frontend suitable for CDN delivery.

## Verification

```powershell
npm run typecheck
npm run test:db
npm run test:browser
```

Database tests use isolated PGlite PostgreSQL, including authorization, RLS, deadlines, scoring, qualification, claims, and finalization. Browser checks require Chrome and a running built preview.

The 500-team load test uses an isolated PostgreSQL 17 server on localhost, not the live Supabase project. See [load-test results](docs/load-test-results.json). To rerun on Windows:

```powershell
powershell -NoProfile -File app/scripts/isolated-postgres.ps1
cd app
npm run test:load
npm run test:workflow
```

The portable PostgreSQL tools are under ignored `tools/`; they must be acquired separately in a fresh checkout. The full browser workflow uses simulated authentication transport with real isolated database functions. Live API checks separately verify the actual Supabase connection and anonymous restrictions. None of these checks replaces a hosted 10-team dry run, email-delivery test, backup/restore rehearsal, or a capacity test on the actual Supabase plan.

See [requirements and resolved decisions](docs/requirements.md), [architecture](docs/architecture.md), and [event operations](docs/runbook.md).
