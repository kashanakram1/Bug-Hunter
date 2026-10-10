import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Hosting variables take precedence over local files. Only these two settings
// can enter browser configuration; service credentials are never promoted.
export function browserSettings(sources) {
  const result = {};
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) {
    const publicName = `NEXT_PUBLIC_${name}`;
    const source = sources.find((s) => s[publicName] !== undefined || s[name] !== undefined);
    const value = String(source?.[publicName] ?? source?.[name] ?? '').trim();
    if (!value || /<|your-|new password/i.test(value))
      throw new Error(`${publicName} (or ${name}) must be configured before building.`);
    result[publicName] = value;
  }
  let url;
  try { url = new URL(result.NEXT_PUBLIC_SUPABASE_URL); } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS Supabase project URL.');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.search || url.hash)
    throw new Error('Expected an HTTPS Supabase project URL without credentials.');
  const key = result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role === 'anon';
    } catch { /* Never include the key in diagnostics. */ }
  }
  if (!publicKey)
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key, never a service key.');
  return result;
}

export function configureBrowserEnvironment(mode = 'production') {
  const app = new URL('../', import.meta.url);
  const candidates = [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']
    .map((name) => new URL(name, app));
  candidates.push(new URL('../../.env', import.meta.url));
  const sources = [process.env, ...candidates.filter(existsSync).map((file) => parseEnv(readFileSync(file, 'utf8')))];
  const settings = browserSettings(sources);
  Object.assign(process.env, settings);
  return settings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const settings = configureBrowserEnvironment(process.env.NODE_ENV || 'development');
  writeFileSync(new URL('../.env.local', import.meta.url),
    Object.entries(settings).map(([name, value]) => `${name}=${value}`).join('\n') + '\n');
  console.log('Configured the two public browser settings. No secrets copied.');
}
