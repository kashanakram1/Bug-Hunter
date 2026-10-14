import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const require=createRequire(new URL('frontend/package.json',root));
const ts=require('typescript');
// Compile the real server module for a dependency-injected HTTP integration test.
const compiled=ts.transpileModule(readFileSync(new URL('backend/src/web-api.ts',root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
writeFileSync(new URL('private/web-api-security-test.mjs',root),compiled);
const {handleWebApi}=await import(new URL('private/web-api-security-test.mjs',root));
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS',name);}
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true),'aal',current_setting('request.jwt.claim.aal',true))$$;`);
for(const file of readdirSync(new URL('backend/supabase/migrations/',root)).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL('backend/supabase/migrations/'+file,root),'utf8'));
await db.exec('update bughunt.event set online_enabled=false,self_progression=false where id');
const uid='00000000-0000-4000-8000-000000000001',sid='00000000-1111-4000-8000-000000000001';
await db.query('insert into auth.users values($1,$2,now())',[uid,'staff@example.test']);await db.query('insert into auth.sessions values($1,$2)',[sid,uid]);await db.query("insert into bughunt.staff values($1,'admin')",[uid]);
await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false),set_config('request.jwt.claim.aal','aal1',false)",[uid,sid]);
await check('Password-authenticated staff can access controls without MFA',async()=>{assert.equal((await db.query('select public.bh_bootstrap() value')).rows[0].value.role,'admin');assert.ok((await db.query("select public.bh_staff_data('overview') value")).rows[0].value);});
await check('Non-staff and anonymous identities cannot access staff controls',async()=>{await db.exec("insert into auth.users values('00000000-0000-4000-8000-000000000099','team@example.test',now()); insert into auth.sessions values('00000000-1111-4000-8000-000000000099','00000000-0000-4000-8000-000000000099'); select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false),set_config('request.jwt.claim.session_id','00000000-1111-4000-8000-000000000099',false)");await assert.rejects(()=>db.query("select public.bh_staff_data('overview')"),/Staff access required/);await db.exec("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(()=>db.query("select public.bh_staff_data('overview')"));await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[uid,sid]);});
await check('Administrator actions accept empty reasons and record an automatic audit description',async()=>{await db.query("select public.bh_admin('settings','{\"registration_open\":true}','')");const row=(await db.query("select reason from bughunt.audit where action='settings' order by created_at desc limit 1")).rows[0];assert.equal(row.reason,'Organizer action: settings');});
await check('Authenticated direct calls cannot bypass per-user read limits',async()=>{for(let i=0;i<119;i++)await db.query('select public.bh_bootstrap()');await assert.rejects(()=>db.query('select public.bh_bootstrap()'),/Rate limit/);});
await check('Anonymous direct public RPC and gateway budget calls are denied',async()=>{await db.exec('set role anon');await assert.rejects(()=>db.query('select public.bh_public_state()'));await assert.rejects(()=>db.query("select public.bh_gateway_budget('rpc',repeat('a',64),null)"));await db.exec('reset role');});
await check('Authenticated clients cannot impersonate the gateway',async()=>{await db.exec('set role authenticated');await assert.rejects(()=>db.query("select public.bh_gateway_budget('rpc',repeat('a',64),null)"));await db.exec('reset role');});
await check('Service gateway public reads are allowed',async()=>{await db.exec('set role service_role');assert.ok((await db.query('select public.bh_public_state() value')).rows[0].value);await db.exec('reset role');});
await check('Gateway recovery budget persists denial without an exception',async()=>{for(let i=0;i<3;i++)assert.equal((await db.query("select public.bh_gateway_budget('recover',repeat('a',64),repeat('b',64)) value")).rows[0].value.allowed,true);assert.equal((await db.query("select public.bh_gateway_budget('recover',repeat('a',64),repeat('b',64)) value")).rows[0].value.allowed,false);});
await check('Signup quotas are per account and report the remaining fixed-window wait',async()=>{
 for(let i=0;i<3;i++)assert.equal((await db.query("select public.bh_gateway_budget('signup',repeat('c',64),repeat('d',64)) value")).rows[0].value.allowed,true);
 const limited=(await db.query("select public.bh_gateway_budget('signup',repeat('c',64),repeat('d',64)) value")).rows[0].value;
 const expected=(await db.query("select ceil(extract(epoch from window_start+interval '1 hour'-clock_timestamp()))::integer seconds from bughunt.request_budgets where bucket='account:signup' and subject=repeat('d',64)")).rows[0].seconds;
 assert.equal(limited.limit_scope,'account');assert.ok(Math.abs(limited.retry_after-expected)<=1);
 assert.equal((await db.query("select public.bh_gateway_budget('signup',repeat('c',64),repeat('e',64)) value")).rows[0].value.allowed,true);
});
await check('Budget resets at a new window and stores no plaintext email/IP',async()=>{await db.exec("update bughunt.request_budgets set window_start=now()-interval '2 hours' where bucket='account:recover'");assert.equal((await db.query("select public.bh_gateway_budget('recover',repeat('a',64),repeat('b',64)) value")).rows[0].value.allowed,true);const rows=(await db.query("select subject from bughunt.request_budgets where bucket like 'account:%' or bucket like 'gateway:%'")).rows;assert.ok(rows.every(x=>/^[a-f0-9]{64}$/.test(x.subject)));});
await check('Rate budget table has RLS and denies browser access',async()=>{assert.equal((await db.query("select relrowsecurity value from pg_class where oid='bughunt.request_budgets'::regclass")).rows[0].value,true);await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from bughunt.request_budgets'));await db.exec('reset role');});
await check('Audit minimization preserves provenance without duplicating answers or rosters',async()=>{await db.query(`select bughunt.audit_write('test','object','{"score":10,"answer":{"text":"private"},"members":["private"],"email":"private"}','{"score":20,"access_token":"private"}','decision')`);const row=(await db.query("select old_value,new_value,reason from bughunt.audit where action='test'")).rows[0];assert.deepEqual(row.old_value,{score:10});assert.deepEqual(row.new_value,{score:20});assert.equal(row.reason,'decision');});
await db.close();

const originalFetch=globalThis.fetch;
const previous={...process.env};
Object.assign(process.env,{SUPABASE_URL:'https://isolated.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated',SUPABASE_SECRET_KEY:'sb_secret_isolated_test_only',VERCEL:'1'});
const token='test.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,aal:'aal1'})).toString('base64url')+'.test';
let allowed=true,failed=false,calls=[],teamLogin=false,deviceAllowed=true,providerFailure=null,sessionSeconds=3600,refreshStatus=200,verificationFailure=false,userStatus=200;
globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:options?.body,headers:options?.headers});if(failed)throw Error('isolated transport outage');let data={};
 if(providerFailure && /\/auth\/v1\/(signup|recover)/.test(String(url)))return new Response(JSON.stringify(providerFailure.body),{status:providerFailure.status,headers:{'Content-Type':'application/json',...providerFailure.headers}});
 if(String(url).includes('grant_type=refresh_token')&&refreshStatus!==200)return new Response(JSON.stringify({msg:'Temporary refresh failure'}),{status:refreshStatus,headers:{'Retry-After':'37'}});
 if(String(url).endsWith('/auth/v1/verify')&&verificationFailure)return new Response(JSON.stringify({error_code:'otp_expired',msg:'Token expired'}),{status:403});
 if(String(url).endsWith('/auth/v1/user')&&options?.method==='GET'&&userStatus!==200)return new Response(JSON.stringify({msg:'User lookup failed'}),{status:userStatus});
 if(String(url).endsWith('bh_gateway_budget'))data={allowed,retry_after:600};
 else if(String(url).includes('/auth/v1/token'))data={access_token:token,refresh_token:'isolated-refresh',expires_in:sessionSeconds};
 else if(String(url).endsWith('/auth/v1/verify'))data={access_token:token,refresh_token:'isolated-refresh',expires_in:3600};
 else if(String(url).endsWith('/auth/v1/user'))data={id:uid,email:'staff@example.test',factors:[]};
 else if(String(url).endsWith('/challenge'))data={id:'challenge'};
 else if(String(url).endsWith('/verify'))data={access_token:'test.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,aal:'aal2',sub:uid})).toString('base64url')+'.test',refresh_token:'isolated-mfa-refresh',expires_in:3600};
 else if(String(url).endsWith('bh_bootstrap'))data={safe:true,role:teamLogin?'team':'admin',team:teamLogin?{id:uid}:null};
 else if(String(url).endsWith('bh_heartbeat'))data={allowed:deviceAllowed,message:'All four team devices are active.'};
 else if(String(url).includes('/rest/v1/rpc/'))data={safe:true};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
const origin='https://event.example.test';
const request=(path,body={},extra={})=>new Request(origin+'/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-BugHunt-Request':'1','x-forwarded-for':'192.0.2.1',...extra},body:JSON.stringify(body)});
try {
 await check('Foreign-origin and form-shaped cookie requests are rejected before upstream access',async()=>{const n=calls.length;assert.equal((await handleWebApi(request('auth/login',{email:'a@example.test',password:'123456'},{Origin:'https://foreign.test'}),'auth/login')).status,403);assert.equal((await handleWebApi(request('auth/login',{}, {'Content-Type':'text/plain'}),'auth/login')).status,415);assert.equal(calls.length,n);});
 await check('Origin checks use the routed Host rather than Next internal hostname',async()=>{const r=await handleWebApi(new Request('https://localhost/api/auth/session',{method:'POST',headers:{Host:'event.example.test',Origin:origin,'Content-Type':'application/json','X-BugHunt-Request':'1'},body:'{}'}),'auth/session');assert.equal(r.status,200);});
 await check('Oversized bodies and arbitrary proxy destinations are rejected',async()=>{assert.equal((await handleWebApi(request('auth/login',{payload:'x'.repeat(41000)}),'auth/login')).status,413);assert.equal((await handleWebApi(request('rpc/http://internal'),'rpc/http://internal')).status,404);});
 await check('Six-character password accepted; shorter password rejected',async()=>{assert.equal((await handleWebApi(request('auth/login',{email:'staff@example.test',password:'12345'}),'auth/login')).status,400);assert.equal((await handleWebApi(request('auth/login',{email:'staff@example.test',password:'123456'}),'auth/login')).status,200);});
 const login=await handleWebApi(request('auth/login',{email:'staff@example.test',password:'123456'}),'auth/login');
 const set=login.headers.get('set-cookie'),cookie=set.split(';')[0];
 await check('Login creates encrypted HttpOnly Secure SameSite cookie without exposing tokens',async()=>{assert.match(set,/__Host-bh-session=/);for(const attr of ['HttpOnly','Secure','SameSite=Lax','Path=/'])assert.ok(set.includes(attr));assert.ok(!set.includes(token)&&!set.includes('isolated-refresh'));const body=await login.text();assert.ok(!body.includes('access_token')&&!body.includes('refresh_token'));assert.match(login.headers.get('cache-control'),/no-store/);});
 await check('Team login reserves a device; fifth login is rejected without a cookie and its provider session is revoked',async()=>{teamLogin=true;deviceAllowed=true;assert.equal((await handleWebApi(request('auth/login',{email:'team@example.test',password:'123456'}),'auth/login')).status,200);deviceAllowed=false;const r=await handleWebApi(request('auth/login',{email:'team@example.test',password:'123456'}),'auth/login');assert.equal(r.status,409);assert.equal(r.headers.get('set-cookie'),null);assert.ok(calls.at(-1).url.includes('/auth/v1/logout'));teamLogin=false;deviceAllowed=true;});
 await check('Session survives reload without returning browser-readable credentials',async()=>{const r=await handleWebApi(request('auth/session',{}, {Cookie:cookie}),'auth/session');assert.equal(r.status,200);const data=await r.json();assert.equal(data.session.user.id,uid);assert.equal(data.session.access_token,undefined);});
 await check('Deleted-account sessions are cleared; provider outages and throttling preserve valid cookies',async()=>{
  for(const status of [401,403,404]){userStatus=status;const r=await handleWebApi(request('auth/session',{}, {Cookie:cookie}),'auth/session');assert.equal(r.status,200);assert.deepEqual(await r.json(),{session:null,recovery:false});assert.match(r.headers.get('set-cookie'),/Max-Age=0/);}
  for(const status of [429,503]){userStatus=status;const r=await handleWebApi(request('auth/session',{}, {Cookie:cookie}),'auth/session');assert.equal(r.status,status);assert.equal(r.headers.get('set-cookie'),null);}
  userStatus=200;
 });
 await check('Authenticator verification upgrades only the HttpOnly session',async()=>{const r=await handleWebApi(request('auth/mfa/verify',{factorId:uid,code:'123456'},{Cookie:cookie}),'auth/mfa/verify');assert.equal(r.status,200);assert.deepEqual(await r.json(),{verified:true});const elevated=r.headers.get('set-cookie').split(';')[0];const status=await handleWebApi(request('auth/mfa/status',{}, {Cookie:elevated}),'auth/mfa/status');assert.equal((await status.json()).verified,true);});
 await check('Disabled authenticator enrollment cannot create another legacy factor',async()=>{const before=calls.length;const r=await handleWebApi(request('auth/mfa/enroll',{}, {Cookie:cookie}),'auth/mfa/enroll');assert.equal(r.status,403);assert.ok(calls.slice(before).every(c=>!c.url.endsWith('/auth/v1/factors')));});
 await check('Only trusted Vercel client IP is forwarded to provider Auth',async()=>{assert.ok(calls.filter(c=>c.url.includes('/auth/v1/')).every(c=>c.headers['Sb-Forwarded-For']==='192.0.2.1'&&c.headers.apikey==='sb_secret_isolated_test_only'));});
 await check('Tampered cookie and unauthenticated protected RPC are denied',async()=>{assert.equal((await handleWebApi(request('rpc/bh_bootstrap',{}, {Cookie:'__Host-bh-session=forged'}),'rpc/bh_bootstrap')).status,401);assert.equal((await handleWebApi(request('rpc/bh_bootstrap'),'rpc/bh_bootstrap')).status,401);});
 await check('Protected RPC forwards only the server-held user token',async()=>{const r=await handleWebApi(request('rpc/bh_bootstrap',{}, {Cookie:cookie}),'rpc/bh_bootstrap');assert.equal(r.status,200);assert.equal((await r.json()).safe,true);});
 await check('Account and IP quotas run before failed login and return Retry-After',async()=>{allowed=false;const before=calls.length;const r=await handleWebApi(request('auth/login',{email:'staff@example.test',password:'123456'}),'auth/login');assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'600');assert.equal(calls.length,before+1);assert.ok(!calls.at(-1).body.includes('staff@example.test')&&!calls.at(-1).body.includes('192.0.2.1'));allowed=true;});
 await check('Limiter outage fails closed and does not disclose secrets',async()=>{failed=true;const r=await handleWebApi(request('auth/login',{email:'staff@example.test',password:'123456'}),'auth/login');assert.equal(r.status,503);assert.ok(!(await r.text()).includes(process.env.SUPABASE_SECRET_KEY));failed=false;});
 await check('Email-code request is browser-independent and sets no verifier or auth cookie',async()=>{const r=await handleWebApi(request('auth/recover',{email:'staff@example.test'}),'auth/recover');assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.deepEqual(JSON.parse(calls.at(-1).body),{email:'staff@example.test'});assert.deepEqual(await r.json(),{accepted:true});});
 await check('Signup and recovery never mask validation, configuration, SMTP, or rate errors as success',async()=>{
  for(const path of ['signup','recover'])for(const failure of [{status:422,body:{error_code:'email_address_invalid',msg:'Email address is invalid'}},{status:401,body:{error_code:'bad_jwt',msg:'Invalid API configuration'}},{status:500,body:{error_code:'unexpected_failure',msg:'Error sending confirmation email'}},{status:429,body:{error_code:'over_email_send_rate_limit',msg:'Email limit exceeded'}}]){
   providerFailure=failure;const r=await handleWebApi(request('auth/'+path,{email:'a@example.test',password:'123456'}),'auth/'+path);assert.equal(r.status,failure.status===500?503:failure.status);assert.equal(r.headers.get('set-cookie'),null);
  }
  providerFailure=null;
 });
 await check('Both provider duplicate-signup responses direct existing users to sign in without replacing an email verifier',async()=>{
  for(const response of [{status:422,body:{error_code:'user_already_exists',msg:'Already registered'}},{status:200,body:{id:'sanitized-id',identities:[]}}]){
   providerFailure=response;const r=await handleWebApi(request('auth/signup',{email:'a@example.test',password:'123456'}),'auth/signup');assert.equal(r.status,200);assert.deepEqual(await r.json(),{accepted:false,alreadyRegistered:true});assert.equal(r.headers.get('set-cookie'),null);
  }
  providerFailure=null;
 });
 await check('New and unconfirmed signup identities request confirmation without a browser cookie',async()=>{
  providerFailure={status:200,body:{id:'new-id',identities:[{provider:'email'}]}};
  const r=await handleWebApi(request('auth/signup',{email:'new@example.test',password:'123456'}),'auth/signup');assert.equal(r.status,200);assert.deepEqual(await r.json(),{accepted:true});assert.equal(r.headers.get('set-cookie'),null);providerFailure=null;
 });
 await check('Confirmation code can be verified in a fresh browser; session secrets stay server-side',async()=>{
  const r=await handleWebApi(request('auth/verify-email',{email:'new@example.test',code:'12345678',type:'signup'}),'auth/verify-email');assert.equal(r.status,200);assert.deepEqual(await r.json(),{verified:true,recovery:false});assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.ok(!r.headers.get('set-cookie').includes(token));
  assert.deepEqual(JSON.parse(calls.findLast(c=>c.url.endsWith('/auth/v1/verify')).body),{email:'new@example.test',token:'12345678',type:'signup'});
 });
 await check('Malformed, wrong-type and expired/reused email codes cannot create sessions',async()=>{
  for(const body of [{code:'123456',type:'signup'},{code:'12345678',type:'magiclink'}]){const n=calls.length;assert.equal((await handleWebApi(request('auth/verify-email',{email:'new@example.test',...body}),'auth/verify-email')).status,400);assert.equal(calls.length,n);}
  verificationFailure=true;const r=await handleWebApi(request('auth/verify-email',{email:'new@example.test',code:'12345678',type:'signup'}),'auth/verify-email');assert.equal(r.status,400);assert.match((await r.json()).message,/incorrect, expired, or already used/);assert.equal(r.headers.get('set-cookie'),null);verificationFailure=false;
 });
 await check('Resending signup code does not require or change the password',async()=>{
  const r=await handleWebApi(request('auth/resend',{email:'new@example.test'}),'auth/resend');assert.equal(r.status,200);assert.ok(calls.at(-1).url.endsWith('/auth/v1/resend'));assert.deepEqual(JSON.parse(calls.at(-1).body),{email:'new@example.test',type:'signup'});assert.equal(r.headers.get('set-cookie'),null);
 });
 await check('Code verification cannot bypass the four-device limit',async()=>{
  teamLogin=true;deviceAllowed=false;const r=await handleWebApi(request('auth/verify-email',{email:'team@example.test',code:'12345678',type:'signup'}),'auth/verify-email');assert.equal(r.status,409);assert.equal(r.headers.get('set-cookie'),null);assert.ok(calls.at(-1).url.includes('/auth/v1/logout'));teamLogin=false;deviceAllowed=true;
 });
 await check('Recovery code permits only password reset, then clears session for normal sign-in',async()=>{
  const r=await handleWebApi(request('auth/verify-email',{email:'staff@example.test',code:'12345678',type:'recovery'}),'auth/verify-email');assert.equal(r.status,200);assert.equal((await r.json()).recovery,true);const stored=r.headers.get('set-cookie').split(';')[0];
  const state=await handleWebApi(request('auth/session',{}, {Cookie:stored}),'auth/session');assert.equal((await state.json()).recovery,true);
  assert.equal((await handleWebApi(request('rpc/bh_bootstrap',{}, {Cookie:stored}),'rpc/bh_bootstrap')).status,403);
  assert.equal((await handleWebApi(request('auth/mfa/status',{}, {Cookie:stored}),'auth/mfa/status')).status,403);
  const done=await handleWebApi(request('auth/password',{password:'new-password'}, {Cookie:stored}),'auth/password');assert.equal(done.status,200);assert.match(done.headers.get('set-cookie'),/Max-Age=0/);
 });
 await check('Provider email throttling retains Retry-After and actionable email guidance',async()=>{
  providerFailure={status:429,body:{error_code:'over_email_send_rate_limit'},headers:{'Retry-After':'127'}};
  const r=await handleWebApi(request('auth/signup',{email:'a@example.test',password:'123456'}),'auth/signup');assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'127');assert.match((await r.json()).message,/email service/);providerFailure=null;
 });
 await check('Refresh throttling and outages preserve the signed-in cookie; invalid refresh clears it',async()=>{
  sessionSeconds=1;const login=await handleWebApi(request('auth/login',{email:'staff@example.test',password:'123456'}),'auth/login');const stored=login.headers.get('set-cookie').split(';')[0];sessionSeconds=3600;
  for(const status of [429,503]){refreshStatus=status;const r=await handleWebApi(request('auth/session',{}, {Cookie:stored}),'auth/session');assert.equal(r.status,status);assert.equal(r.headers.get('set-cookie'),null);}
  refreshStatus=401;const r=await handleWebApi(request('auth/session',{}, {Cookie:stored}),'auth/session');assert.equal(r.status,200);assert.equal((await r.json()).session,null);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);refreshStatus=200;
 });
 await check('Old callback failure redirects to helpful app UI without raw JSON or leaking the code',async()=>{const r=await handleWebApi(new Request(origin+'/api/auth/callback?code=foreign-code'),'auth/callback');assert.equal(r.status,303);assert.equal(r.headers.get('location'),origin+'/?auth=link-error');assert.equal(await r.text(),'');});
 await check('Logout clears the cookie',async()=>{const r=await handleWebApi(request('auth/logout',{}, {Cookie:cookie}),'auth/logout');assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);});
} finally {globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
console.log(`${checks} security hardening checks passed.`);
