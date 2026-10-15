// Synthetic staff fixtures only: no official answer keys and no live grading writes.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const origin=process.env.BUGHUNT_TEST_URL||'http://127.0.0.1:5181';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],graded=[];
const base={team_name:'Review fixture',title:'Sample question',round_id:1,max_points:10,attempt:1,prompt:'Explain this sample.',code:'',suggested_score:0};
let items=[{...base,id:'review-a',question_id:'sample-a',fields:[{key:'a',label:'First result'},{key:'a2',label:'Second result'},{key:'b',label:'Bug explanation'}],answer:{a:'first value',b:'sample explanation',a2:'second value'},explanation:'Expected: identify the sample behavior.\nReason: explain the cause briefly.\nAccept an equivalent correct fix.',rubric:[{key:'a',label:'Part A',max:5},{key:'b',label:'Part B',max:5}]},
 {...base,id:'review-b',question_id:'sample-b',fields:[{key:'sequence',label:'Result order'}],answer:{sequence:'sample order'},explanation:'Expected: preserve the specified order.\nAward partial credit using the stated criteria.',rubric:[{key:'answer',label:'Answer accuracy / partial credit',max:10}]},
 {...base,id:'review-legacy',question_id:'sample-legacy',fields:[{key:'a',label:'Result'}],answer:{a:'sample'},explanation:'(ORGANIZERS ONLY) '+ 'unrelated whole-round reference '.repeat(50),rubric:[{key:'answer',label:'Answer accuracy',max:10}]}];
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.routeWebSocket(/.*supabase.*realtime.*/,ws=>ws.close());
 await ctx.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON()||{};let data={};
  if(path==='/api/auth/session')data={session:{user:{id:'review-admin',email:'staff@example.test'}},recovery:false};
  else if(path==='/api/rpc/bh_bootstrap')data={role:'admin',team:null};
  else if(path==='/api/rpc/bh_staff_data')data=body.p_tab==='queue'?{items}:{event:{registration_open:true},rounds:[],teams:0,approved:0,active:0,pending_reviews:items.length};
  else if(path==='/api/rpc/bh_grade'){graded.push(body);items=items.filter(x=>x.id!==body.p_submission);data=null;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.getByRole('tab',{name:'Review queue',exact:true}).click();
 await page.getByRole('heading',{name:'Answer guide',exact:true}).first().waitFor();
 assert.equal(await page.getByRole('heading',{name:'Official marking guide',exact:true}).count(),0);
 const card=page.locator('article.staff-item').first();
 assert.deepEqual(await card.locator('.review-answer-label').allTextContents(),['First result','Second result','Bug explanation']);
 assert.equal(await card.locator('.marking-guide-summary p').count(),3);
 assert.equal(await page.getByText(/unrelated whole-round reference/).count(),0);
 await card.screenshot({path:fileURLToPath(new URL('../../private/marking-guide-desktop.png',import.meta.url))});
 await page.getByText(/A concise answer guide has not been added/).waitFor();
 const a=card.getByLabel('Part A / 5',{exact:true}),b=card.getByLabel('Part B / 5',{exact:true});
 await a.fill('6');await b.fill('4');assert.equal(await card.getByRole('button',{name:/Confirm score/}).isDisabled(),true);
 await a.fill('5');await card.getByRole('button',{name:'Confirm score · 9/10',exact:true}).click();
 await page.getByLabel('Answer accuracy / partial credit / 10',{exact:true}).waitFor();
 assert.deepEqual(graded,[{p_submission:'review-a',p_scores:{a:5,b:4},p_note:'Rubric review'}]);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.ok(await page.locator('.marking-guide').first().evaluate(el=>el.getBoundingClientRect().height<520));
 await page.locator('article.staff-item').first().screenshot({path:fileURLToPath(new URL('../../private/marking-guide-mobile.png',import.meta.url))});
 assert.deepEqual(errors,[]);
 console.log('PASS concise per-question guides, readable field order, legacy guide fallback, rubric limits, exact saved marks and mobile layout.');
}finally{await browser.close();}
