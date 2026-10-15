// Production-build browser checks with isolated API responses; no live mutations.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.routeWebSocket(/.*supabase.*realtime.*/, (ws) => ws.close());
  const entered=new Set(), submissions=[];
  const online={enabled:false,testing:true,phase:'testing',ends_at:null,starts_at:null,entry_closes_at:null};
  const rounds=['Bug Blitz','Code Breaker','System Under Attack','Final Debugging Arena'].map((name,i)=>({id:i+1,name,status:'open',duration_seconds:1200,max_points:100,paused_at:null}));
  await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON()||{};
    let data={};
    if(path==='/api/auth/session') data={session:{user:{id:'test-team',email:'team@example.test'}},recovery:false};
    else if(path==='/api/rpc/bh_bootstrap') data={role:'team',team:{name:'Testing Team',status:'approved'},rounds,online,event:{self_progression:true},server_time:new Date().toISOString()};
    else if(path==='/api/rpc/bh_heartbeat') data={allowed:true};
    else if(path==='/api/rpc/bh_start_round') {entered.add(body.p_round);data={round_id:body.p_round,ends_at:null};}
    else if(path==='/api/rpc/bh_submit') {submissions.push(body);data={message:'Submission recorded'};}
    else if(path==='/api/rpc/bh_save_draft') data=1;
    else if(path==='/api/rpc/bh_team_state') {
      const r=body.p_round;
      data={round:rounds[r-1],server_time:new Date().toISOString(),online,testing:true,self_progression:false,online_entered:false,
        session:entered.has(r)?{started_at:new Date().toISOString(),ends_at:null,completed_at:null}:null,
        questions:entered.has(r)?[{id:'test-r'+r,title:'Test question '+r,language:'JavaScript',difficulty:'Basic',max_points:10,max_attempts:1,kind:'answer',prompt:'Review this snippet',fields:[{key:'a',label:'Answer'}]}]:[],
        qualifications:[],submissions:[],drafts:[],claims:[],announcements:[],clarifications:[],certificates:[]};
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(process.env.BUGHUNT_TEST_URL||'http://127.0.0.1:5182');
  await page.getByRole('heading',{name:'Ready for the hunt?'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Open test',exact:true}).count(),4);
  for(const r of [4,1,3,2]) {
    const entry=page.locator('article.round-card').nth(r-1).getByRole('button');
    assert.equal(await entry.isEnabled(),true); await entry.click();
    await page.getByRole('heading',{name:'Test question '+r,exact:true}).waitFor();
    assert.match(await page.locator('.round-clock-bar').innerText(),/Unlimited/);
    assert.equal(await page.getByRole('button',{name:'Submit answer',exact:true}).isDisabled(),true);
    await page.getByLabel('Answer',{exact:true}).fill('Test answer');
    assert.equal(await page.getByRole('button',{name:'Submit answer',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'Submit answer',exact:true}).click();
    await page.waitForTimeout(200);
    assert.equal(submissions.at(-1).p_question,'test-r'+r);
    await page.getByRole('button',{name:'Back to tests',exact:true}).click();
    await page.getByRole('heading',{name:'Ready for the hunt?'}).waitFor();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('article.round-card').nth(3).getByRole('button').click();
  await page.getByRole('heading',{name:'Test question 4',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS All four tests accessible, untimed submissions, return/revisit, mobile layout');
} finally { await browser.close(); }
