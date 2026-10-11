// Browser UI + real isolated PostgreSQL. Auth transport is simulated; production Auth is checked separately.
import { chromium } from '@playwright/test';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
const fixtures = JSON.parse(
  readFileSync(new URL('../../private/load-fixtures.json', import.meta.url), 'utf8'),
);
const env = parseEnv(readFileSync(new URL('../../frontend/.env.local', import.meta.url), 'utf8'));
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const pool = new Pool({
  host: '127.0.0.1',
  port: 55432,
  database: fixtures.database,
  user: 'postgres',
  max: 8,
});
const user = fixtures.users[1],
  admin = fixtures.admin;
async function call(identity, name, args = {}) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (identity) {
      await c.query(
        `select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)`,
        [identity.id, identity.session],
      );
      await c.query('set local role authenticated');
    } else await c.query('set local role anon');
    const entries = Object.entries(args);
    if (!/^bh_[a-z_]+$/.test(name) || entries.some(([k]) => !/^p_[a-z_]+$/.test(k)))
      throw Error('Invalid RPC');
    const r = await c.query(
      `select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(',')}) result`,
      entries.map(([, v]) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
    await c.query('commit');
    return r.rows[0].result;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
function jwt(identity) {
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  return (
    b64({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    b64({
      sub: identity.id,
      session_id: identity.session,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: 'authenticated',
    }) +
    '.test'
  );
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 960 } });
  await ctx.routeWebSocket(/.*supabase.*realtime.*/, (ws) => ws.close());
  await ctx.route(base + '/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let body = {};
    try {
      body = req.postDataJSON() || {};
    } catch {}
    let result,
      status = 200;
    try {
      if (url.pathname === '/auth/v1/token') {
        const identity = [user, admin].find((u) => u.email === body.email);
        if (!identity) throw Error('Unknown isolated test identity');
        result = {
          access_token: jwt(identity),
          refresh_token: 'isolated-test-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: identity.id,
            email: identity.email,
            role: 'authenticated',
            aud: 'authenticated',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            identities: [],
            created_at: new Date().toISOString(),
          },
        };
      } else if (url.pathname === '/auth/v1/logout') result = {};
      else if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const auth = req.headers().authorization;
        const identity = auth ? [user, admin].find((u) => auth === 'Bearer ' + jwt(u)) : null; // Match payload below: timestamps can advance between requests.
        let actual = identity;
        if (!actual && auth) {
          try {
            const payload = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
            actual = [user, admin].find(
              (u) => u.id === payload.sub && u.session === payload.session_id,
            );
          } catch {}
        }
        result = await call(actual, url.pathname.split('/').at(-1), body);
      } else if (url.pathname === '/auth/v1/user') {
        result = {
          id: user.id,
          email: user.email,
          role: 'authenticated',
          aud: 'authenticated',
          app_metadata: {},
          user_metadata: {},
        };
      } else throw Error('Unsupported isolated request');
    } catch (e) {
      status = 400;
      result = { message: e.message, code: e.code || 'TEST_ERROR' };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(result ?? null),
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  return ctx;
}
async function login(ctx, identity) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByLabel('Email', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill('IsolatedTestPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return page;
}
const teamContext = await context(),
  staffContext = await context();
const team = await login(teamContext, user);
await team.getByRole('heading', { name: 'Ready for the hunt?' }).waitFor();
await team
  .locator('.round-card')
  .filter({ hasText: 'Bug Blitz' })
  .getByRole('button', { name: 'Enter round' })
  .click();
await team.getByRole('button', { name: /Late Callbacks/ }).click();
await team.getByLabel('A · Printed values, in order', { exact: true }).fill('3 3 3');
await team.getByLabel('B · Which word changes, and to what?', { exact: true }).fill('var to let');
await team.getByText('Draft saved', { exact: true }).waitFor();
await team.reload();
await team.getByRole('heading', { name: 'Ready for the hunt?' }).waitFor();
await team
  .locator('.round-card')
  .filter({ hasText: 'Bug Blitz' })
  .getByRole('button', { name: 'Enter round' })
  .click();
await team.getByRole('button', { name: /Late Callbacks/ }).click();
assert.equal(
  await team.getByLabel('A · Printed values, in order', { exact: true }).inputValue(),
  '3 3 3',
);
await team.getByRole('button', { name: 'Submit answer', exact: true }).click();
await team.getByRole('button', { name: 'Confirm submission' }).click();
await team.getByRole('button', { name: 'Answer locked' }).waitFor();
await team.getByRole('button', { name: /The Shared Bucket/ }).click();
await team.getByLabel('A · First printed list').fill('[1]');
await team.getByLabel('A · Second printed list').fill('[1,2]');
await team.getByLabel('B · Name the bug').fill('A mutable default list is shared across calls');
await team.getByRole('button', { name: 'Submit answer', exact: true }).click();
await team.getByRole('button', { name: 'Confirm submission' }).click();
await team.getByRole('button', { name: 'Answer locked' }).waitFor();
await team.getByRole('tab', { name: 'Clarifications' }).click();
await team.getByLabel('Your question').fill('Please clarify the incident report word limit.');
await team.getByRole('button', { name: 'Send clarification' }).click();
await team.getByText('Awaiting reply', { exact: true }).waitFor();
await team.setViewportSize({ width: 390, height: 844 });
assert.equal(
  await team.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
  false,
);
await team.setViewportSize({ width: 1366, height: 960 });
console.log(
  'PASS team login, round entry, saved-draft recovery, locked submissions, clarification and mobile workspace.',
);
const staff = await login(staffContext, admin);
await staff.getByRole('heading', { name: 'Competition control.' }).waitFor();
await staff.getByRole('tab', { name: 'Review queue' }).click();
await staff.getByLabel('Part A / 5').fill('5');
await staff.getByLabel('Part B / 5').fill('5');
await staff.getByLabel("Judge's note").fill('Correct equivalent explanation accepted.');
await staff.getByRole('button', { name: 'Confirm score · 10/10' }).click();
await staff.getByText('Review queue is clear', { exact: true }).waitFor();
await staff.getByRole('tab', { name: 'Control room' }).click();
await staff
  .getByLabel('Message', { exact: true })
  .fill('Round one is complete. Please wait for qualification.');
await staff.getByRole('button', { name: 'Publish announcement' }).click();
await staff.getByLabel('Reason', { exact: true }).fill('Announce next step');
await staff.getByRole('button', { name: 'Confirm action', exact: true }).click();
await staff.getByRole('dialog').waitFor({ state: 'hidden' });
assert.equal(
  (await call(null, 'bh_public_state')).announcements[0].message,
  'Round one is complete. Please wait for qualification.',
);
console.log('PASS admin authentication, official rubric review and audited announcement.');
const adminAction = (action, payload) =>
  call(admin, 'bh_admin', {
    p_action: action,
    p_payload: payload,
    p_reason: 'Isolated browser workflow',
  });
await adminAction('round', { round: 1, status: 'closed' });
for (const round of [2, 3, 4]) {
  await adminAction('qualify', { round });
  await adminAction('round', { round, status: 'open' });
  await call(user, 'bh_heartbeat');
  await call(user, 'bh_start_round', { p_round: round });
  if (round < 4) await adminAction('round', { round, status: 'closed' });
}
await team.reload();
await team.getByRole('heading', { name: 'Ready for the hunt?' }).waitFor();
await team
  .locator('.round-card')
  .filter({ hasText: 'Final Debugging Arena' })
  .getByRole('button', { name: 'Enter round' })
  .click();
await team.getByLabel('File and function').fill('/login');
await team
  .getByLabel('What is wrong?')
  .fill('Credentials allow MongoDB operators and plaintext password matching');
await team.getByLabel('Why does it matter?').fill('An attacker can impersonate an administrator');
await team
  .getByLabel('Your fix')
  .fill('Validate string inputs, find by email, and use bcrypt.compare');
await team.getByText('Claim draft saved', { exact: true }).waitFor();
await team.getByRole('button', { name: 'Submit bug claim' }).click();
await team.locator('.claim-row').getByText('pending', { exact: true }).waitFor();
await team.getByRole('button', { name: /Incident report/ }).click();
await team
  .getByLabel('Incident report · 150 words maximum')
  .fill(
    'Prioritize login injection, patient identity spoofing, and unscoped appointment access. These expose medical data and permit account compromise. Validate credentials, derive patient identity from authentication, and restrict appointment queries to the current patient.',
  );
await team.getByRole('button', { name: 'Submit answer', exact: true }).click();
await team.getByRole('button', { name: 'Confirm submission' }).click();
await team.getByRole('button', { name: 'Answer locked' }).waitFor();
await staff.getByRole('tab', { name: 'Final claims' }).click();
await staff.getByRole('combobox', { name: 'Match official bug' }).selectOption('3');
await staff
  .getByLabel('Verification note')
  .fill('Correct identity validation and hash verification fix');
await staff.getByRole('button', { name: 'Confirm verification', exact: true }).click();
await staff.getByText('No claims awaiting review', { exact: true }).waitFor();
await staff.getByRole('tab', { name: 'Review queue' }).click();
for (const [label, value] of [
  ['Prioritisation / 20', '20'],
  ['Real-world impact / 15', '15'],
  ['Fix direction / 10', '10'],
  ['Clarity / 5', '5'],
])
  await staff.getByLabel(label, { exact: true }).fill(value);
await staff.getByLabel("Judge's note").fill('Clear prioritization and concrete mitigation');
await staff.getByRole('button', { name: 'Confirm score · 50/50' }).click();
await staff.getByText('Review queue is clear', { exact: true }).waitFor();
await adminAction('round', { round: 4, status: 'closed' });
await staff.getByRole('tab', { name: 'Results', exact: true }).click();
await staff.getByRole('button', { name: 'Finalize & issue certificates' }).click();
await staff.getByLabel('Reason', { exact: true }).fill('All reviews complete');
await staff.getByRole('button', { name: 'Confirm action', exact: true }).click();
await staff.getByText('Action recorded in the audit log', { exact: true }).waitFor();
const result = await call(user, 'bh_my_results');
assert.equal(result.released, true);
assert.equal(Number(result.team.score), 160);
const state = await call(user, 'bh_team_state', { p_round: 4 });
assert.ok(state.certificates.length >= 3);
const certificate = await teamContext.newPage();
await certificate.goto('http://127.0.0.1:5173/?certificate=' + state.certificates[0].id);
await certificate.getByText('VERIFIED CERTIFICATE', { exact: true }).waitFor();
await certificate.getByRole('button', { name: 'Print / Save PDF' }).waitFor();
console.log(
  'PASS final claim drafting, claim verification, first-critical bonus, report review, finalization and certificate verification.',
);
assert.deepEqual(errors, []);
await browser.close();
await pool.end();
console.log('PASS complete isolated browser workflow; no browser exceptions.');
