import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'));
const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
const checks = [
  ['Public competition state', '/rest/v1/rpc/bh_public_state', {}, 200],
  [
    'Unauthenticated staff access denied',
    '/rest/v1/rpc/bh_staff_data',
    { p_tab: 'questions' },
    401,
  ],
  [
    'Unauthenticated submission denied',
    '/rest/v1/rpc/bh_submit',
    { p_question: 'R1-Q1', p_answer: { a: 'x', b: 'x' }, p_request: crypto.randomUUID() },
    401,
  ],
  ['Private schema not exposed', '/rest/v1/questions?select=*', null, 404],
];
let failed = false;
for (const [label, path, body, expected] of checks) {
  const r = await fetch(env.SUPABASE_URL + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const ok = r.status === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (HTTP ${r.status})`);
  if (!ok) failed = true;
}
const settings = await fetch(env.SUPABASE_URL + '/auth/v1/settings', {
  headers,
  signal: AbortSignal.timeout(20000),
});
if (settings.ok) {
  const s = await settings.json();
  console.log('Email authentication:', s.external?.email ? 'enabled' : 'disabled');
  console.log(
    'Email confirmation:',
    s.mailer_autoconfirm ? 'DISABLED — enable before event' : 'required',
  );
}
if (failed) process.exitCode = 1;
