// Isolated PGlite only. No .env, provider access, or production data.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),db=new PGlite();
try {
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;");
 for(const f of readdirSync(new URL('backend/supabase/migrations/',root)).filter(f=>f.startsWith('20261009')||f.startsWith('20261011')).sort())await db.exec(readFileSync(new URL('backend/supabase/migrations/'+f,root),'utf8'));
 const ids=[];
 for(let i=0;i<3;i++){const u=randomUUID();await db.query('insert into auth.users values($1,$2,now())',[u,'synthetic'+i+'@example.test']);const t=(await db.query("insert into bughunt.teams(owner_id,name,leader,email,university,department,members,status,total_score) values($1,$2,'Leader','synthetic@example.test','University','CS','[{\"name\":\"A\"},{\"name\":\"B\"}]','approved',20) returning id",[u,'Synthetic '+i])).rows[0].id;ids.push(t);for(let r=1;r<=(i===0?1:2);r++)await db.query("insert into bughunt.round_sessions(team_id,round_id,ends_at) values($1,$2,now()+interval '20 minutes')",[t,r]);}
 const sql=readFileSync(new URL('backend/supabase/migrations/202610130000_archive_rehearsal.sql',root),'utf8');
 await db.exec('begin');await db.exec(sql);await db.exec('commit');
 const snapshot=(await db.query('select payload from bughunt.rehearsal_archive')).rows[0].payload;
 assert.equal(snapshot.teams.length,3);assert.equal(snapshot.records.round_sessions.length,5);
 assert.equal((await db.query('select count(*) n from bughunt.round_sessions')).rows[0].n,0);
 assert.equal((await db.query("select count(*) n from bughunt.teams where status='approved' and total_score=0")).rows[0].n,3);
 assert.equal((await db.query('select count(*) n from auth.users')).rows[0].n,3);
 assert.equal((await db.query("select count(*) n from bughunt.audit where action='archive_rehearsal'")).rows[0].n,1);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from bughunt.rehearsal_archive'));await db.exec('reset role');
 console.log('PASS rehearsal snapshot, scoped progress reset, preserved accounts/registration/approval, audit provenance, and archive access denial.');
}finally{await db.close();}
