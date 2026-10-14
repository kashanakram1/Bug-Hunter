// UI integration with isolated provider responses; never sends real email.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const origin=process.env.BUGHUNT_TEST_URL||'http://127.0.0.1:5175';
const errors=[];
async function client(){
 const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.routeWebSocket(/.*supabase.*realtime.*/,ws=>ws.close());
 let session=null,recovery=false,used=new Set(),passwordUpdated=false,requests=[],sessionUnavailable=false,heldSession=null;
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;const body=route.request().postDataJSON();requests.push({path,body});let data={},status=200;
  if(path==='/api/auth/session'&&heldSession){const held=heldSession;heldSession=null;const snapshot={session,recovery};held.signal();await held.wait;await route.fulfill({contentType:'application/json',body:JSON.stringify(snapshot)});return;}
  if(path==='/api/auth/session'&&sessionUnavailable){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary provider outage'})});return;}
  if(path==='/api/auth/session')data={session,recovery};
  else if(path==='/api/auth/signup'||path==='/api/auth/resend'||path==='/api/auth/recover')data={accepted:true};
  else if(path==='/api/auth/verify-email'){
   if(body.code!=='12345678'||used.has(body.type)){status=400;data={message:'The code is incorrect, expired, or already used. Check the email address and use the latest code, or request another.'};}
   else{used.add(body.type);recovery=body.type==='recovery';session={user:{id:'email-test',email:body.email}};data={verified:true,recovery};}
  } else if(path==='/api/auth/password'){assert.equal(recovery,true);passwordUpdated=true;session=null;recovery=false;data={updated:true};}
  else if(path==='/api/auth/login'){assert.equal(passwordUpdated,true);assert.equal(body.password,'updated-password');session={user:{id:'email-test'}};data={session};}
  else if(path==='/api/rpc/bh_bootstrap')data={role:'team',team:null,event:{registration_open:true}};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 return {context,page,requests,removeSession:()=>{session=null;recovery=false;},setSessionUnavailable:value=>{sessionUnavailable=value;},holdNextSession:()=>{let signal,release;const ready=new Promise(r=>{signal=r;}),wait=new Promise(r=>{release=r;});heldSession={signal,wait};return {ready,release};}};
}
try{
 const a=await client();await a.page.goto(origin);
 await a.page.getByRole('button',{name:'New team? Create an account',exact:true}).click();
 await a.page.getByLabel('Email',{exact:true}).fill('new@example.test');await a.page.getByLabel('Password',{exact:true}).fill('123456');await a.page.getByRole('button',{name:'Create account',exact:true}).click();
 await a.page.getByRole('heading',{name:'Confirm your email',exact:true}).waitFor();
 assert.equal(await a.page.getByRole('button',{name:/Resend code in/}).isDisabled(),true);
 assert.equal(await a.page.getByRole('button',{name:'Verify code',exact:true}).isEnabled(),true);
 await a.page.getByLabel('Email code',{exact:true}).fill('00000000');await a.page.getByRole('button',{name:'Verify code',exact:true}).click();await a.page.getByText(/The code is incorrect, expired, or already used/).waitFor();
 // A separate browser has no request cookies but can complete verification.
 const b=await client();await b.page.goto(origin+'/?auth=confirm');await b.page.getByRole('heading',{name:'Confirm your email',exact:true}).waitFor();
 await b.page.getByLabel('Email',{exact:true}).fill('new@example.test');await b.page.getByLabel('Email code',{exact:true}).fill('12345678');await b.page.getByRole('button',{name:'Verify code',exact:true}).click();await b.page.getByRole('heading',{name:'Build your crew.',exact:true}).waitFor();
 assert.equal(b.requests.some(r=>r.path==='/api/auth/signup'),false);
 b.removeSession();await b.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await b.page.getByRole('heading',{name:'Enter the arena',exact:true}).waitFor();
 const c=await client();await c.page.goto(origin);await c.page.getByRole('button',{name:'Forgot password?',exact:true}).click();
 await c.page.getByLabel('Email code',{exact:true}).waitFor();assert.equal(c.requests.some(r=>r.path==='/api/auth/recover'),false);
 await c.page.getByLabel('Email',{exact:true}).fill('recover@example.test');await c.page.getByRole('button',{name:'Send reset code',exact:true}).click();await c.page.getByText(/Request accepted. Check your inbox and spam for the latest eight-digit code/).waitFor();
 assert.equal(await c.page.getByRole('button',{name:'Verify code',exact:true}).isEnabled(),true);
 await c.page.getByLabel('Email code',{exact:true}).fill('12345678');await c.page.getByRole('button',{name:'Verify code',exact:true}).click();await c.page.getByRole('heading',{name:'Choose a new password',exact:true}).waitFor();
 assert.equal(c.requests.some(r=>r.path==='/api/rpc/bh_bootstrap'),false);
 await c.page.getByLabel('Password',{exact:true}).fill('updated-password');await c.page.getByRole('button',{name:'Update password',exact:true}).click();await c.page.getByRole('heading',{name:'Enter the arena',exact:true}).waitFor();
 await c.page.getByLabel('Email',{exact:true}).fill('recover@example.test');await c.page.getByLabel('Password',{exact:true}).fill('updated-password');await c.page.getByRole('button',{name:'Sign in',exact:true}).click();await c.page.getByRole('heading',{name:'Build your crew.',exact:true}).waitFor();
 c.setSessionUnavailable(true);const failedPoll=c.page.waitForResponse(r=>r.url().endsWith('/api/auth/session')&&r.status()===503);await c.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await failedPoll;assert.equal(await c.page.getByRole('heading',{name:'Build your crew.',exact:true}).isVisible(),true);
 c.setSessionUnavailable(false);const held=c.holdNextSession();await c.page.evaluate(()=>window.dispatchEvent(new Event('bughunt-auth-change')));await held.ready;c.removeSession();await c.page.evaluate(()=>window.dispatchEvent(new Event('bughunt-auth-change')));held.release();await c.page.getByRole('heading',{name:'Enter the arena',exact:true}).waitFor();
 const d=await client();await d.page.goto(origin+'/?auth=link-error');await d.page.getByText(/This older email link could not be completed/).waitFor();await d.page.getByLabel('Email code',{exact:true}).waitFor();
 await d.page.goto(origin+'/?auth=recovery');await d.page.getByLabel('Email code',{exact:true}).waitFor();assert.equal(d.requests.some(r=>r.path==='/api/auth/recover'),false);
 await d.page.goto(origin);await d.page.getByRole('button',{name:'Enter confirmation code',exact:true}).click();await d.page.getByRole('heading',{name:'Confirm your email',exact:true}).waitFor();await d.page.getByLabel('Email code',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS cross-browser confirmation, recovery/reset/sign-in, old-link help, foreground session revocation, outage resilience, concurrent auth changes, no page exceptions.');
}finally{await browser.close();}
