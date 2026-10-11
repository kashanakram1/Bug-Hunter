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
| `app/api/` | Thin Next.js adapters to `backend/src/web-api.ts` |

## Run

From the repository root, run `npm run setup`, then `npm run dev`. Use Node 24 LTS. `npm run build` generates the Next.js server build; `npm start` serves it. Static export is no longer supported because secure authentication needs server routes.

Only the Supabase URL and publishable key enter the browser. The server runtime also needs `SUPABASE_SECRET_KEY`, read locally from the ignored root `.env` or configured privately in Vercel. Hosting variables take precedence. Tokens live in encrypted HttpOnly cookies, and the browser realtime client stays anonymous. Staff sign in with email/password; database role checks authorize organizer and judge controls.

Vercel Root Directory must be **`frontend`**. Use the Next.js preset, `npm run build`, and default Output Directory. Supabase must allow the deployed origin and `/api/auth/callback`.

Database and operator code lives in [`../backend/`](../backend/README.md); shared documentation lives in [`../docs/`](../docs/architecture.md). Existing `db:*` and database-test aliases forward to the backend for compatibility.
