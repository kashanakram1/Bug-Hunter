// Isolated PGlite only: never reads .env or contacts production.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url),
  db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true),'aal','aal1')$$;`);
for (const name of readdirSync(new URL("backend/supabase/migrations/", root))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await db.exec(
    readFileSync(new URL("backend/supabase/migrations/" + name, root), "utf8"),
  );
await db.exec("update bughunt.event set onsite_date=(clock_timestamp() at time zone event_timezone)::date where id");
const content = JSON.parse(
  readFileSync(new URL("private/official-content.json", root), "utf8"),
);
for (const q of content.questions) {
  const { explanation, rubric, accepted, ...row } = q;
  await db.query(
    "insert into bughunt.questions select * from jsonb_populate_record(null::bughunt.questions,$1)",
    [JSON.stringify(row)],
  );
  await db.query("insert into bughunt.answer_keys values($1,$2,$3,$4)", [
    q.id,
    explanation,
    JSON.stringify(rubric),
    JSON.stringify(accepted),
  ]);
}
const val = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
let count = 0;
const check = async (name, fn) => {
  await fn();
  console.log("PASS", name);
  count++;
};
async function window(offset) {
  await db.exec(
    `update bughunt.event set online_enabled=true,online_starts_at=now()+interval '${offset} minutes',online_entry_closes_at=now()+interval '${offset + 20} minutes',online_ends_at=now()+interval '${offset + 100} minutes' where id`,
  );
}
async function team(status = "approved", staff = false) {
  const u = randomUUID(),
    sid = randomUUID();
  await db.query("insert into auth.users values($1,$2,now())", [
    u,
    u + "@example.test",
  ]);
  await db.query("insert into auth.sessions values($1,$2)", [sid, u]);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",
    [u, sid],
  );
  if (staff)
    await db.query("insert into bughunt.staff values($1,'admin')", [u]);
  const t = await val(
    "insert into bughunt.teams(owner_id,name,leader,email,university,department,members,status) values($1,$2,'Leader','team@example.test','University','CS','[{\"name\":\"A\"},{\"name\":\"B\"}]',$3) returning id",
    [u, "Team " + u.slice(0, 8), status],
  );
  await val("select public.bh_heartbeat()");
  return t;
}
try {
  await window(100);
  const t = await team();
  await db.exec("update bughunt.event set unlimited_testing=true,onsite_date='2099-01-01' where id; update bughunt.rounds set status='paused',paused_at=now()");
  await check('All four tests open despite future schedule and paused rounds',async()=>{
    const boot=await val('select public.bh_bootstrap()');
    assert.equal(boot.online.testing,true); assert.equal(boot.online.enabled,false);
    assert.equal(boot.online.ends_at,null); assert.equal(boot.rounds.length,4);
    assert.ok(boot.rounds.every(r=>r.status==='open' && r.paused_at===null));
    assert.equal((await val('select public.bh_team_state(4)')).questions.length,0);
  });
  await check('Enter final first without qualification or on-site date',async()=>{
    const session=await val('select public.bh_start_round(4)');
    assert.equal(session.ends_at,null); assert.equal(session.completed_at,null);
    const state=await val('select public.bh_team_state(4)');
    assert.equal(state.testing,true); assert.ok(state.questions.length>0);
    assert.ok(state.questions.some(q=>q.kind==='arena'));
    const request=randomUUID();
    const claim=await val("select public.bh_claim('test location','test cause','test impact','test fix',$1)",[request]);
    assert.equal(await val("select public.bh_claim('test location','test cause','test impact','test fix',$1)",[request]),claim);
  });
  await check('Every round is writable without changing official sessions',async()=>{
    for (const r of [3,1,2]) {
      await val('select public.bh_start_round($1)',[r]);
      const state=await val('select public.bh_team_state($1)',[r]);
      assert.ok(state.questions.length>0); assert.equal(state.session.ends_at,null);
      assert.equal(state.self_progression,false); assert.equal(state.online_entered,false);
      const q=state.questions[0], answer=Object.fromEntries(q.fields.map(f=>[f.key,'testing answer']));
      await val('select public.bh_save_draft($1,$2,0)',[q.id,JSON.stringify(answer)]);
      const request=randomUUID();
      const result=await val('select public.bh_submit($1,$2,$3)',[q.id,JSON.stringify(answer),request]);
      assert.equal((await val('select public.bh_submit($1,$2,$3)',[q.id,JSON.stringify(answer),request])).id,result.id);
      await val("select public.bh_activity($1,'tab',$2)",[r,randomUUID()]);
      if (r===1) await assert.rejects(()=>val('select public.bh_submit($1,$2,$3)',[q.id,JSON.stringify(answer),randomUUID()]),/No attempts/);
      await val('select public.bh_finish_round($1)',[r]);
      await val('select public.bh_start_round($1)',[r]);
    }
    assert.equal(await val('select count(*)::integer from bughunt.round_sessions where team_id=$1',[t]),0);
    assert.equal(await val('select count(*)::integer from bughunt.submissions where team_id=$1',[t]),3);
    assert.equal(await val('select count(*)::integer from bughunt.testing_sessions where team_id=$1',[t]),4);
  });
  await check('Expired old competition sessions do not block testing or get modified',async()=>{
    await db.query("insert into bughunt.round_sessions(team_id,round_id,started_at,ends_at,completed_at) values($1,1,now()-interval '2 days',now()-interval '1 day',now()-interval '1 day')",[t]);
    const before=await val('select to_jsonb(s) from bughunt.round_sessions s where team_id=$1',[t]);
    await window(-1000);
    for(const r of [1,2,3,4]) { await val('select public.bh_start_round($1)',[r]); assert.equal((await val('select public.bh_team_state($1)',[r])).session.ends_at,null); }
    assert.deepEqual(await val('select to_jsonb(s) from bughunt.round_sessions s where team_id=$1',[t]),before);
  });
  await check('Pending teams cannot enter and browser roles cannot read test sessions',async()=>{
    await team('pending');
    await assert.rejects(()=>val('select public.bh_start_round(4)'),/Approval required/);
    assert.equal((await val('select public.bh_team_state(4)')).questions.length,0);
    for(const role of ['anon','authenticated','service_role']) assert.equal(await val("select has_table_privilege($1,'bughunt.testing_sessions','SELECT')",[role]),false);
  });
  await check('Closing test mode restores schedule and final restrictions',async()=>{
    await team(); await db.exec('update bughunt.event set unlimited_testing=false where id');
    assert.notEqual((await val('select public.bh_bootstrap()')).online.phase,'testing');
    await assert.rejects(()=>val('select public.bh_start_round(1)'),/scheduled window/);
    await assert.rejects(()=>val('select public.bh_start_round(4)'),/on-site date/);
  });
  console.log(count+' unlimited testing checks passed');
} finally { await db.close(); }
