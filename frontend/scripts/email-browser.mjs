// UI integration with isolated provider responses; never sends real email.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const origin=process.env.BUGHUNT_TEST_URL||'http://127.0.0.1:5175';
const errors=[];
async function client(){
 const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.routeWebSocket(/.*supabase.*realtime.*/,ws=>ws.close());
 let session=null,recovery=false,used=new Set(),passwordUpdated=false,requests=[];
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;const body=route.request().postDataJSON();requests.push({path,body});let data={},status=200;
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
 return {context,page,requests};
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
 const c=await client();await c.page.goto(origin);await c.page.getByRole('button',{name:'Forgot password?',exact:true}).click();await c.page.getByLabel('Email',{exact:true}).fill('recover@example.test');await c.page.getByRole('button',{name:'Send reset code',exact:true}).click();await c.page.getByRole('heading',{name:'Enter your reset code',exact:true}).waitFor();
 await c.page.getByLabel('Email code',{exact:true}).fill('12345678');await c.page.getByRole('button',{name:'Verify code',exact:true}).click();await c.page.getByRole('heading',{name:'Choose a new password',exact:true}).waitFor();
 assert.equal(c.requests.some(r=>r.path==='/api/rpc/bh_bootstrap'),false);
 await c.page.getByLabel('Password',{exact:true}).fill('updated-password');await c.page.getByRole('button',{name:'Update password',exact:true}).click();await c.page.getByRole('heading',{name:'Enter the arena',exact:true}).waitFor();
 await c.page.getByLabel('Email',{exact:true}).fill('recover@example.test');await c.page.getByLabel('Password',{exact:true}).fill('updated-password');await c.page.getByRole('button',{name:'Sign in',exact:true}).click();await c.page.getByRole('heading',{name:'Build your crew.',exact:true}).waitFor();
 const d=await client();await d.page.goto(origin+'/?auth=link-error');await d.page.getByText(/This older email link could not be completed/).waitFor();assert.equal(await d.page.getByRole('button',{name:'I already have a code',exact:true}).count(),1);
 await d.page.getByRole('button',{name:'I already have a code',exact:true}).click();await d.page.getByRole('heading',{name:'Enter your reset code',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS cross-browser confirmation, wrong-code feedback, independent resend/verify, recovery-only UI, password update and normal sign-in, old-link help, no page exceptions.');
}finally{await browser.close();}
