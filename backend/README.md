# Backend

The live backend is Supabase Auth and PostgreSQL. SQL functions enforce authentication, organizer roles, team ownership, timers, answer locks, qualification, scoring, and certificate verification. Every application table has RLS policies.

## Files

| Directory | Purpose |
| --- | --- |
| `supabase/migrations/` | Canonical schema, policies, and database business logic |
| `scripts/database.mjs` | Safe migration, seeding, connectivity, and staff commands |
| `scripts/live-check.mjs` | Read-only Supabase API checks |
| `scripts/test-database.mjs` | Isolated database correctness and authorization tests |
| `scripts/load-test.mjs` | 500-team isolated PostgreSQL load scenario |
| `scripts/browser-workflow.mjs` | Full frontend workflow against isolated PostgreSQL |
| `scripts/hosted-load.mjs` | Operator-run staging load checks |
| `legacy/sites/` | Unused original D1 starter files, not live competition code |

## Run

Install with `npm ci` in this directory or `npm run setup` at the repository root.

```sh
npm run db:check
npm run db:migrate
npm run db:seed
npm run staff -- judge@example.edu judge
npm test
```

The operator commands read the ignored repository-root `.env`. Credentials are never printed. `psql` must be available on PATH, or at the original workspace's ignored `tools/postgresql-client/psql.exe`.

Private official seed content must be supplied separately in `../private/official-content.json`. It is already loaded in the existing Supabase instance. Database tests also require this content. Load and browser-workflow tests need isolated PostgreSQL and private fixtures; they do not reset the live event.

Add new migrations rather than modifying applied SQL. Frontend assets and browser credentials belong in [`../frontend/`](../frontend/README.md). See the [runbook](../docs/runbook.md) and [architecture](../docs/architecture.md).
