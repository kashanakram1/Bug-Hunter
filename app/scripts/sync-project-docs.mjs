import { cpSync,existsSync } from 'node:fs';
const workspace=new URL('../../',import.meta.url);
const project=new URL('../',import.meta.url);
if(existsSync(new URL('supabase/migrations/',workspace))){
 cpSync(new URL('supabase/',workspace),new URL('supabase/',project),{recursive:true});
 cpSync(new URL('docs/',workspace),new URL('docs/',project),{recursive:true});
 console.log('Copied canonical migrations and operations documentation into the source package. No private content or credentials copied.');
}
