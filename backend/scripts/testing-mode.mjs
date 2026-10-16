// Explicit operator action: keep portal entry open; real round clocks and saved attempts remain.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const mode = process.argv[2] || 'status';
if (!['on', 'off', 'status'].includes(mode)) throw new Error('Use on, off, or status');
const env = parseEnv(readFileSync(new URL('.env', root), 'utf8'));
const connection = new URL(env.DATABASE_URL.replace(/<new password>|<password>/gi, encodeURIComponent(env.SUPABASE_DB_PASSWORD)));
if (!connection.username.includes(env.SUPABASE_PROJECT_REF)) throw new Error('Project mismatch');
function run(sql) {
  const result = spawnSync(fileURLToPath(new URL('tools/postgresql-client/psql.exe', root)), ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], {
    input: sql, encoding: 'utf8', timeout: 45000,
    env: { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGUSER: decodeURIComponent(connection.username), PGPASSWORD: env.SUPABASE_DB_PASSWORD, PGDATABASE: connection.pathname.slice(1), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'bughunt-testing-mode' },
  });
  if (result.status !== 0) throw new Error('Testing mode database operation failed; no credentials logged.');
  return JSON.parse(result.stdout.trim());
}
if (mode !== 'status') {
  const before = run('select to_jsonb(e) from bughunt.event e where id;');
  mkdirSync(new URL('private/', root), { recursive: true });
  writeFileSync(new URL(`private/testing-mode-backup-${Date.now()}.json`, root), JSON.stringify(before, null, 2) + '\n');
  run(`begin;
    do $$ declare original jsonb; changed jsonb; begin
      select to_jsonb(e) into original from bughunt.event e where id for update;
      if (original->>'results_released')::boolean then raise exception 'Results are finalized'; end if;
      update bughunt.event set unlimited_testing=${mode === 'on'},
        online_starts_at='2026-10-17 16:00:00+05',online_entry_closes_at='2026-10-17 16:20:00+05',online_ends_at='2026-10-17 17:40:00+05' where id;
      select to_jsonb(e) into changed from bughunt.event e where id;
      if (original-'unlimited_testing'-'online_starts_at'-'online_entry_closes_at'-'online_ends_at')<>(changed-'unlimited_testing'-'online_starts_at'-'online_entry_closes_at'-'online_ends_at') then raise exception 'Unexpected setting change'; end if;
      perform bughunt.audit_write('testing_mode','event',original,changed,'Organizer explicitly requested testing ${mode}');
    end $$;
    select jsonb_build_object('changed',true); commit;`);
}
console.log(JSON.stringify(run(`select jsonb_build_object('access_override',unlimited_testing,'window',bughunt.online_window(),'official_starts_at',online_starts_at,'rounds',bughunt.online_rounds((select jsonb_agg(to_jsonb(r) order by id) from bughunt.rounds r))) from bughunt.event where id;`)));
