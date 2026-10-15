// Editorial updates only. Private answer guides never enter frontend source or bundles.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import pg from 'pg';
const root=new URL('../../',import.meta.url);
const env=parseEnv(readFileSync(new URL('.env',root),'utf8'));
const guides=JSON.parse(readFileSync(new URL('private/marking-guides.json',root),'utf8'));
const url=new URL(env.DATABASE_URL.replace(/<new password>|<password>/gi,encodeURIComponent(env.SUPABASE_DB_PASSWORD)));
if(!env.SUPABASE_PROJECT_REF||!url.username.includes(env.SUPABASE_PROJECT_REF))throw Error('Project mismatch');
if(!Array.isArray(guides)||guides.length!==23||new Set(guides.map(g=>g.id)).size!==guides.length||guides.some(g=>typeof g.text!=='string'||g.text.length>700||g.text.trim().split(/\s+/).length>100||g.text.length<30))throw Error('Expected 23 unique, concise question guides');
const db=new pg.Client({host:url.hostname,port:Number(url.port||5432),user:decodeURIComponent(url.username),password:env.SUPABASE_DB_PASSWORD,database:url.pathname.slice(1),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
try{
 await db.connect();await db.query('begin');
 const original=(await db.query('select question_id,explanation,rubric,accepted from bughunt.answer_keys order by question_id for update')).rows;
 if(original.length!==guides.length||original.some(row=>!guides.some(g=>g.id===row.question_id)))throw Error('Live question cohort differs from the prepared guides');
 const folder='private/marking-guides-backup-'+Date.now()+'/';mkdirSync(new URL(folder,root),{recursive:true});
 writeFileSync(new URL(folder+'answer-keys.json',root),JSON.stringify(original,null,2));
 const scoringHash=digest(original.map(({question_id,rubric,accepted})=>({question_id,rubric,accepted})));
 for(const g of guides)await db.query('update bughunt.answer_keys set explanation=$1 where question_id=$2',[g.text,g.id]);
 const updated=(await db.query('select question_id,rubric,accepted from bughunt.answer_keys order by question_id')).rows;
 if(digest(updated)!==scoringHash)throw Error('Scoring data unexpectedly changed; rolling back');
 await db.query("insert into bughunt.audit(action,target,new_value,reason) values('update_marking_guides','answer_keys',$1,'User requested concise, question-specific staff marking guidance; scoring rules preserved')",[JSON.stringify({questions:guides.length})]);
 await db.query('commit');
 console.log(JSON.stringify({updated_guides:guides.length,scoring_rules_unchanged:true,backup:folder}));
}catch(e){await db.query('rollback').catch(()=>{});console.error('Guide update failed: '+(e.code||'validation or connection failure'));process.exitCode=1;}finally{await db.end();}
