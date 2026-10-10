# Bug Hunt 2026 — implementation decisions

Sources: all 14 pages of Platform Plan and all 17 pages of Event Documentation & Questions. The latter is Document A. Its Part B is the official question paper, not the excluded Document B (Advanced Competition Questions).

The user's request overrides document instructions to wait for a committee meeting, use MongoDB, include practice, or execute submitted code. Supabase Auth and PostgreSQL are the backend. No Document B content, practice arena, code execution, containers for contestants, or practical lab activities.

## Official competition
|Round|Minutes|Points|Submission rules|
|---|---:|---:|---|
|Bug Blitz|20|100|10 structured questions, one attempt, stable per-team shuffled order|
|Code Breaker|30|200|6 written locate/explain/fix answers, three attempts, best counts|
|System Under Attack|30|300|5 written diagnoses/fixes, three attempts, best counts|
|Final Debugging Arena|40|500|MediBook code review, 12 bug claims (450), report (50), first critical verification +10 each|

Round 4 remains a written review of supplied code. It never executes the deliberately vulnerable code. All scoring and time checks run in database transactions. Keys and unreleased questions remain private.

## Defaults for open decisions
- Team size 2–4, leader included; unique case-insensitive trimmed names of 3–30 characters. Email confirmation and organizer approval.
- Everyone completing/starting Round 1 may qualify for Round 2. Top ceil(75%) of preceding eligible participants for Round 3; final top 8 at <=20 approved teams and top 10 above 20. The original document stops at 50; extending top 10 above 50 is an explicit default. Admin can override qualification count.
- Scores hidden until final or explicit admin release. Rank: points, solved challenges, earlier time reaching current score, lower penalties, earlier final completion, UUID as a deterministic final fallback.
- Q5: zero for fewer than two correct values. Q10: accept the canonical sequence for 10; partial 5 only for A D F E C B. Ambiguous equivalent answers receive human review.
- Detailed Part C rubric overrides rounded generic percentages where they conflict (C2 8/5/12; multi-issue C4–C6 and T1–T5 use the published splits).
- Extra valid bugs: no penalty, +5 at judge discretion; identified by a normalized unique label per team. Wrong claims after the first two: -5 each. Duplicate recognized bugs do not earn points twice.
- One active competition session per team; admin may allow two. Server-held leases with heartbeat; administrative recovery logged. Browser signals are review evidence, not proof of misconduct.
- Tab warnings at 3, one -10 penalty per round at 5, review flag at 8. Fullscreen encouraged and exits/paste logged. No forced fullscreen.
- Recommended features: Mission Control, verified-fix progress, incident tickets, clarifications, awards, certificates. No hint shop or optional practice content.
- Certificates per team, printable PDF using the browser print dialog and QR verification. Event identity defaults to Bug Hunt 2026; no invented university, dates, signatures, or logo.
- Initial engineering target: 500 concurrent teams unless changed by user. This is a test target, not a measured capacity claim.
- Data retention: organizer review after 90 days; no automatic deletion. Destructive changes require user approval.

## Operator decisions remaining
Event date/venue and network fallback, staff account emails, institution branding, email provider configuration, production origin, Supabase plan/connection capacity, backup retention/PITR, capacity acceptance and 10-team rehearsal. These are deployment inputs, not reasons to postpone implementation.

## Security and operations
All tables enable RLS with explicit policies, private schema is not exposed through the Data API, and public RPCs are narrowly permissioned. Every security-definer function fixes search_path and checks identity/role. All mutations use database authorization, bounded inputs, idempotency, row locks, audit entries, and authoritative timestamps. UI receives no service key. Migration files are append-only after application. Secrets and full source PDFs are excluded from version control and public assets.

Backups cannot honestly be guaranteed by a browser app: use Supabase backups/PITR and the documented pre-round snapshot procedure. A production release requires live migration verification, end-to-end role testing, restore rehearsal, and the measured load test.
