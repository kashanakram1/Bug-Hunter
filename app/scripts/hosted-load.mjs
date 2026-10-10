// Operator-run staging load test. Token file and results contain no printed credentials.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const path = arg('--tokens');
if (!path)
  throw Error(
    'Usage: hosted-load.mjs --tokens PRIVATE_JSON [--scenario read|draft|submit] [--staging confirmed]',
  );
const config = JSON.parse(readFileSync(path, 'utf8'));
if (
  !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabase_url) ||
  !config.publishable_key ||
  !Array.isArray(config.teams) ||
  config.teams.length !== 500
)
  throw Error('Supply a Supabase URL, publishable key, and exactly 500 team fixtures.');
const scenario = arg('--scenario') || 'read';
if (!['read', 'draft', 'submit'].includes(scenario)) throw Error('Unknown scenario');
if (scenario !== 'read' && arg('--staging') !== 'confirmed')
  throw Error('Write scenarios require --staging confirmed and a disposable staging event.');
const timings = [],
  failures = [];
let requests = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iterations = scenario === 'read' ? 3 : 1;
await Promise.all(
  config.teams.map(async (team, index) => {
    if (!team.access_token) throw Error('Fixture lacks access_token');
    await delay(scenario === 'read' ? Math.random() * 18000 : Math.random() * 1000);
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const rpc =
        scenario === 'read'
          ? 'bh_team_state'
          : scenario === 'draft'
            ? 'bh_save_draft'
            : 'bh_submit';
      const params =
        scenario === 'read'
          ? { p_round: team.round || 1 }
          : scenario === 'draft'
            ? {
                p_question: team.question_id,
                p_answer: team.answer,
                p_revision: team.revision || 0,
              }
            : { p_question: team.question_id, p_answer: team.answer, p_request: randomUUID() };
      try {
        const r = await fetch(config.supabase_url + '/rest/v1/rpc/' + rpc, {
          method: 'POST',
          headers: {
            apikey: config.publishable_key,
            Authorization: 'Bearer ' + team.access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(15000),
        });
        await r.arrayBuffer();
        requests++;
        if (!r.ok) failures.push({ team: index, status: r.status });
        else timings.push(performance.now() - start);
      } catch {
        requests++;
        failures.push({ team: index, status: 'transport' });
      }
      if (i + 1 < iterations) await delay(18000 + Math.random() * 6000);
    }
  }),
);
timings.sort((a, b) => a - b);
const percentile = (p) =>
  timings.length
    ? Math.round(timings[Math.min(timings.length - 1, Math.floor(timings.length * p))])
    : null;
const report = {
  date: new Date().toISOString(),
  scenario,
  teams: 500,
  requests,
  failures: failures.length,
  error_rate: failures.length / requests,
  p50_ms: percentile(0.5),
  p95_ms: percentile(0.95),
  p99_ms: percentile(0.99),
  failure_statuses: failures.reduce((a, f) => ({ ...a, [f.status]: (a[f.status] || 0) + 1 }), {}),
};
writeFileSync(arg('--output') || 'hosted-load-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.error_rate >= 0.01 || report.p95_ms === null || report.p95_ms > 2000)
  process.exitCode = 1;
