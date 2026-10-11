# Code Connect 26 / Bug Hunt

A four-round written debugging competition, with a Next.js frontend and a Supabase Auth / PostgreSQL backend. Document B and practical code execution are excluded.

## Frontend

All browser application files are under **[`frontend/`](frontend/README.md)**:

- `app/`: pages, layout, and event styles.
- `components/`: participant arena, organizer console, authentication, and reusable controls.
- `lib/` and `hooks/`: Supabase browser client, data access, and realtime coordination.
- `public/`: original event branding and static assets.
- `scripts/`: frontend configuration, builds, previews, and browser checks.
- `app/api/`: thin route adapters for the server implementation in `backend/src/`.

```sh
npm run setup
npm run dev
```

Use Node 24 LTS. Local development opens at http://localhost:5173. `npm run build` creates a Next.js server build in `frontend/.next`; `npm start` runs it. Each package has its own lockfile; `npm run setup` installs both with `npm ci`.

## Backend

All database and privileged operator files are under **[`backend/`](backend/README.md)**:

- `supabase/migrations/`: canonical, versioned SQL schema, RLS policies, scoring, deadlines, and authorized RPC functions.
- `src/web-api.ts`: same-origin API, encrypted HttpOnly sessions, PKCE recovery, CSRF checks, MFA, and durable gateway limits.
- `scripts/`: migrations, private content seeding, staff provisioning, and live API checks.
- Database and workflow verification scripts use isolated test databases.
- `legacy/sites/`: unused D1 starter examples retained for reference; not the competition backend.

Supabase hosts authentication and the database. Vercel runs the Next.js API adapters, which call the backend server implementation. Protected operations forward the user's JWT to PostgreSQL; they do not use service privileges to bypass team authorization. Anonymous public reads and durable gateway budgets use the server-only key.

```sh
npm run db:check
npm run db:migrate
npm test
npm --prefix backend run staff -- judge@example.edu judge
```

Never edit an applied migration. Add a new migration instead. Live destructive maintenance is not automated. The existing Supabase instance already contains the official question bank.

## Configuration

Keep server credentials in the ignored repository-root `.env`; use `.env.example` as a template. Never commit credentials. Frontend startup resolves only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or their `NEXT_PUBLIC_` names), preferring hosting environment variables over local files. Management tokens, SMTP keys, service keys, and database credentials stay private.

Private content is stored separately in ignored `private/official-content.json`. Database tests and seeding require this private file; it is intentionally absent from GitHub. Portable PostgreSQL tools and test fixtures are also local prerequisites documented in the runbook.

## Vercel deployment

**Set Root Directory to `frontend`**, select the Next.js preset, use `npm run build`, and leave Output Directory at the Next.js default (remove any `out` override). Set the two public Supabase variables and server-only `SUPABASE_SECRET_KEY` in Production (and Preview if used). Never prefix the secret key with `NEXT_PUBLIC_`. Rebuild after changing environment variables. The frontend and backend folders must both remain in the repository so the route adapters can import and trace the backend runtime.

Set Supabase Auth Site URL to `https://bug-hunter-plum.vercel.app`; allow both that origin and `https://bug-hunter-plum.vercel.app/api/auth/callback`. Supabase handles email delivery through the configured SMTP service; SMTP/database/management credentials are unnecessary in Vercel. Apply the security migration together with this server deployment; old static builds do not support its gateway/MFA requirements.

## Documentation and checks

[`docs/`](docs/architecture.md) contains architecture, requirements, event operations, design, and security findings. Backend configuration and deployment changes do not remove the limitations recorded in the security audit.

```sh
npm run typecheck
npm test
npm run test:browser
```

Browser checks require Chrome and a built local preview. Load/workflow tests require private fixtures and isolated PostgreSQL. The measured 500-team load results cover a local test database, not hosted Supabase capacity.
