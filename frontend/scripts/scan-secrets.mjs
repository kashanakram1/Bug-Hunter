import { readFileSync,readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const env=parseEnv(readFileSync(new URL('../../.env',import.meta.url),'utf8'));
const prohibited=[env.SUPABASE_SECRET_KEY,env.SUPABASE_DB_PASSWORD,env.SUPABASE_ACCESS_TOKEN,env.BREVO_SMTP_KEY,env.SUPABASE_DB_PASSWORD?encodeURIComponent(env.SUPABASE_DB_PASSWORD):null].filter(x=>x&&x.length>=8&&!x.startsWith('<'));
const root=fileURLToPath(new URL('../',import.meta.url));
function paths(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?['node_modules','.git','.next','private','tools','.sites-runtime','test-results'].includes(e.name)?[]:paths(join(dir,e.name)):e.name.startsWith('.env')?[]:[join(dir,e.name)]);}
let leaks=0;for(const file of paths(root)){const buf=readFileSync(file);for(const secret of prohibited)if(buf.includes(Buffer.from(secret))){console.error('Secret found in a source/build file:',file.replace(root,''));leaks++;}}
if(leaks)process.exitCode=1;else console.log('PASS no service key or database password in publishable source or built assets.');
