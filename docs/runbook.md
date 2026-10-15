# Event operations

## Before registration

Current hosting is the Next.js server application on Vercel. Set Root Directory `frontend`, the Next.js preset, default Output Directory (no `out` override), and private Production `SUPABASE_SECRET_KEY`. Staff sign in with email/password; database role checks restrict organizer and judge controls. Password minimum is six characters as requested. See [security hardening](security-hardening.md) for the rollout and request budgets.

1. Confirm the production audience on Vercel. The previous static Sites deployment is historical and does not support the new cookie backend. The current application requires Supabase login, organizer approval, and server-side staff authorization.
2. Add exact production/local URLs and their `/api/auth/callback` paths to Supabase Auth redirect allowlists. Use configured SMTP and test confirmation/recovery in the browser that requested the link. Email limit remains 50/hour. Existing accounts keep their configured passwords; changing the minimum does not reset them. The platform does not invent or email administrator passwords.
3. Verify the selected administrator signs into the control room. Provision confirmed judge accounts using the private `staff` command; never add role-selection fields to signup.
4. Verify all migration checksums and official question counts: R1 10/100, R2 6/200, R3 5/300, R4 arena 450 plus report 50; 12 known bugs. Have two independent reviewers check the imported paper, restored Python indentation, and rubric splits.
5. Set the institution/event details with a new audited configuration migration if needed. Defaults deliberately avoid invented names, dates, logos, and signatures.

## Capacity and recovery acceptance

- Choose a Supabase plan whose database, API, realtime concurrency, and bandwidth quotas cover 500 teams plus organizers/spectators. Polling survives a realtime quota failure, but the database must still meet the measured traffic envelope.
- Run a 10-team hosted rehearsal through all four rounds, including a second-device login, ambiguous answer review, duplicate claim, qualification, pause/resume, and certificate generation. Do this in a staging project or before loading the official live event; the scripts do not reset a live competition.
- Run the representative HTTP load scenario in `backend/scripts/hosted-load.mjs` against staging with pre-provisioned authenticated tokens. The default is read-only; test write bursts in a disposable staging event. Acceptance starting point: no unexpected authorization/data-integrity failures; <1% transport failures; p95 read/write latency under 2 seconds at normal activity; timed burst operations under the 15-second client timeout. Record actual measurements instead of assuming local measurements equal hosted capacity.
- Enable Supabase backups and, where available, PITR. Record the restore method and test a restore into staging. Before each round, take a private database snapshot with `pg_dump`/Supabase backup tools. Protect dumps: they contain personal data and answer keys. A pre-round backup is an operational requirement, not an automatic guarantee made by this app.
- Use stable HTTPS, a backup venue connection, and a projector account/URL. Test the hall network rather than only a developer's connection.

## Running the event

1. Approve registrations after checking roster size and identity. Rejected/disqualified teams cannot submit. A case-insensitive unique index enforces team names.
2. Open Round 1 from Control room. Each team starts its server timer when entering. The question order remains stable across refreshes.
3. Close the round, finish pending reviews, and publish qualification for the next round. Default R2 admits every preceding participant; R3 admits ceil(75%); final admits top 8 at <=20 approved teams or top 10 above 20. A qualifier-count override needs a reason and is frozen once that round starts.
4. Open the next round. Judges score using the official fixed rubric and a required note. Equivalent correct responses should be accepted. The best of at most three R2/R3 attempts counts.
5. During interruptions, pause all or the affected round. On resume the server preserves unfinished remaining time. Grant extra seconds to all teams or one team with a recorded reason. To reopen a closed round, specify added seconds. Finishing a round is permanent for that team.
6. Review suspicious activity with the floor marshal. At five tab switches the database applies one -10 penalty per round. Activity is evidence requiring context; use an audited adjustment when a justified exception is needed. Release stuck competition sessions or allow two devices from the team record.
7. Answer clarifications privately or broadcast a fair clarification. Use announcements for schedule and network updates.
8. In the final, judges map claims to known bugs, mark duplicates, reject wrong claims, or label additional valid bugs. First verification of each critical bug earns one global +10; after two wrong claims each further rejected claim costs -5. An extra valid bug earns +5 once per unique team label. Reports cannot exceed 150 words.
9. Close all rounds, clear every review, audit adjustments, export the results, then finalize. Finalization publishes results and freezes score-changing actions. Certificates include participation, finalist, places, and supported special awards.

## Staff answer guides

Each review displays the current question's short expected answer, marking criteria and mark limits. Participant fields follow the question's field order and readable labels. The suggested score is advisory; the judge enters the final marks.

Concise guide text is stored privately in `bughunt.answer_keys.explanation`. Keep `private/marking-guides.json` outside Git and frontend assets. `npm run db:guides` from `backend/` backs up the previous explanations, updates only that text and checks that accepted answers and rubrics are identical. Fresh question-bank seeding uses this private guide file when present. Existing submissions and scores are not recalculated by an editorial guide update.

## After the event

Keep private backups and exports according to institutional policy. Review personal-data retention after 90 days. No deletion job runs automatically; all destructive maintenance needs explicit approval. Archive the question bank outside public repositories. Do not expose the original PDFs or organizer answer keys as frontend assets.

## Stopping local test services

The preview process can be stopped normally. The isolated PostgreSQL server uses `private/loadtest-db` and listens only on `127.0.0.1:55432`; stop it with `tools/postgresql-local/bin/pg_ctl.exe -D private/loadtest-db stop`. Keep these test files ignored. Never point a load-test reset or cleanup operation at the production connection string.
