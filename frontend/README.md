# Frontend

The Next.js / React application for Code Connect 26, including account screens, the team arena, staff dashboards, live Mission Control, legal pages, and certificates.

## Files

| Directory | Purpose |
| --- | --- |
| `app/` | Pages, layout, global styles, and event theme |
| `components/competition/` | Competition screens and workflows |
| `components/ui/` | Reusable UI controls |
| `lib/`, `hooks/` | Browser data access and shared hooks |
| `public/` | Logos, favicon, and static assets |
| `scripts/` | Public configuration, builds, and browser verification |
| `build/`, `vendor/` | Retained hosting integration code |

## Run

From the repository root, run `npm run setup`, then `npm run dev`. From this directory, use `npm ci` and `npm run dev`. `npm run build` exports `out/`.

Only the Supabase URL and publishable key enter the browser. Server credentials remain in the ignored root `.env`. Hosting environment variables take precedence over local files. Builds fail if public configuration is missing or uses a service key.

Vercel Root Directory must be **`frontend`**. Use the Next.js preset and `npm run build`. Supabase Auth's redirect settings must allow the deployed origin.

Database and operator code lives in [`../backend/`](../backend/README.md); shared documentation lives in [`../docs/`](../docs/architecture.md). Existing `db:*` and database-test aliases forward to the backend for compatibility.
