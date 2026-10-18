// Local production build, isolated API responses. Never sends production requests.
import {chromium} from '@playwright/test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
const origin=process.env.BUGHUNT_TEST_URL||'http://127.0.0.1:5187';if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Local preview URL required');
const browser=await chromium.launch({channel:'chrome',headless:true});
const rounds=['Bug Blitz','Code Breaker','System Under Attack','Final Debugging Arena'].map((name,i)=>({id:i+1,name,status:'closed',paused_at:null,duration_seconds:[1200,1800,1800,2400][i],max_points:[100,200,300,500][i]}));
let started=null,ends=null,completed=null,startCalls=0,finishCalls=0,submits=0,denied=0;const errors=[],contexts=[],drafts=new Map(),answers=[];
const phase=()=>completed?'completed':!started?'ready':Date.now()>=Date.parse(ends)?'expired':'active';
const info=()=>({round_id:2,started_at:started,ends_at:ends,completed_at:completed,phase:phase()});
const questions=Array.from({length:4},(_,i)=>({id:'exception-q'+i,title:'Exception question '+(i+1),language:'JavaScript',difficulty:'Basic',max_points:50,max_attempts:3,kind:'answer',prompt:'Provide your answer.',fields:[{key:'a',label:'Answer'}]}));
const online={enabled:true,phase:'closed',starts_at:'2026-10-18T11:00:00Z',entry_closes_at:'2026-10-18T11:30:00Z',ends_at:'2026-10-18T12:50:00Z',timezone:'Asia/Karachi',onsite_date:'2026-10-22'};
async function client(eligible=true){const context=await browser.newContext(),page=await context.newPage();contexts.push(context);page.on('pageerror',e=>errors.push(e.message));await context.routeWebSocket(/.*supabase.*realtime.*/,ws=>ws.close());
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON()||{};let data={},status=200;
  if(path==='/api/auth/session')data={session:{user:{id:eligible?'target':'other',email:eligible?'laibanavaid15@gmail.com':'other@example.test'}},recovery:false};
  else if(path==='/api/rpc/bh_bootstrap')data={role:'team',team:{id:eligible?'target':'other',name:eligible?'Byte runners':'Other Team',status:'approved'},event:{self_progression:true},rounds,online,server_time:new Date().toISOString()};
  else if(path==='/api/rpc/bh_heartbeat')data={allowed:true};
  else if(path==='/api/rpc/bh_start_round'){
   if(!eligible||body.p_round!==2||['completed','expired'].includes(phase())){status=400;data={message:'Round is locked'};denied++;}
   else{startCalls++;if(!started){started=new Date().toISOString();ends=new Date(Date.parse(started)+1800000).toISOString();}data={round_id:2,started_at:started,ends_at:ends};}
  }else if(path==='/api/rpc/bh_team_state'){
   const r=body.p_round;data={server_time:new Date().toISOString(),round:{...rounds[r-1],status:eligible&&r===2&&['ready','active'].includes(phase())?'open':'closed'},session:eligible&&r===2&&started?{started_at:started,ends_at:ends,completed_at:completed}:null,
    online,self_progression:!eligible,online_entered:!eligible,active_round:eligible&&phase()==='active'?2:null,
    questions:eligible&&r===2&&phase()==='active'?questions:[],submissions:eligible&&r===2?answers:[],drafts:eligible&&r===2?[...drafts.values()]:[],claims:[],qualifications:[],announcements:[],clarifications:[],certificates:[],...(eligible?{round2_exception:info()}:{} )};
  }else if(path==='/api/rpc/bh_save_draft'){
   if(!eligible||phase()!=='active'){status=400;data={message:'Your reopened Round 2 time has ended'};}
   else{const current=drafts.get(body.p_question);const revision=(current?.revision||0)+1;drafts.set(body.p_question,{question_id:body.p_question,answer:body.p_answer,revision});data=revision;}
  }else if(path==='/api/rpc/bh_submit'){
   if(!eligible||phase()!=='active'){status=400;data={message:'Your reopened Round 2 time has ended'};denied++;}
   else{submits++;answers.push({id:'s'+submits,question_id:body.p_question,answer:body.p_answer,attempt:1});data={message:'Submission recorded'};}
  }else if(path==='/api/rpc/bh_finish_round'){assert.equal(body.p_round,2);assert.equal(eligible,true);finishCalls++;completed=new Date().toISOString();data=null;}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });await page.goto(origin);await page.getByRole('heading',{name:'Ready for the hunt?'}).waitFor();return{context,page};}
