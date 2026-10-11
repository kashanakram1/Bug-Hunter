# Code Connect 26 / Bug Hunt

A four-round written debugging competition, with a Next.js frontend and a Supabase Auth / PostgreSQL backend. Document B and practical code execution are excluded.

## Frontend

All browser application files are under **[`frontend/`](frontend/README.md)**:

- `app/`: pages, layout, and event styles.
- `components/`: participant arena, organizer console, authentication, and reusable controls.
- `lib/` and `hooks/`: Supabase browser client, data access, and realtime coordination.
- `public/`: original event branding and static assets.
- `scripts/`: frontend configuration, builds, previews, and browser checks.
- `build/`, `vendor/`, and provider configuration: retained hosting integrations.

```sh
npm run setup
npm run dev
```

Use Node 22.13 or newer. Local development opens at http://localhost:5173. `npm run build` creates `frontend/out`; `npm start` previews it. Each package has its own lockfile; `npm run setup` installs both with `npm ci`.

## Backend

All database and privileged operator files are under **[`backend/`](backend/README.md)**:

- `supabase/migrations/`: canonical, versioned SQL schema, RLS policies, scoring, deadlines, and authorized RPC functions.
- `scripts/`: migrations, private content seeding, staff provisioning, and live API checks.
- Database and workflow verification scripts use isolated test databases.
- `legacy/sites/`: unused D1 starter examples retained for reference; not the competition backend.

Supabase hosts authentication and the database; there is no separate Express server to deploy. The frontend calls authorized PostgreSQL functions, which enforce roles and team scope on the server.

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

**Set Root Directory to `frontend`**, select the Next.js preset, and use `npm run build`. Set the two public Supabase variables in Production (and Preview if used). The static build validates configuration before compiling. Rebuild after changing environment variables.

Set Supabase Auth Site URL to `https://bug-hunter-plum.vercel.app` and include that origin in Redirect URLs. Supabase handles email delivery through the project's configured SMTP service; no SMTP credentials belong on this frontend host.

## Documentation and checks

[`docs/`](docs/architecture.md) contains architecture, requirements, event operations, design, and security findings. Backend configuration and deployment changes do not remove the limitations recorded in the security audit.

```sh
npm run typecheck
npm test
npm run test:browser
```

Browser checks require Chrome and a built local preview. Load/workflow tests require private fixtures and isolated PostgreSQL. The measured 500-team load results cover a local test database, not hosted Supabase capacity.
