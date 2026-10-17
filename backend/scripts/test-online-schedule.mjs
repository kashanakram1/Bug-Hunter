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
    `update bughunt.event set online_enabled=true,online_starts_at=now()+interval '${offset} minutes',online_entry_closes_at=now()+interval '${offset + 30} minutes',online_ends_at=now()+interval '${offset + 110} minutes' where id`,
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
  await check('Final configuration matches the approved 18 October schedule', async () => {
    const e = await val('select to_jsonb(e) from bughunt.event e where id');
    assert.equal(e.unlimited_testing, false);
    assert.equal(e.online_enabled, true);
    assert.equal(Date.parse(e.online_starts_at), Date.parse('2026-10-18T16:00:00+05:00'));
    assert.equal(Date.parse(e.online_entry_closes_at), Date.parse('2026-10-18T16:30:00+05:00'));
    assert.equal(Date.parse(e.online_ends_at), Date.parse('2026-10-18T17:50:00+05:00'));
    assert.deepEqual((await db.query('select duration_seconds from bughunt.rounds order by id')).rows.map(r => r.duration_seconds), [1200,1800,1800,2400]);
    assert.equal(await val('select status from bughunt.rounds where id=4'), 'draft');
  });
  await window(10);
  let t = await team();
  await check(
    "Before the start: no entry and no question disclosure",
    async () => {
      await assert.rejects(
        () => val("select public.bh_start_round(1)"),
        /scheduled window/,
      );
      assert.equal(
        (await val("select public.bh_team_state(1)")).questions.length,
        0,
      );
      assert.ok(
        (await val("select public.bh_bootstrap()")).rounds
          .filter((r) => r.id <= 3)
          .every((r) => r.status === "draft"),
      );
    },
  );
  await window(-10);
  await check("Rounds 1-3 open together without qualification", async () => {
    const b = await val("select public.bh_bootstrap()");
    assert.ok(
      b.rounds.filter((r) => r.id <= 3).every((r) => r.status === "open"),
    );
    await assert.rejects(
      () => val("select public.bh_start_round(2)"),
      /Start with Round 1/,
    );
    const s = await val("select public.bh_start_round(1)");
    assert.equal(s.round_id, 1);
    assert.equal(
      (await val("select public.bh_team_state(1)")).questions.length,
      10,
    );
  });
  await check(
    "Entering establishes a continuous 80-minute personal deadline",
    async () => {
      const d = await val("select public.bh_team_state(1)");
      assert.equal(
        Date.parse(d.team_ends_at) - Date.parse(d.session.started_at),
        4800000,
      );
      assert.equal(
        Date.parse(d.session.ends_at) - Date.parse(d.session.started_at),
        1200000,
      );
    },
  );
  await check(
    "The separate final cannot start during the online competition",
    async () => {
      await assert.rejects(
        () => val("select public.bh_start_round(4)"),
        /online competition must end/,
      );
    },
  );
  await check("A valid answer submits before moving forward", async () => {
    const result = await val("select public.bh_submit('R1-Q1',$1,$2)", [JSON.stringify({a:'false',b:'object'}),randomUUID()]);
    assert.ok(result.id);
  });
  await check("Skipping an intermediate round is rejected", async () => {
    await assert.rejects(
      () => val("select public.bh_start_round(3)"),
      /locked/,
    );
  });
  await check(
    "Early transition works with unanswered questions and permanently locks Round 1",
    async () => {
      await val("select public.bh_finish_round(1)");
      const s = await val("select public.bh_start_round(2)");
      assert.equal(s.round_id, 2);
      await assert.rejects(
        () => val("select public.bh_start_round(1)"),
        /locked/,
      );
      await assert.rejects(
        () =>
          val("select public.bh_save_draft('R1-Q1',$1,0)", [
            JSON.stringify({ output: "x" }),
          ]),
        /locked/,
      );
      const old = await val("select public.bh_team_state(1)");
      assert.equal(old.questions.length, 0);
      assert.equal(old.drafts.length, 0);
    },
  );
  await check(
    "Delayed focus observations remain idempotent after moving forward",
    async () => {
      const request = randomUUID();
      const a = await val("select public.bh_activity(1,'tab',$1)", [request]);
      const b = await val("select public.bh_activity(1,'tab',$1)", [request]);
      assert.equal(a.tab_count, 1);
      assert.equal(b.tab_count, 1);
    },
  );
  await check(
    "Retrying a completed transition never finishes the next round",
    async () => {
      await val("select public.bh_finish_round(1)");
      assert.equal(
        (await val("select public.bh_team_state(2)")).active_round,
        2,
      );
    },
  );
  await check(
    "Finishing Round 3 early ends the competition for that team",
    async () => {
      await val("select public.bh_finish_round(2)");
      await val("select public.bh_finish_round(3)");
      assert.equal(
        (await val("select public.bh_team_state(3)")).active_round,
        null,
      );
      await assert.rejects(
        () => val("select public.bh_start_round(3)"),
        /locked/,
      );
    },
  );
  await window(-30);
  await check("Entry closes at the exact 30-minute boundary", async () => {
    await team();
    await assert.rejects(
      () => val("select public.bh_start_round(1)"),
      /entry window/,
    );
  });
  await window(-29);
  await check("A late entrant still receives 80 minutes", async () => {
    t = await team();
    await val("select public.bh_start_round(1)");
    const d = await val("select public.bh_team_state(1)");
    assert.equal(
      Date.parse(d.team_ends_at) - Date.parse(d.session.started_at),
      4800000,
    );
    assert.ok(
      Date.parse(d.team_ends_at) > Date.parse(d.online.starts_at) + 80 * 60000,
    );
  });
  await check(
    "Reconnection after entry closes resumes an existing team",
    async () => {
      await window(-31);
      const s = await val("select public.bh_start_round(1)");
      assert.equal(s.team_id, t);
    },
  );
  await check(
    "Expired round advances automatically, preserving elapsed offline time",
    async () => {
      await db.query(
        "update bughunt.round_sessions set started_at=now()-interval '25 minutes',ends_at=now()-interval '5 minutes' where team_id=$1 and round_id=1",
        [t],
      );
      const d = await val("select public.bh_team_state(1)");
      assert.equal(d.active_round, 2);
      const next = await val("select public.bh_team_state(2)");
      const remaining =
        Date.parse(next.session.ends_at) - Date.parse(next.server_time);
      assert.ok(remaining <= 25 * 60000 && remaining > 24 * 60000);
    },
  );
  await check(
    "The personal 80-minute cutoff locks all remaining work",
    async () => {
      await db.query(
        "update bughunt.round_sessions set started_at=now()-interval '81 minutes' where team_id=$1 and round_id=1",
        [t],
      );
      const d = await val("select public.bh_team_state(2)");
      assert.equal(d.active_round, null);
      assert.equal(d.questions.length, 0);
      await assert.rejects(
        () => val("select public.bh_start_round(2)"),
        /locked/,
      );
    },
  );
  await check("Answer writes cannot exceed the personal cutoff", async () => {
    await assert.rejects(() => val("select public.bh_submit('R2-C1',$1,$2)", [JSON.stringify({a:'answer'}),randomUUID()]), /locked/);
  });
  await check("Unapproved teams cannot enter", async () => {
    await window(-5);
    await team("pending");
    await assert.rejects(
      () => val("select public.bh_start_round(1)"),
      /Approval/,
    );
  });
  await check(
    "Administrator cannot manually open, pause, qualify, or extend scheduled rounds",
    async () => {
      await team("approved", true);
      for (const [action, payload] of [
        ["round", { round: 1, status: "open" }],
        ["round", { round: 2, status: "paused" }],
        ["extend", { round: 3, seconds: 300 }],
        ["qualify", { round: 2 }],
        ["pause_all", {}],
      ])
        await assert.rejects(
          () =>
            val("select public.bh_admin($1,$2,$3)", [
              action,
              JSON.stringify(payload),
              "Schedule test",
            ]),
          /fixed event schedule/,
        );
    },
  );
  await window(-111);
  await check(
    "After the latest deadline: all online rounds display closed",
    async () => {
      const b = await val("select public.bh_bootstrap()");
      assert.ok(
        b.rounds.filter((r) => r.id <= 3).every((r) => r.status === "closed"),
      );
      await assert.rejects(
        () => val("select public.bh_start_round(1)"),
        /scheduled window/,
      );
    },
  );
  await check("Finalized results cannot change through delayed telemetry", async () => {
    await window(-5); await team(); await val('select public.bh_start_round(1)');
    await db.exec('update bughunt.event set results_released=true where id');
    await assert.rejects(() => val("select public.bh_activity(1,'tab',$1)",[randomUUID()]), /finalized/);
    await db.exec('update bughunt.event set results_released=false where id');
  });
  await check("The final is date-gated and requires published qualification", async () => {
    await window(-111);
    const finalist = await team('approved', true);
    await db.exec("update bughunt.rounds set status='open' where id=4; update bughunt.event set onsite_date=(clock_timestamp() at time zone event_timezone)::date+1 where id");
    await assert.rejects(() => val('select public.bh_start_round(4)'), /on-site date/);
    await assert.rejects(() => val("select public.bh_admin('round','{\"round\":4,\"status\":\"open\"}','Final test')"), /on-site date/);
    await db.exec("update bughunt.event set onsite_date=(clock_timestamp() at time zone event_timezone)::date where id");
    await assert.rejects(() => val('select public.bh_start_round(4)'), /qualified/);
    await db.query('insert into bughunt.qualifications values($1,4,true)',[finalist]);
    const session=await val('select public.bh_start_round(4)');
    assert.equal(Date.parse(session.ends_at)-Date.parse(session.started_at),40*60000);
    assert.ok((await val('select public.bh_team_state(4)')).questions.length);
    await db.exec("update bughunt.event set onsite_date=(clock_timestamp() at time zone event_timezone)::date-1 where id");
    assert.equal((await val('select public.bh_team_state(4)')).questions.length,0);
    await assert.rejects(() => val('select public.bh_finish_round(4)'), /on-site date/);
  });
  await check("Rehearsal rounds can open together without closing earlier rounds", async () => {
    await db.exec("update bughunt.event set online_enabled=false,self_progression=true where id; update bughunt.rounds set status='draft',paused_at=null where id<=3");
    await team('approved',true);
    for (const round of [1,2,3]) await val("select public.bh_admin('round',$1,'')",[JSON.stringify({round,status:'open'})]);
    assert.equal((await db.query("select id from bughunt.rounds where id<=3 and status='open'")).rows.length,3);
  });
  await check("Team advancement ignores previous round open, paused, and closed states", async () => {
    for (const status of ['open','paused','closed']) {
      await db.exec("update bughunt.rounds set status='open' where id=1");
      await team();
      await val('select public.bh_start_round(1)');
      await db.query('update bughunt.rounds set status=$1 where id=1',[status]);
      const next=await val('select public.bh_start_round(2)');
      assert.equal(next.round_id,2);
      assert.equal(Date.parse(next.ends_at)-Date.parse(next.started_at),30*60000);
      await assert.rejects(()=>val('select public.bh_start_round(1)'),/locked/);
      await db.exec("update bughunt.rounds set status='paused' where id=2");
      await val('select public.bh_finish_round(2)');
      assert.equal((await val('select public.bh_team_state(3)')).active_round,3);
    }
  });
  await check(
    "All scheduling helpers are inaccessible directly to browser roles",
    async () => {
      await db.exec("set role authenticated");
      await assert.rejects(() => val("select bughunt.sync_online($1)", [t]));
      await assert.rejects(() => val("select bughunt.online_window()"));
      await db.exec("reset role");
    },
  );
  console.log(count + " online scheduling checks passed.");
} finally {
  await db.close();
}