try{
 const four=await Promise.all(Array.from({length:4},()=>client()));
 assert.equal(started,null);assert.equal(startCalls,0);
 for(const {page} of four){assert.equal(await page.getByRole('button',{name:'Enter Round 2',exact:true}).count(),1);assert.equal(await page.locator('article.round-card').count(),1);}
 const other=await client(false);assert.equal(await other.page.getByRole('button',{name:'Enter Round 2',exact:true}).count(),0);assert.equal(await other.page.getByRole('region',{name:'Reopened Round 2'}).count(),0);
 await Promise.all(four.map(({page})=>page.getByRole('button',{name:'Enter Round 2',exact:true}).click()));
 const deadline=ends;assert.equal(startCalls,4);assert.equal(Date.parse(ends)-Date.parse(started),1800000);
 for(const {page} of four)await page.getByRole('heading',{name:'Exception question 1',exact:true}).waitFor();
 const clockSeconds=async page=>{const text=await page.locator('.round-clock-bar .timer strong').innerText();const [m,s]=text.split(':').map(Number);return m*60+s;};
 const clocks=await Promise.all(four.map(({page})=>clockSeconds(page)));assert.ok(Math.max(...clocks)-Math.min(...clocks)<=1);assert.ok(clocks.every(n=>n<=1800&&n>1780));
 await Promise.all(four.map(async({page},i)=>{await page.locator('.question-nav button').nth(i).click();await page.getByRole('heading',{name:'Exception question '+(i+1),exact:true}).waitFor();await page.getByLabel('Answer',{exact:true}).fill('Answer from device '+(i+1));await page.getByRole('button',{name:'Submit answer',exact:true}).click();}));
 assert.equal(submits,4);assert.equal(new Set(answers.map(a=>a.question_id)).size,4);
 await Promise.all(four.map(async({page})=>{await page.reload();await page.getByRole('heading',{name:'Exception question 1',exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('online')));}));
 assert.equal(ends,deadline);assert.equal(startCalls,4);
 await four[0].page.setViewportSize({width:390,height:844});assert.equal(await four[0].page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Expiration is simulated in the server fixture, not in the client clock.
 started=new Date(Date.now()-1800001).toISOString();ends=new Date(Date.parse(started)+1800000).toISOString();
 await Promise.all(four.map(({page})=>page.evaluate(()=>window.dispatchEvent(new Event('online')))));
 for(const {page} of four){await page.getByText(/Your reopened Round 2 has ended/).waitFor();assert.equal(await page.getByRole('button',{name:'Submit answer',exact:true}).count(),0);}
 // Separate isolated finish scenario: no transition into Round 3.
 started=new Date().toISOString();ends=new Date(Date.parse(started)+1800000).toISOString();
 await four[0].page.evaluate(()=>window.dispatchEvent(new Event('online')));await four[0].page.getByRole('heading',{name:'Exception question 1',exact:true}).waitFor();
 assert.equal(await four[0].page.getByRole('button',{name:'Move to next round',exact:true}).count(),0);
 await four[0].page.getByRole('button',{name:'Finish round',exact:true}).click();await four[0].page.getByRole('button',{name:'Confirm submission',exact:true}).click();
 await four[0].page.getByRole('heading',{name:'Ready for the hunt?'}).waitFor();assert.equal(finishCalls,1);assert.equal(await four[0].page.getByRole('button',{name:'Round 2 ended',exact:true}).isDisabled(),true);assert.equal(await four[0].page.getByRole('button',{name:'Enter round',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 const report={passed:true,devices:4,shared_duration_seconds:1800,first_entry_only:true,refresh_and_reconnect_preserved_deadline:true,independent_question_submissions:4,other_team_not_offered_exception:true,expiry_locked_all_devices:true,finish_did_not_open_round3:true,mobile_overflow:false,page_errors:0};
 writeFileSync(new URL('../../private/round2-exception-browser-result.json',import.meta.url),JSON.stringify(report,null,2));console.log('PASS '+JSON.stringify(report));
}finally{await browser.close();}
