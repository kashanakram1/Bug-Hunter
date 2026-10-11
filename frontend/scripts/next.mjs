import { fileURLToPath } from 'node:url';
import { configureBrowserEnvironment } from './configure-env.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (['build', 'dev', 'start'].includes(process.argv[2])) {
  configureBrowserEnvironment(process.argv[2] === 'build' ? 'production' : 'development');
  const envFile=new URL('../../.env',import.meta.url);
  if(existsSync(envFile)){
    const values=parseEnv(readFileSync(envFile,'utf8'));
    for(const name of ['SUPABASE_SECRET_KEY','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'])
      if(process.env[name]===undefined&&values[name])process.env[name]=values[name];
  }
}
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.argv = [
  process.execPath,
  fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
  ...process.argv.slice(2),
];
await import('../node_modules/next/dist/bin/next');
