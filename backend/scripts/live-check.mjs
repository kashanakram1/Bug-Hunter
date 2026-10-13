// Safe public/denied probes only. No credentials are logged and no event writes are admitted.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const env=parseEnv(readFileSync(new URL('../../.env',import.meta.url),'utf8'));
const origin=process.env.BUGHUNT_SITE_URL || 'https://bug-hunter-plum.vercel.app';
const checks=[
 ['Public competition gateway',origin+'/api/rpc/bh_public_state',{},200],
 ['Unauthenticated staff denied',origin+'/api/rpc/bh_staff_data',{p_tab:'questions'},401],
 ['Unauthenticated submission denied',origin+'/api/rpc/bh_submit',{p_question:'R1-Q1',p_answer:{a:'x'},p_request:crypto.randomUUID()},401],
 ['Private schema not exposed',env.SUPABASE_URL+'/rest/v1/questions?select=*',null,404],
];
let failed=false;
for(const [name,url,body,expected] of checks){
 const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(url.startsWith(origin)?{Origin:origin,'X-BugHunt-Request':'1'}:{apikey:env.SUPABASE_PUBLISHABLE_KEY})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 console.log((r.status===expected?'PASS ':'FAIL ')+name+': '+r.status);if(r.status!==expected)failed=true;
}
process.exitCode=failed?1:0;
