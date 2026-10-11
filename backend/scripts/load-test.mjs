// Isolated real PostgreSQL test. This script never loads .env or contacts Supabase.
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const psql = fileURLToPath(new URL('tools/postgresql-client/psql.exe', root));
const database = 'bh_load_' + Date.now();
const pgEnv = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: '55432',
  PGUSER: 'postgres',
  PGDATABASE: database,
  PGSSLMODE: 'disable',
};
delete pgEnv.PGPASSWORD;
function sql(text, db = database) {
  const r = spawnSync(psql, ['-X', '--no-password', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: text,
    env: { ...pgEnv, PGDATABASE: db },
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 2e6,
  });
  if (r.status !== 0)
    throw new Error(
      (r.stderr || r.error?.message || 'psql failed')
        .split('\n')
        .filter((s) => /ERROR|FATAL|failed/.test(s))
        .join('\n'),
    );
}
sql(`create database ${database};`, 'postgres');
sql(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
 create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('session_id',nullif(current_setting('request.jwt.claim.session_id',true),'')) $$;`);
for (const file of readdirSync(new URL('backend/supabase/migrations/', root))
  .filter((x) => x.endsWith('.sql'))
  .sort())
  sql(readFileSync(new URL('backend/supabase/migrations/' + file, root), 'utf8'));
const literal = (v) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const content = JSON.parse(readFileSync(new URL('private/official-content.json', root), 'utf8'));
let seed = 'begin;';
for (const q of content.questions) {
  const { explanation, rubric, accepted, ...row } = q;
  seed += `insert into bughunt.questions select * from jsonb_populate_record(null::bughunt.questions,${literal(row)});insert into bughunt.answer_keys select * from jsonb_populate_record(null::bughunt.answer_keys,${literal({ question_id: q.id, explanation, rubric, accepted })});`;
}
for (const b of content.bugs)
  seed += `insert into bughunt.bugs select * from jsonb_populate_record(null::bughunt.bugs,${literal(b)});`;
const teamCount = 500;
const users = Array.from({ length: teamCount }, (_, i) => ({
  id: randomUUID(),
  session: randomUUID(),
  email: `team${i + 1}@local.test`,
  name: `Load Team ${i + 1}`,
}));
const admin = { id: randomUUID(), session: randomUUID(), email: 'admin@local.test' };
for (const u of [...users, admin])
  seed += `insert into auth.users values('${u.id}','${u.email}',now());insert into auth.sessions values('${u.session}','${u.id}');`;
seed += `insert into bughunt.staff values('${admin.id}','admin');commit;`;
sql(seed);
const pool = new Pool({
  host: '127.0.0.1',
  port: 55432,
  database,
  user: 'postgres',
  max: 50,
  connectionTimeoutMillis: 15000,
});
const metrics = {};
async function call(user, name, args = {}, measure = true) {
  const start = performance.now();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)`,
      [user.id, user.session],
    );
    await client.query('set local role authenticated');
    const entries = Object.entries(args);
    const result = await client.query(
      `select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(',')}) result`,
      entries.map(([, v]) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
    await client.query('commit');
    if (measure) {
      (metrics[name] ??= []).push(performance.now() - start);
    }
    return result.rows[0].result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
const started = performance.now();
for (const u of users) {
  u.request = randomUUID();
}
console.log('Preparing 500 independent authenticated teams in isolated PostgreSQL…');
await Promise.all(
  users.map(async (u, i) => {
    u.team = await call(
      u,
      'bh_register',
      {
        p_name: u.name,
        p_leader: 'Test leader',
        p_university: 'Load test',
        p_department: 'CS',
        p_members: [{ name: 'Leader' }, { name: 'Member' }],
        p_newcomer: false,
      },
      false,
    );
  }),
);
sql(`update bughunt.teams set status='approved';`);
await call(
  admin,
  'bh_admin',
  {
    p_action: 'round',
    p_payload: { round: 1, status: 'open' },
    p_reason: 'Isolated capacity test',
  },
  false,
);
console.log('Running simultaneous session, round-start, draft, submission, and state-read bursts…');
await Promise.all(users.map((u) => call(u, 'bh_heartbeat')));
await Promise.all(users.map((u) => call(u, 'bh_start_round', { p_round: 1 })));
await Promise.all(
  users.map((u) =>
    call(u, 'bh_save_draft', {
      p_question: 'R1-Q2',
      p_answer: { a: 'test draft', b: '=' },
      p_revision: 0,
    }),
  ),
);
await Promise.all(
  users.map((u) =>
    call(u, 'bh_submit', {
      p_question: 'R1-Q1',
      p_answer: { a: 'false', b: 'object' },
      p_request: u.request,
    }),
  ),
);
const states = await Promise.all(users.map((u) => call(u, 'bh_team_state', { p_round: 1 })));
assert.ok(states.every((s) => s.questions.length === 10 && s.submissions.length === 1));
// Adversarial overlapping submissions by the same team: only one attempt may commit.
const victim = users[0];
const races = await Promise.allSettled(
  Array.from({ length: 20 }, () =>
    call(
      victim,
      'bh_submit',
      { p_question: 'R1-Q2', p_answer: { a: 'nonzero', b: '=' }, p_request: randomUUID() },
      false,
    ),
  ),
);
assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
await call(
  victim,
  'bh_submit',
  { p_question: 'R1-Q1', p_answer: { a: 'false', b: 'object' }, p_request: victim.request },
  false,
);
const audit = await pool.query(
  `select count(*)::int count from bughunt.submissions where question_id='R1-Q1'`,
);
assert.equal(audit.rows[0].count, 500);
assert.equal(
  (await pool.query(`select count(*)::int count from bughunt.teams where total_score>=10`)).rows[0]
    .count,
  500,
);
const summary = Object.fromEntries(
  Object.entries(metrics).map(([name, times]) => {
    times.sort((a, b) => a - b);
    const pct = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]);
    return [
      name,
      {
        requests: times.length,
        p50_ms: pct(0.5),
        p95_ms: pct(0.95),
        p99_ms: pct(0.99),
        max_ms: Math.round(times.at(-1)),
      },
    ];
  }),
);
const report = {
  date: new Date().toISOString(),
  environment:
    'Isolated local PostgreSQL 17, 50 pooled connections, 500 independently authenticated teams; no network or Supabase hosting included',
  teams: 500,
  successful_requests: Object.values(metrics).reduce((n, t) => n + t.length, 0),
  unexpected_errors: 0,
  duration_seconds: Math.round((performance.now() - started) / 1000),
  same_team_race: { simultaneous_requests: 20, accepted: 1, rejected: 19 },
  metrics: summary,
  notes:
    'Burst timings include waiting for the 50-connection pool. This is a local database measurement, not a claim about Supabase plan capacity. Run the hosted rehearsal before opening the event.',
};
mkdirSync(new URL('docs/', root), { recursive: true });
writeFileSync(new URL('docs/load-test-results.json', root), JSON.stringify(report, null, 2));
writeFileSync(
  new URL('private/load-fixtures.json', root),
  JSON.stringify({ database, users, admin }, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await pool.end();
