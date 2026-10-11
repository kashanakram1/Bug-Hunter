import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv[2]!=='setup')throw Error('Usage: node tools/project.mjs setup');
for(const directory of ['frontend','backend']){
 const result=spawnSync(process.execPath,[process.env.npm_execpath,'ci','--prefix',directory],{cwd:root,stdio:'inherit'});
 if(result.status!==0){process.exitCode=result.status||1;break;}
}
