import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
const workspace = new URL('../../', import.meta.url);
const root = existsSync(new URL('.env', workspace)) ? workspace : new URL('../', import.meta.url);
const path = new URL('.env', root);
if (!existsSync(path)) {
  console.error('Missing project-root .env. No credentials were printed.');
  process.exit(1);
}
const env = parseEnv(readFileSync(path, 'utf8'));
const allowed = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
for (const key of allowed)
  if (!env[key] || /<|your-|new password/i.test(env[key]))
    throw new Error(`${key} is missing or a placeholder.`);
const url = new URL(env.SUPABASE_URL);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co'))
  throw new Error('Expected an HTTPS Supabase project URL.');
// Deliberate allowlist: never copy the secret key, DB password, or connection string.
writeFileSync(
  new URL('../.env.local', import.meta.url),
  allowed.map((k) => `NEXT_PUBLIC_${k}=${env[k]}`).join('\n') + '\n',
);
console.log('Configured the two permitted public browser settings. No secrets copied.');
