import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const ctx=await browser.newContext();const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await ctx.routeWebSocket(/.*supabase.*realtime.*/,ws=>ws.close());
 let signedIn=false,verified=false,duplicateSignup=true,signupLimited=false,signupCalls=0;
 const payload='<img src=x onerror="window.__securityXss=1">';
 await ctx.addInitScript(()=>{localStorage.setItem('sb-obsolete-auth-token','isolated-old-token');window.__securityXss=0;});
 await ctx.route('**/api/**',async r=>{
  const p=new URL(r.request().url()).pathname;let data={};
  if(p==='/api/auth/session')data={session:signedIn?{user:{id:'isolated-staff',email:'staff@example.test'}}:null,recovery:false};
  else if(p==='/api/auth/login'){signedIn=true;data={session:{user:{id:'isolated-staff'}}};}
  else if(p==='/api/auth/signup'){
   signupCalls++;
   if(signupLimited){await r.fulfill({status:429,headers:{'Retry-After':'120'},contentType:'application/json',body:JSON.stringify({message:'Check your inbox and spam for the confirmation link.'})});return;}
   data=duplicateSignup?{accepted:false,alreadyRegistered:true}:{accepted:true};
  }
  else if(p==='/api/rpc/bh_bootstrap')data={role:'admin',team:null};
  else if(p==='/api/auth/mfa/status')data={verified,factors:[{id:'00000000-0000-4000-8000-000000000001'}]};
  else if(p==='/api/auth/mfa/verify'){verified=true;data={verified:true};}
  else if(p==='/api/rpc/bh_staff_data')data={rounds:[],event:{},stats:{registered:0,approved:0,active:0,pending:0}};
  else if(p==='/api/rpc/bh_public_state')data={server_time:new Date().toISOString(),event:{name:'Test',leaderboard_visible:true,results_released:false},rounds:[],announcements:[{id:'isolated',message:payload,created_at:new Date().toISOString()}],leaderboard:[{name:'<svg/onload=alert(1)>',rank:1,total_score:0,solved:0}],first_blood:[]};
  await r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const response=await page.goto(process.env.BUGHUNT_TEST_URL || 'http://127.0.0.1:5173');
 const headers=await response.allHeaders();const csp=headers['content-security-policy'];
 assert.ok(csp.includes("'strict-dynamic'")&&!csp.includes("script-src 'self' 'unsafe-inline'"));
 for(const h of ['strict-transport-security','x-content-type-options','referrer-policy','permissions-policy','x-frame-options'])assert.ok(headers[h]);
 const nonces=await page.locator('script').evaluateAll(nodes=>nodes.map(n=>n.nonce));assert.ok(nonces.length&&nonces.every(Boolean));
 await page.getByRole('heading',{name:'Enter the arena'}).waitFor();
 assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('minlength'),'6');
 assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/^sb-.*-auth-token/.test(k))),[]);
 await page.getByRole('button',{name:'New team? Create an account',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill('existing@example.test');await page.getByLabel('Password',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 await page.getByText('This email is already registered. Sign in, or use Forgot password to recover your account.',{exact:true}).waitFor();
 duplicateSignup=false;await page.getByRole('button',{name:'Create account',exact:true}).click();
 await page.getByText('Check your inbox for a confirmation link and open it in this browser, then sign in to register your team.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Try again in/}).isDisabled(),true);
 const sent=signupCalls;await page.locator('form').evaluate(form=>form.requestSubmit());await page.waitForTimeout(150);assert.equal(signupCalls,sent);
 signupLimited=true;await page.getByLabel('Email',{exact:true}).fill('limited@example.test');await page.getByRole('button',{name:'Create account',exact:true}).click();
 await page.getByText('Check your inbox and spam for the confirmation link.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Try again in [12]:/}).isDisabled(),true);
 await page.getByRole('button',{name:'Already registered? Sign in',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Mission Control',exact:true}).click();await page.getByText(payload,{exact:true}).waitFor();await page.getByText('<svg/onload=alert(1)>',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__securityXss),0);assert.equal(await page.locator('.announcement img,.table-wrap svg[onload]').count(),0);
 await page.getByRole('button',{name:'Back to arena',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill('staff@example.test');await page.getByLabel('Password',{exact:true}).fill('123456');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('heading',{name:'Competition control.'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Verify your authenticator'}).count(),0);
 await page.getByRole('button',{name:'Pause all',exact:true}).click();
 assert.equal(await page.getByLabel('Reason',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Confirm action',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Confirm action',exact:true}).click();
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/^sb-.*-auth-token/.test(k))),false);assert.deepEqual(errors,[]);
 console.log('PASS signup success/duplicate/throttle feedback, repeat-click protection, independent sign-in, realtime-disconnected rendering, nonce CSP/security headers, six-character sign-in, XSS escaping, and staff access.');
}finally{await browser.close();}
