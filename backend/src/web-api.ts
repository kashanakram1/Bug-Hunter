// Server runtime only. Never import this module from a client component.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

type Session = { access_token: string; refresh_token: string; expires_at: number; recovery?: boolean };
type Settings = { url: string; key: string; secret: string; origin: string; ip: string };
class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number, public providerCode?: string) { super(message); }
}
const publicRpc = new Set(['bh_public_state', 'bh_verify_certificate']);
const rpcNames = new Set(['bh_bootstrap','bh_register','bh_heartbeat','bh_release_session','bh_start_round','bh_team_state','bh_save_draft','bh_submit','bh_finish_round','bh_claim','bh_activity','bh_ask','bh_staff_data','bh_grade','bh_review_claim','bh_admin','bh_my_results', ...publicRpc]);
const timeout = () => AbortSignal.timeout(12000);
function settings(request: Request): Settings {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !secret || secret.startsWith('<')) throw new ApiError(503, 'The server connection is not configured. Contact the organizer.');
  // Next's internal request URL can use localhost even when the browser uses 127.0.0.1.
  // Host is the incoming routed host; never derive the expected origin from the Origin header.
  const incoming = new URL(request.url);
  const origin = new URL(`${process.env.VERCEL==='1'?'https:':incoming.protocol}//${request.headers.get('host') || incoming.host}`).origin;
  if (process.env.VERCEL === '1' && !origin.startsWith('https://')) throw new ApiError(400, 'HTTPS is required.');
  const forwarded=process.env.VERCEL==='1'?(request.headers.get('x-forwarded-for')||'').split(',')[0].trim():'';
  return { url: url.replace(/\/$/, ''), key, secret, origin, ip: isIP(forwarded) ? forwarded : '' };
}
function encryptionKey(s: Settings) { return createHash('sha256').update('bughunt-http-session-v1:' + s.secret).digest(); }
function seal(value: unknown, s: Settings): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(s), nonce);
  cipher.setAAD(Buffer.from(s.origin));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url');
}
function unseal<T>(value: string, s: Settings): T | null {
  try {
    if (value.length > 12000) return null;
    const buf = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(s), buf.subarray(0,12));
    cipher.setAAD(Buffer.from(s.origin)); cipher.setAuthTag(buf.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(buf.subarray(28)), cipher.final()]).toString());
  } catch { return null; }
}
function cookieName(s: Settings, kind = 'session') { return (s.origin.startsWith('https:') ? '__Host-' : '') + 'bh-' + kind; }
function readCookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1) || '';
}
function cookie(headers: Headers, s: Settings, kind: string, value: unknown | null, age: number) {
  const encoded = value ? seal(value, s) : '';
  if (encoded.length > 3800) throw new ApiError(500, 'Session could not be saved. Contact the organizer.');
  headers.append('Set-Cookie', `${cookieName(s,kind)}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? age : 0}${s.origin.startsWith('https:') ? '; Secure' : ''}`);
}
async function upstream(s: Settings, path: string, method: string, body?: unknown, access?: string, service = false) {
  const authPath=path.startsWith('/auth/v1/');
  const r = await fetch(s.url + path, { method, headers: { apikey: service || authPath ? s.secret : s.key, Authorization: 'Bearer ' + (access || (service || authPath ? s.secret : s.key)), 'Content-Type': 'application/json', ...(authPath&&s.ip?{'Sb-Forwarded-For':s.ip}:{}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: timeout(), cache: 'no-store' });
  const data = await r.json().catch(()=>null);
  if (!r.ok) {
    const limited = r.status === 429 || data?.code === 'P0001' && data?.message?.startsWith('Rate limit');
    if (limited) throw new ApiError(429, 'Too many requests. Please wait and try again.', 60);
    const message = data?.message || data?.msg || data?.error_description;
    // Auth diagnostics are normalized below; database messages are part of the event UX.
    throw new ApiError(r.status >= 500 ? 503 : r.status, typeof message === 'string' ? message.slice(0,400) : 'Request could not be completed.',undefined,data?.error_code || data?.code);
  }
  return data;
}
async function budget(s: Settings, request: Request, kind: string, account = '') {
  // Vercel overwrites X-Forwarded-For. Outside Vercel, never trust a caller-supplied IP header.
  const ip = s.ip || 'local';
  const hash = (v: string) => createHmac('sha256', s.secret).update(v).digest('hex');
  const result = await upstream(s, '/rest/v1/rpc/bh_gateway_budget', 'POST', { p_kind: kind, p_ip: hash('ip:'+ip), p_account: account ? hash('account:'+account.trim().toLowerCase()) : null }, undefined, true);
  if (!result.allowed) throw new ApiError(429, 'Too many requests. Please wait and try again.', result.retry_after);
}
function normalizeSession(data: any, recovery = false): Session {
  if (!data?.access_token || !data?.refresh_token) throw new ApiError(401, 'Please sign in again.');
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at || Math.floor(Date.now()/1000) + data.expires_in, recovery };
}
async function session(request: Request, s: Settings, headers: Headers) {
  let value = unseal<Session>(readCookie(request,cookieName(s)),s);
  if (!value?.access_token || !value.refresh_token || !Number.isFinite(value.expires_at)) return null;
  if (value.expires_at < Date.now()/1000+60) {
    try { value = normalizeSession(await upstream(s,'/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:value.refresh_token}),value.recovery); cookie(headers,s,'session',value,86400); }
    catch (e) { if (e instanceof ApiError && e.status < 500) { cookie(headers,s,'session',null,0); return null; } throw e; }
  }
  return value;
}
async function user(s: Settings, value: Session) {
  const u = await upstream(s,'/auth/v1/user','GET',undefined,value.access_token);
  return { id: u.id, email: u.email };
}
function csrf(request: Request, s: Settings) {
  const origin = request.headers.get('origin');
  if (origin !== s.origin || request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('x-bughunt-request') !== '1') throw new ApiError(403,'This request must originate from the competition website.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415,'JSON is required.');
}
async function input(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 40000) throw new ApiError(413,'Request is too large.');
  const reader = request.body?.getReader(); let size = 0; const parts: Uint8Array[] = [];
  if (!reader) return {};
  while (true) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength; if(size>40000){await reader.cancel();throw new ApiError(413,'Request is too large.');} parts.push(value); }
  try { const v=JSON.parse(Buffer.concat(parts).toString()); if(!v || Array.isArray(v) || typeof v !== 'object') throw Error(); return v; }
  catch { throw new ApiError(400,'Invalid request.'); }
}
function validatePassword(value: unknown): string { if (typeof value !== 'string' || value.length < 6 || Buffer.byteLength(value) > 72) throw new ApiError(400,'Use a password of at least 6 characters and no more than 72 UTF-8 bytes.'); return value; }
function email(value: unknown): string { if(typeof value!=='string'||value.length>254||!/^\S+@\S+\.\S+$/.test(value))throw new ApiError(400,'Enter a valid email address.');return value.trim().toLowerCase(); }

export async function handleWebApi(request: Request, path: string): Promise<Response> {
  const headers = new Headers({ 'Content-Type':'application/json', 'Cache-Control':'no-store, private', 'Vary':'Cookie, Origin', 'X-Content-Type-Options':'nosniff' });
  let s: Settings | undefined;
  try {
    s=settings(request);
    if (request.method === 'GET' && path === 'auth/callback') {
      const flow=unseal<{verifier:string;recovery:boolean;expires:number}>(readCookie(request,cookieName(s,'flow')),s);
      const code=new URL(request.url).searchParams.get('code');
      if(!flow||flow.expires<Date.now()||!code||code.length>2000)throw new ApiError(400,'This email link is expired or belongs to a different browser. Request a new link in this browser.');
      await budget(s,request,'callback');
      const value=normalizeSession(await upstream(s,'/auth/v1/token?grant_type=pkce','POST',{auth_code:code,code_verifier:flow.verifier}),flow.recovery);
      cookie(headers,s,'session',value,86400);cookie(headers,s,'flow',null,0);
      headers.set('Location',s.origin+'/'); return new Response(null,{status:303,headers});
    }
    if(request.method!=='POST')throw new ApiError(405,'Method not allowed.');
    csrf(request,s);
    const body=await input(request);
    let result: unknown;
    if(path.startsWith('rpc/')) {
      const name=path.slice(4);if(!rpcNames.has(name))throw new ApiError(404,'Unknown operation.');
      await budget(s,request,'rpc');
      const value=publicRpc.has(name)?null:await session(request,s,headers);
      if(!publicRpc.has(name)&&!value)throw new ApiError(401,'Sign in required.');
      result=await upstream(s,'/rest/v1/rpc/'+name,'POST',body,value?.access_token,publicRpc.has(name));
    } else if(path.startsWith('auth/')) {
      const action=path.slice(5);
      const address=['login','signup','recover'].includes(action)?email(body.email):'';
      if(action==='mfa/verify') {
        const stored=unseal<Session>(readCookie(request,cookieName(s)),s);
        let subject='unauthenticated';
        try { subject=JSON.parse(Buffer.from(stored!.access_token.split('.')[1],'base64url').toString()).sub || subject; } catch {}
        await budget(s,request,'mfa',subject);
      } else await budget(s,request,['login','signup','recover'].includes(action)?action:'session',address);
      let value = ['login','signup','recover'].includes(action)?null:await session(request,s,headers);
      if(action==='login') {
        try { value=normalizeSession(await upstream(s,'/auth/v1/token?grant_type=password','POST',{email:address,password:validatePassword(body.password)})); }
        catch(e){if(e instanceof ApiError&&e.status===400)throw new ApiError(400,'Email or password is incorrect, or your email is not confirmed.');throw e;}
        try {
          const boot=await upstream(s,'/rest/v1/rpc/bh_bootstrap','POST',{},value.access_token);
          if(boot.role==='team'&&boot.team?.id){
            const lease=await upstream(s,'/rest/v1/rpc/bh_heartbeat','POST',{},value.access_token);
            if(!lease.allowed)throw new ApiError(409,lease.message||'All four team devices are active. Sign out on another device first.');
          }
        } catch(e) {
          // Do not issue a cookie or retain a new provider session after a rejected admission.
          try { await upstream(s,'/auth/v1/logout?scope=local','POST',{},value.access_token); } catch {}
          throw e;
        }
        cookie(headers,s,'session',value,86400);result={session:{user:await user(s,value)}};
      } else if(action==='signup'||action==='recover') {
        const verifier=randomBytes(32).toString('base64url');
        const challenge=createHash('sha256').update(verifier).digest('base64url');
        const payload:any={email:address,code_challenge:challenge,code_challenge_method:'s256'};
        if(action==='signup')payload.password=validatePassword(body.password);
        try { await upstream(s,`/auth/v1/${action==='signup'?'signup':'recover'}?redirect_to=${encodeURIComponent(s.origin+'/api/auth/callback')}`,'POST',payload); }
        catch(e){
          // Only normalize known account-existence responses. Invalid input, SMTP,
          // configuration errors and throttling must never look like a sent email.
          const hidden=e instanceof ApiError && e.status<500 && e.status!==429 && ((action==='signup'&&e.providerCode==='user_already_exists') || (action==='recover'&&e.providerCode==='user_not_found'));
          if(!hidden)throw e;
        }
        cookie(headers,s,'flow',{verifier,recovery:action==='recover',expires:Date.now()+3600000},3600);result={accepted:true};
      } else if(action==='session') {
        result={session:value?{user:await user(s,value)}:null,recovery:!!value?.recovery};
      } else if(action==='logout') {
        if(value){try{await upstream(s,'/rest/v1/rpc/bh_release_session','POST',{},value.access_token);}catch{} try{await upstream(s,'/auth/v1/logout?scope=local','POST',{},value.access_token);}catch(e){if(!(e instanceof ApiError)||e.status>=500)throw e;}}
        cookie(headers,s,'session',null,0);result={signedOut:true};
      } else if(action==='legacy-link') {
        // Older already-issued implicit-flow emails are supported once; never persist tokens in JS storage.
        if(typeof body.access_token!=='string'||typeof body.refresh_token!=='string'||body.access_token.length>5000||body.refresh_token.length>1000)throw new ApiError(400,'Invalid email link.');
        const u=await upstream(s,'/auth/v1/user','GET',undefined,body.access_token);
        if(!u.id)throw new ApiError(401,'Invalid email link.');
        const payload=JSON.parse(Buffer.from(body.access_token.split('.')[1],'base64url').toString());
        value={access_token:body.access_token,refresh_token:body.refresh_token,expires_at:payload.exp,recovery:body.type==='recovery'};
        cookie(headers,s,'session',value,86400);result={session:{user:{id:u.id,email:u.email}},recovery:value.recovery};
      } else {
        if(!value)throw new ApiError(401,'Sign in required.');
        if(action==='password') {
          await upstream(s,'/auth/v1/user','PUT',{password:validatePassword(body.password)},value.access_token);
          value.recovery=false;cookie(headers,s,'session',value,86400);result={updated:true};
        } else if(action==='mfa/status') {
          const u=await upstream(s,'/auth/v1/user','GET',undefined,value.access_token);
          const claims=JSON.parse(Buffer.from(value.access_token.split('.')[1],'base64url').toString());
          result={verified:claims.aal==='aal2',factors:(u.factors||[]).filter((f:any)=>f.status==='verified'&&f.factor_type==='totp').map((f:any)=>({id:f.id,friendly_name:f.friendly_name}))};
        } else if(action==='mfa/enroll') {
          const u=await upstream(s,'/auth/v1/user','GET',undefined,value.access_token);
          if((u.factors||[]).some((f:any)=>f.status==='verified'))throw new ApiError(400,'Use your existing authenticator.');
          // A interrupted enrollment can be restarted without accumulating unverified factors.
          for(const f of (u.factors||[]).filter((f:any)=>f.status==='unverified'))await upstream(s,'/auth/v1/factors/'+encodeURIComponent(f.id),'DELETE',undefined,value.access_token);
          const f=await upstream(s,'/auth/v1/factors','POST',{factor_type:'totp',friendly_name:'Bug Hunt staff'},value.access_token);
          result={id:f.id,uri:f.totp.uri,secret:f.totp.secret};
        } else if(action==='mfa/verify') {
          if(typeof body.factorId!=='string'||! /^[0-9a-f-]{36}$/i.test(body.factorId)||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))throw new ApiError(400,'Enter the six-digit authenticator code.');
          const f='/auth/v1/factors/'+body.factorId;
          const c=await upstream(s,f+'/challenge','POST',{},value.access_token);
          const verified=await upstream(s,f+'/verify','POST',{challenge_id:c.id,code:body.code},value.access_token);
          value=normalizeSession(verified);cookie(headers,s,'session',value,86400);result={verified:true};
        } else throw new ApiError(404,'Unknown operation.');
      }
    } else throw new ApiError(404,'Unknown operation.');
    return new Response(JSON.stringify(result??null),{status:200,headers});
  } catch(e) {
    const error=e instanceof ApiError?e:new ApiError(503,'Connection interrupted. Please try again.');
    if(error.retryAfter)headers.set('Retry-After',String(Math.max(1,error.retryAfter)));
    // Tokens, credentials, request bodies, and provider responses are never logged.
    return new Response(JSON.stringify({message:error.message}),{status:error.status,headers});
  }
}
