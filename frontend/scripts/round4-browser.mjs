// Only local assets and isolated API fixtures. No live team operations.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const origin=process.env.BUGHUNT_TEST_URL||'http://127.0.0.1:5188';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Local preview required');
const browser=await chromium.launch({channel:'chrome',headless:true});
let opens=Date.now()+5000,started=null,ends=null,completed=null,entries=0,finishCalls=0;
const errors=[],contexts=[],drafts=new Map(),claims=[];
const rounds=['Bug Blitz','Code Breaker','System Under Attack','Final Debugging Arena'].map((name,i)=>({id:i+1,name,status:i===3&&Date.now()>=opens?'open':'closed',duration_seconds:[1200,1800,1800,2400][i],max_points:[100,200,300,500][i]}));
const info=()=>({opens_at:new Date(opens).toISOString(),duration_seconds:2400,started_at:started,ends_at:ends,completed_at:completed,phase:completed?'completed':started?'active':Date.now()<opens?'scheduled':'ready'});
const questions=[{id:'R4-ARENA',title:'Final arena',language:'JavaScript',difficulty:'Final',max_points:450,max_attempts:1,kind:'arena',prompt:'Find bugs.',fields:[]},{id:'R4-REPORT',title:'Incident report',language:'Report',difficulty:'Final',max_points:50,max_attempts:1,kind:'report',prompt:'Write a report.',fields:[{key:'report',label:'Incident report',multiline:true}]}];
async function client(){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();contexts.push(context);
 page.on('pageerror',e=>errors.push(e.message));await context.routeWebSocket(/.*/,ws=>ws.close());
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON()||{};let data={};
  if(path==='/api/auth/session')data={session:{user:{id:'team-owner',email:'team@example.test'}},recovery:false};
  else if(path==='/api/rpc/bh_bootstrap')data={role:'team',team:{id:'team',name:'Test team',status:'approved'},event:{self_progression:true},rounds,online:{enabled:true,phase:'closed',starts_at:'2026-10-18T11:00:00Z',entry_closes_at:'2026-10-18T11:30:00Z',ends_at:'2026-10-18T12:50:00Z',timezone:'Asia/Karachi'},server_time:new Date().toISOString()};
  else if(path==='/api/rpc/bh_heartbeat')data={allowed:true};
  else if(path==='/api/rpc/bh_start_round'){
   assert.equal(body.p_round,4);assert(Date.now()>=opens);entries++;
   if(!started){started=new Date().toISOString();ends=new Date(Date.parse(started)+2400000).toISOString();}
   data={round_id:4,started_at:started,ends_at:ends,completed_at:completed};
  }else if(path==='/api/rpc/bh_team_state'){
   if(ends&&Date.now()>=Date.parse(ends))completed=ends;
   const visible=body.p_round===4&&started;
   data={round4:info(),server_time:new Date().toISOString(),round:{...rounds[body.p_round-1],status:body.p_round===4&&Date.now()>=opens?'open':'closed'},session:visible?{started_at:started,ends_at:ends,completed_at:completed}:null,self_progression:false,online_entered:false,active_round:started&&!completed?4:null,questions:visible?questions:[],drafts:visible?[...drafts.values()]:[],submissions:[],claims:visible?claims:[],qualifications:[],announcements:[],clarifications:[],certificates:[]};
  }else if(path==='/api/rpc/bh_save_draft'){
   assert(!completed);const rev=(drafts.get(body.p_question)?.revision||0)+1;drafts.set(body.p_question,{question_id:body.p_question,answer:body.p_answer,revision:rev});data=rev;
  }else if(path==='/api/rpc/bh_claim'){
   assert(!completed);claims.push({id:'claim',location:body.p_location,cause:body.p_cause,state:'pending'});data='claim';
  }else if(path==='/api/rpc/bh_finish_round'){assert.equal(body.p_round,4);finishCalls++;completed=new Date().toISOString();data=null;}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin);try{await page.getByRole('heading',{name:'Ready for the hunt?'}).waitFor({timeout:10000});}catch(e){console.error(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,1200)}));throw e;}return page;
}
try{
 const pages=await Promise.all(Array.from({length:4},client));
 for(const p of pages){assert.equal(await p.locator('article.round-card').count(),1);assert.equal(await p.getByRole('button',{name:'Opens at 9:30 AM PKT',exact:true}).isDisabled(),true);}
 assert.equal(entries,0);assert.equal(started,null);
 for(const p of pages)await p.getByRole('button',{name:'Enter Round 4',exact:true}).waitFor();
 await Promise.all(pages.map(p=>p.getByRole('button',{name:'Enter Round 4',exact:true}).click()));
 for(const p of pages)await p.getByRole('heading',{name:'Final arena',exact:true}).waitFor();
 assert.equal(entries,4);assert.equal(Date.parse(ends)-Date.parse(started),2400000);const deadline=ends;
 const clocks=await Promise.all(pages.map(async p=>{const [m,s]=(await p.locator('.round-clock-bar .timer strong').innerText()).split(':').map(Number);return m*60+s;}));
 assert(Math.max(...clocks)-Math.min(...clocks)<=1);
 await pages[0].getByLabel('File and function',{exact:true}).fill('src/app.js');
 await pages[0].getByLabel('What is wrong?',{exact:true}).fill('Missing check');
 await pages[0].getByLabel('Why does it matter?',{exact:true}).fill('Bad input');
 await pages[0].getByLabel('Your fix',{exact:true}).fill('Validate the input');
 await pages[0].getByRole('button',{name:'Submit bug claim',exact:true}).click();assert.equal(claims.length,1);
 await pages[1].locator('.question-nav button').nth(1).click();await pages[1].getByLabel('Incident report',{exact:true}).fill('A saved incident report.');
 await pages[1].getByText('Draft saved',{exact:false}).waitFor();assert(drafts.has('R4-REPORT'));
 await Promise.all(pages.map(async p=>{await p.reload();await p.getByRole('heading',{name:'Final arena',exact:true}).waitFor();await p.evaluate(()=>window.dispatchEvent(new Event('online')));}));
 assert.equal(ends,deadline);assert.equal(entries,4);
 await pages[0].setViewportSize({width:390,height:844});assert(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 started=new Date(Date.now()-2400001).toISOString();ends=new Date(Date.parse(started)+2400000).toISOString();
 await Promise.all(pages.map(p=>p.evaluate(()=>window.dispatchEvent(new Event('online')))));
 for(const p of pages){await p.getByText('Round 4 is finished and locked.',{exact:false}).waitFor();assert.equal(await p.getByRole('button',{name:'Submit bug claim',exact:true}).isDisabled(),true);}
 assert.deepEqual(errors,[]);
 const report={passed:true,devices:4,automatic_opening_refresh:true,no_timer_before_entry:true,shared_seconds:2400,reload_and_reconnect_preserved_deadline:true,separate_claim_and_report_work:true,expired_devices_locked:true,mobile_overflow:false,page_errors:0,backend:'isolated fixtures; offline expiry separately tested in PostgreSQL'};
 writeFileSync(new URL('../../private/round4-browser-result.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
