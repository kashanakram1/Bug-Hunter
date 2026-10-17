// Isolated registration concurrency: real gateway + PostgreSQL; Auth/SMTP are test doubles.
// Never reads .env, never sends mail, and never contacts production.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID,randomInt} from 'node:crypto';
import {Client,Pool} from 'pg';
const root=new URL('../../',import.meta.url),name='bh_registration_'+Date.now();
const control=new Client({host:'127.0.0.1',port:55432,user:'postgres',database:'postgres'});
const require=createRequire(new URL('frontend/package.json',root)),ts=require('typescript');
writeFileSync(new URL('private/registration-gateway-test.mjs',root),ts.transpileModule(readFileSync(new URL('backend/src/web-api.ts',root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {handleWebApi}=await import(new URL('private/registration-gateway-test.mjs',root));
let pool;const savedFetch=globalThis.fetch;
const origin='https://registration.isolated.invalid',provider='https://auth.isolated.invalid';
const people=new Map(),times={signup:[],verify:[],register:[]};let checks=0;
const result=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function check(label,fn){await fn();checks++;console.log('PASS '+label);}
function claims(token){try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{return{};}}
function jwt(user,sid){return 'fixture.'+Buffer.from(JSON.stringify({sub:user.id,session_id:sid,aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';}
async function call(path,body={},cookie){const start=performance.now();const r=await handleWebApi(new Request(origin+'/api/'+path,{method:'POST',headers:{Host:'registration.isolated.invalid',Origin:origin,'Content-Type':'application/json','X-BugHunt-Request':'1',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)}),path);return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],ms:performance.now()-start};}
try{
 await control.connect();await control.query('create database '+name);
 pool=new Pool({host:'127.0.0.1',port:55432,user:'postgres',database:name,max:30,connectionTimeoutMillis:15000});
 await pool.query("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true),'aal','aal1')$$;");
 for(const f of readdirSync(new URL('backend/supabase/migrations/',root)).filter(f=>f.endsWith('.sql')).sort())await pool.query(readFileSync(new URL('backend/supabase/migrations/'+f,root),'utf8'));
 process.env.SUPABASE_URL=provider;process.env.SUPABASE_PUBLISHABLE_KEY='isolated-public';process.env.SUPABASE_SECRET_KEY='isolated-registration-secret';delete process.env.VERCEL;
 const originalSettings=(await pool.query('select to_jsonb(e) value from bughunt.event e')).rows[0].value;
 globalThis.fetch=async(url,opts={})=>{
  url=String(url);assert.ok(url.startsWith(provider+'/'),'Test must never access an external service');
  const body=JSON.parse(opts.body||'{}'),headers=new Headers(opts.headers),identity=claims((headers.get('authorization')||'').replace('Bearer ',''));
  if(url.includes('/rest/v1/rpc/')){
   const rpc=url.split('/').at(-1);assert.match(rpc,/^bh_[a-z_]+$/);const entries=Object.entries(body),c=await pool.connect();
   try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)",[identity.sub||'',identity.session_id||'']);await c.query(identity.sub?'set local role authenticated':'set local role service_role');
    const q=await c.query('select public.'+rpc+'('+entries.map(([k],i)=>k+' => $'+(i+1)).join(',')+') value',entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));await c.query('commit');return result(q.rows[0].value);
   }catch(e){await c.query('rollback');return result({code:e.code,message:e.message},400);}finally{c.release();}
  }
  if(url.endsWith('/auth/v1/signup')){
   let p=people.get(body.email);if(p?.confirmed)return result({identities:[]});
   if(!p){p={id:randomUUID(),email:body.email,password:body.password,code:String(randomInt(10000000,100000000)),confirmed:false,used:false};people.set(body.email,p);await pool.query('insert into auth.users values($1,$2,null)',[p.id,p.email]);}
   return result({id:p.id,email:p.email,identities:[{id:p.id}]});
  }
  if(url.endsWith('/auth/v1/verify')){
   const p=people.get(body.email);if(!p||p.code!==body.token||p.used)return result({message:'Invalid or expired code'},403);
   p.used=true;p.confirmed=true;await pool.query('update auth.users set email_confirmed_at=now() where id=$1',[p.id]);
   const sid=randomUUID();await pool.query('insert into auth.sessions values($1,$2)',[sid,p.id]);return result({access_token:jwt(p,sid),refresh_token:'fixture-refresh',expires_in:3600});
  }
  if(url.endsWith('/auth/v1/user')){const p=[...people.values()].find(p=>p.id===identity.sub);return p?result({id:p.id,email:p.email}):result({message:'Not signed in'},401);}
  throw Error('Unimplemented isolated provider route');
 };
 const users=Array.from({length:25},(_,i)=>({email:'participant'+i+'@example.test'}));
 await check('25 simultaneous signups stay independent and create unconfirmed accounts',async()=>{
  await Promise.all(users.map(async u=>{const r=await call('auth/signup',{email:u.email,password:'123456'});assert.equal(r.status,200);assert.equal(r.data.accepted,true);assert.equal(r.cookie,undefined);times.signup.push(r.ms);}));
  assert.equal((await pool.query('select count(*)::integer n from auth.users where email_confirmed_at is null')).rows[0].n,25);
 });
 await check('Wrong codes and unauthenticated registration cannot create a team',async()=>{
  const bad=await call('auth/verify-email',{email:users[0].email,code:'00000000',type:'signup'});assert.equal(bad.status,400);assert.equal(bad.cookie,undefined);
  assert.equal((await call('rpc/bh_register',{})).status,401);assert.equal((await pool.query('select count(*)::integer n from bughunt.teams')).rows[0].n,0);
  const p=people.get(users[0].email),sid=randomUUID();await pool.query('insert into auth.sessions values($1,$2)',[sid,p.id]);
  const unconfirmed=await fetch(provider+'/rest/v1/rpc/bh_register',{method:'POST',headers:{Authorization:'Bearer '+jwt(p,sid)},body:JSON.stringify({p_name:'Unconfirmed Team',p_leader:'L',p_university:'U',p_department:'CS',p_members:[{name:'L'},{name:'M'}],p_newcomer:false})});
  assert.equal(unconfirmed.status,400);assert.match((await unconfirmed.json()).message,/Confirm your email/);
 });
 await check('25 simultaneous code verifications create separate secure sessions',async()=>{
  await Promise.all(users.map(async u=>{const r=await call('auth/verify-email',{email:u.email,code:people.get(u.email).code,type:'signup'});assert.equal(r.status,200);assert.equal(r.data.verified,true);assert.ok(r.cookie);u.cookie=r.cookie;times.verify.push(r.ms);}));
  assert.equal(new Set(users.map(u=>u.cookie)).size,25);
 });
 await check('25 simultaneous team registrations preserve account ownership and pending approval',async()=>{
  await Promise.all(users.map(async(u,i)=>{const r=await call('rpc/bh_register',{p_name:'Registration Team '+i,p_leader:'Leader '+i,p_university:'Test University',p_department:'CS',p_members:[{name:'Leader '+i},{name:'Member '+i}],p_newcomer:false},u.cookie);assert.equal(r.status,200);times.register.push(r.ms);u.team=r.data;}));
  const teams=(await pool.query('select owner_id,email,status from bughunt.teams')).rows;assert.equal(teams.length,25);
  for(const u of users){assert.ok(teams.some(t=>t.owner_id===people.get(u.email).id&&t.email===u.email&&t.status==='pending'));const b=await call('rpc/bh_bootstrap',{},u.cookie);assert.equal(b.status,200);assert.equal(b.data.team.email,u.email);assert.equal(b.data.online.phase,'scheduled');}
 });
 await check('Consumed codes, duplicate registrations, invalid teams and launch-lock bypasses fail safely',async()=>{
  const u=users[0];assert.equal((await call('auth/verify-email',{email:u.email,code:people.get(u.email).code,type:'signup'})).status,400);
  const duplicate=await call('auth/signup',{email:u.email,password:'123456'});assert.equal(duplicate.data.alreadyRegistered,true);
  const duplicateTeam=await call('rpc/bh_register',{p_name:'Another Team',p_leader:'L',p_university:'U',p_department:'CS',p_members:[{name:'L'},{name:'M'}],p_newcomer:false},u.cookie);assert.equal(duplicateTeam.status,400);
  const bad=await call('rpc/bh_register',{p_name:'Duplicate team',p_leader:'L',p_university:'U',p_department:'CS',p_members:[{name:'A'}],p_newcomer:false},u.cookie);assert.equal(bad.status,400);
  const locked=await call('rpc/bh_start_round',{p_round:1},u.cookie);assert.equal(locked.status,400);
  assert.deepEqual((await pool.query('select to_jsonb(e) value from bughunt.event e')).rows[0].value,originalSettings);
  assert.equal((await pool.query('select count(*)::integer n from bughunt.teams')).rows[0].n,25);
 });
 await check('Concurrent code guessing respects the shared per-account verification limit',async()=>{
  const results=await Promise.all(Array.from({length:20},()=>call('auth/verify-email',{email:'guessing@example.test',code:'00000000',type:'signup'})));
  assert.equal(results.filter(r=>r.status===400).length,10);
  assert.equal(results.filter(r=>r.status===429).length,10);
  assert.ok(results.every(r=>!r.cookie));
 });
 const summary=Object.fromEntries(Object.entries(times).map(([k,v])=>{v.sort((a,b)=>a-b);return[k,{requests:v.length,p50_ms:Math.round(v[Math.floor(v.length*.5)]),p95_ms:Math.round(v[Math.floor(v.length*.95)]),max_ms:Math.round(v.at(-1))}];}));
 const report={environment:'Local PostgreSQL and real web gateway; Auth/SMTP simulated; production email throughput not measured',concurrent_users:25,unexpected_errors:0,checks,metrics:summary};
 writeFileSync(new URL('private/registration-concurrency-result.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{globalThis.fetch=savedFetch;if(pool)await pool.end();if(control._connected){await control.query('drop database if exists '+name).catch(()=>{});await control.end();}}
