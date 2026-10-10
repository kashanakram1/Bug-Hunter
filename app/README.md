# Bug Hunt 2026 application

The complete web application uses Supabase Auth and permissioned PostgreSQL functions. All four official rounds use written/code-review submissions. Document B and practical execution activities are excluded.

```sh
npm ci
npm run config:env
npm run dev
```

Use Node 22.13+ and put private configuration in an ignored `.env` at the package root or its parent workspace. Only the URL and publishable key are copied to browser configuration. `npm run build` generates `out/`, which can be served with `npm start` or deployed to static hosting.

For Vercel, set Root Directory to `app`, use the Next.js preset and `npm run build`, and configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in Production. The corresponding `NEXT_PUBLIC_` names are also accepted. Startup automatically resolves only these public settings, prefers hosting variables over local files, and rejects missing configuration or service keys before building. Rebuild after changing variables; they are embedded at build time. No secret key or database password is needed on this frontend host. Add the deployed origin to Supabase Auth Redirect URLs for confirmation and password recovery.

Database changes are versioned SQL migrations, with explicit RLS policies and privilege allowlists. In the original workspace, the parent `supabase/migrations/` is canonical; this package includes an exact source snapshot under `supabase/migrations/`. After application, add migrations rather than editing existing ones. Private official seed content must be supplied separately in ignored `private/official-content.json`; it is already loaded into the configured Supabase instance.

Read [the operator runbook](docs/runbook.md), [architecture](docs/architecture.md), [requirements](docs/requirements.md), and [measured load results](docs/load-test-results.json). Create and confirm the organizer's account before signing in. Configure the exact production origin in Supabase Auth's redirect URLs and configure SMTP, backups, and capacity before opening registration.

```sh
npm run typecheck
npm run test:db
```

The full browser and load tests require the original workspace's ignored local PostgreSQL tools and private fixtures. Live security checks use the configured Supabase API and do not modify competition data. Operational tests do not reset or delete a live event.
