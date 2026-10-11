import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const workspace = new URL('../../', import.meta.url);
const root = workspace;
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('session_id',nullif(current_setting('request.jwt.claim.session_id',true),'')) $$;`);
for (const name of readdirSync(new URL('backend/supabase/migrations/', root))
  .filter((n) => n.endsWith('.sql'))
  .sort()) {
  try {
    await db.exec(readFileSync(new URL('backend/supabase/migrations/' + name, root), 'utf8'));
    console.log('Migration parsed:', name);
  } catch (e) {
    console.error('Migration failed:', name, e.message);
    process.exit(1);
  }
}
const content = JSON.parse(readFileSync(new URL('private/official-content.json', root), 'utf8'));
for (const q of content.questions) {
  const { explanation, rubric, accepted, ...row } = q;
  await db.query(
    `insert into bughunt.questions select * from jsonb_populate_record(null::bughunt.questions,$1)`,
    [JSON.stringify(row)],
  );
  await db.query('insert into bughunt.answer_keys values($1,$2,$3,$4)', [
    q.id,
    explanation,
    JSON.stringify(rubric),
    JSON.stringify(accepted),
  ]);
}
for (const b of content.bugs)
  await db.query(
    'insert into bughunt.bugs select * from jsonb_populate_record(null::bughunt.bugs,$1)',
    [JSON.stringify(b)],
  );
let tests = 0;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const val = async (sql, args = []) => Object.values((await query(sql, args))[0])[0];
async function check(name, run) {
  try {
    await run();
    tests++;
    console.log('PASS', name);
  } catch (e) {
    console.error('FAIL', name, e.message);
    process.exitCode = 1;
  }
}
async function fails(sql, args = [], match) {
  let error;
  try {
    await query(sql, args);
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'Expected rejection');
  if (match) assert.match(error.message, match);
}
const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  judge: '00000000-0000-4000-8000-000000000002',
  a: '00000000-0000-4000-8000-000000000003',
  b: '00000000-0000-4000-8000-000000000004',
};
const sid = (id) => id.replace('0000-4000', '1111-4000');
for (const [name, id] of Object.entries(ids)) {
  await query('insert into auth.users values($1,$2,now())', [id, `${name}@example.test`]);
  await query('insert into auth.sessions values($1,$2)', [sid(id), id]);
}
await query(`insert into bughunt.staff values($1,'admin'),($2,'judge')`, [ids.admin, ids.judge]);
async function as(who) {
  const id = who ? ids[who] : '';
  await query(
    `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)`,
    [id, id ? sid(id) : ''],
  );
}
await as('a');
await check('Unauthenticated access denied', async () => {
  await as(null);
  await fails('select public.bh_bootstrap()');
  await as('a');
});
let teamA, teamB;
await check('Registration and normalized uniqueness', async () => {
  teamA = await val(
    `select public.bh_register('  Team Alpha  ','Alice','University','CS','[{"name":"Alice"},{"name":"Bob"}]',false)`,
  );
  await as('b');
  await fails(
    `select public.bh_register('team alpha','Bob','University','CS','[{"name":"Bob"},{"name":"Alice"}]',false)`,
  );
  teamB = await val(
    `select public.bh_register('Team Beta','Bob','University','CS','[{"name":"Bob"},{"name":"Alice"}]',true)`,
  );
  await as('a');
});
await check('Non-staff cannot access keys or admin actions', async () => {
  await fails(`select public.bh_staff_data('questions')`);
  await fails(`select public.bh_admin('pause_all','{}','test')`);
});
await check('One competition session per team', async () => {
  assert.equal((await val('select public.bh_heartbeat()')).allowed, true);
  await query(`select set_config('request.jwt.claim.session_id',$1,false)`, [sid(ids.b)]);
  await fails('select public.bh_heartbeat()');
  await as('a');
});
await check('Unapproved and future round access rejected', async () => {
  await fails('select public.bh_start_round(1)');
  await fails('select public.bh_start_round(4)');
});
await as('admin');
for (const team of [teamA, teamB])
  await query(`select public.bh_admin('team_status',$1,'Approve test team')`, [
    JSON.stringify({ team_id: team, status: 'approved' }),
  ]);
await query(`select public.bh_admin('round','{"round":1,"status":"open"}','Open first round')`);
await as('a');
await query('select public.bh_start_round(1)');
await check('Round access never leaks answer keys', async () => {
  const state = await val('select public.bh_team_state(1)');
  assert.equal(state.questions.length, 10);
  assert.ok(!JSON.stringify(state.questions).includes('accepted'));
  assert.equal((await val('select public.bh_team_state(2)')).questions.length, 0);
});
const req = '00000000-0000-4000-8000-000000000101';
await check('Atomic answer lock, idempotency, and auto-grading', async () => {
  await query(`select public.bh_submit('R1-Q1','{"a":" false ","b":"OBJECT"}',$1)`, [req]);
  await query(`select public.bh_submit('R1-Q1','{"a":"false","b":"object"}',$1)`, [req]);
  assert.equal(await val('select count(*)::int from bughunt.submissions'), 1);
  assert.equal(Number(await val('select total_score from bughunt.teams where id=$1', [teamA])), 10);
  await fails(
    `select public.bh_submit('R1-Q1','{"a":"false","b":"object"}',gen_random_uuid())`,
    [],
    /No attempts/,
  );
});
await check('Draft optimistic concurrency', async () => {
  assert.equal(await val(`select public.bh_save_draft('R1-Q2','{"a":"x"}',0)`), 1);
  await fails(`select public.bh_save_draft('R1-Q2','{"a":"y"}',0)`, [], /another device/);
});
await check('Late submissions rejected', async () => {
  await query(
    "update bughunt.round_sessions set ends_at=now()-interval '1 second' where team_id=$1",
    [teamA],
  );
  await fails(
    `select public.bh_submit('R1-Q2','{"a":"nonzero","b":"="}',gen_random_uuid())`,
    [],
    /time/,
  );
  await query(
    "update bughunt.round_sessions set ends_at=now()+interval '20 minutes' where team_id=$1",
    [teamA],
  );
});
await check('Pause and resume preserve time; paused writes rejected', async () => {
  await as('admin');
  await query(`select public.bh_admin('round','{"round":1,"status":"paused"}','Pause for test')`);
  await as('a');
  await fails(
    `select public.bh_submit('R1-Q2','{"a":"nonzero","b":"="}',gen_random_uuid())`,
    [],
    /not open/,
  );
  await as('admin');
  await query(`select public.bh_admin('round','{"round":1,"status":"open"}','Resume test')`);
  await as('a');
});
await check('Anti-cheat penalty applies once and telemetry is idempotent', async () => {
  for (let n = 0; n < 8; n++) await query(`select public.bh_activity(1,'tab',gen_random_uuid())`);
  assert.equal(Number(await val('select total_score from bughunt.teams where id=$1', [teamA])), 0);
  assert.equal(
    await val(`select count(*)::int from bughunt.adjustments where team_id=$1`, [teamA]),
    1,
  );
});
await check('Private schema tables all have RLS and explicit policies', async () => {
  const rows = await query(
    `select c.relname,c.relrowsecurity,(select count(*) from pg_policy p where p.polrelid=c.oid)::int policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='bughunt' and c.relkind='r'`,
  );
  assert.ok(rows.length >= 20);
  for (const r of rows) {
    assert.equal(r.relrowsecurity, true, r.relname);
    assert.ok(r.policies > 0, r.relname);
  }
});
await check('Direct authenticated table access denied', async () => {
  await db.exec('set role authenticated');
  await fails('select * from bughunt.answer_keys');
  await db.exec('reset role');
});
await check('Leaderboard hidden on server, not only UI', async () => {
  const state = await val('select public.bh_public_state()');
  assert.equal(state.event.leaderboard_visible, false);
  assert.deepEqual(state.leaderboard, []);
});
await check('Review cannot exceed rubric bounds or run twice', async () => {
  await query(
    `select public.bh_submit('R1-Q3','{"a":"3 3 3","b":"change the loop variable declaration"}',gen_random_uuid())`,
  );
  const submission = await val(`select id from bughunt.submissions where question_id='R1-Q3'`);
  await as('judge');
  await fails('select public.bh_grade($1,$2,$3)', [
    submission,
    JSON.stringify({ a: 6, b: 5 }),
    'Invalid score',
  ]);
  await query('select public.bh_grade($1,$2,$3)', [
    submission,
    JSON.stringify({ a: 5, b: 5 }),
    'Equivalent answer accepted',
  ]);
  await fails('select public.bh_grade($1,$2,$3)', [
    submission,
    JSON.stringify({ a: 5, b: 5 }),
    'Second judge',
  ]);
  await as('a');
});
await check('Numeric normalization preserves token boundaries', async () => {
  assert.notEqual(
    await val(`select bughunt.normalize('[1,10,100,9]')`),
    await val(`select bughunt.normalize('[11,0,100,9]')`),
  );
  assert.equal(
    await val(`select bughunt.normalize('[1,10,100,9]')`),
    await val(`select bughunt.normalize('1 10 100 9')`),
  );
});
await as('b');
await query('select public.bh_heartbeat()');
await query('select public.bh_start_round(1)');
await as('admin');
await query(`select public.bh_admin('round','{"round":1,"status":"closed"}','Close first round')`);
await query(`select public.bh_admin('qualify','{"round":2}','Qualify all participants')`);
await query(`select public.bh_admin('round','{"round":2,"status":"open"}','Open round two')`);
await as('a');
await query('select public.bh_start_round(2)');
await check('Three attempts enforced and best attempt counts', async () => {
  for (let i = 0; i < 3; i++)
    await query(
      `select public.bh_submit('R2-C1','{"locate":"loop boundary","explain":"off by one","fix":"i < arr.length; guard empty input"}',gen_random_uuid())`,
    );
  await fails(
    `select public.bh_submit('R2-C1','{"locate":"loop","explain":"boundary","fix":"correct"}',gen_random_uuid())`,
    [],
    /No attempts/,
  );
  const submissions = await query(
    `select id from bughunt.submissions where question_id='R2-C1' order by attempt`,
  );
  await as('judge');
  for (let i = 0; i < 3; i++)
    await query('select public.bh_grade($1,$2,$3)', [
      submissions[i].id,
      JSON.stringify({ locate: 6, explain: 4, fix: i === 1 ? 10 : 0 }),
      'Review attempt',
    ]);
  assert.equal(Number(await val('select total_score from bughunt.teams where id=$1', [teamA])), 30);
  await as('a');
});
await check('Qualified teams only and immutable qualification after start', async () => {
  await as('admin');
  await fails(`select public.bh_admin('qualify','{"round":2}','Change qualifiers')`, [], /frozen/);
  await as('a');
  await fails('select public.bh_start_round(3)');
});
await as('b');
await query('select public.bh_start_round(2)');
await as('admin');
await query(`select public.bh_admin('round','{"round":2,"status":"closed"}','Close second round')`);
await query(`select public.bh_admin('qualify','{"round":3}','Qualify top 75 percent')`);
await query(`select public.bh_admin('round','{"round":3,"status":"open"}','Open third round')`);
for (const who of ['a', 'b']) {
  await as(who);
  await query('select public.bh_start_round(3)');
}
await as('admin');
await query(`select public.bh_admin('round','{"round":3,"status":"closed"}','Close third round')`);
await query(`select public.bh_admin('qualify','{"round":4}','Select finalists')`);
await query(`select public.bh_admin('round','{"round":4,"status":"open"}','Open final')`);
for (const who of ['a', 'b']) {
  await as(who);
  await query('select public.bh_start_round(4)');
}
const claim = async () =>
  await val(
    `select public.bh_claim('/login','Operator injection','Account compromise','Validate strings and compare password hashes',gen_random_uuid())`,
  );
await check('Final claim verification and single global critical bonus', async () => {
  await as('a');
  const ca = await claim();
  await as('b');
  const cb = await claim();
  await as('judge');
  await query(`select public.bh_review_claim($1,'verified',3,null,'Confirmed fix')`, [ca]);
  await query(`select public.bh_review_claim($1,'verified',3,null,'Confirmed fix')`, [cb]);
  assert.equal(await val('select count(*)::int from bughunt.first_blood'), 1);
  assert.equal(
    Number(await val('select total_score from bughunt.teams where id=$1', [teamA])),
    110,
  );
  await fails(`select public.bh_review_claim($1,'rejected',null,null,'Second review')`, [ca]);
});
await check('Duplicate bugs cannot score twice', async () => {
  await as('a');
  const c = await claim();
  await as('judge');
  await query(`select public.bh_review_claim($1,'verified',3,null,'Duplicate recognized')`, [c]);
  assert.equal(await val('select state from bughunt.claims where id=$1', [c]), 'duplicate');
});
await check('Wrong claims penalize only from the third; extras are unique', async () => {
  for (let i = 0; i < 4; i++) {
    await as('a');
    const c = await claim();
    await as('judge');
    await query(`select public.bh_review_claim($1,'rejected',null,null,'Invalid claim')`, [c]);
  }
  assert.equal(
    await val(
      `select count(*)::int from bughunt.adjustments where team_id=$1 and source like 'claim:%'`,
      [teamA],
    ),
    2,
  );
  for (let i = 0; i < 2; i++) {
    await as('a');
    const c = await claim();
    await as('judge');
    await query(
      `select public.bh_review_claim($1,'extra',null,'Network error loading state','Valid unlisted issue')`,
      [c],
    );
  }
  assert.equal(
    await val(`select count(*)::int from bughunt.claims where team_id=$1 and state='extra'`, [
      teamA,
    ]),
    1,
  );
});
await check('Report length enforced on server', async () => {
  await as('a');
  await fails(
    `select public.bh_submit('R4-REPORT',$1,gen_random_uuid())`,
    [JSON.stringify({ report: Array(151).fill('word').join(' ') })],
    /150-word/,
  );
});
await check('Finish permanently locks team round', async () => {
  await query('select public.bh_finish_round(4)');
  await fails(
    `select public.bh_submit('R4-REPORT','{"report":"Report"}',gen_random_uuid())`,
    [],
    /time/,
  );
  assert.ok(await val('select final_completed_at from bughunt.teams where id=$1', [teamA]));
});
await check('Finalization publishes certificates and freezes scores', async () => {
  await as('admin');
  await query(`select public.bh_admin('round','{"round":4,"status":"closed"}','Close final')`);
  await query(`select public.bh_admin('finalize','{}','Finalize test competition')`);
  assert.equal((await val('select public.bh_public_state()')).event.results_released, true);
  assert.ok((await val('select count(*)::int from bughunt.certificates')) >= 4);
  await fails(
    `select public.bh_admin('adjust',$1,'Late score change')`,
    [JSON.stringify({ team_id: teamA, amount: 5, request_id: crypto.randomUUID() })],
    /finalized/,
  );
});
await check('Public certificate verification reveals only intended fields', async () => {
  const id = await val('select id from bughunt.certificates limit 1');
  const result = await val('select public.bh_verify_certificate($1)', [id]);
  assert.ok(result.team_name);
  assert.ok(!result.team_id && !result.email && !result.members);
});
await check('Every privileged function fixes its search path', async () => {
  const rows = await query(
    `select p.proname,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='bughunt' or (n.nspname='public' and p.proname like 'bh_%')) and p.prosecdef`,
  );
  for (const r of rows)
    assert.ok(
      r.proconfig.some((x) => x.startsWith('search_path=')),
      r.proname,
    );
});
console.log(`${tests} database checks passed.`);
await db.close();
