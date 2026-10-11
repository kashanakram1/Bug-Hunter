import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const workspace = new URL('../../', import.meta.url);
const root = workspace;
const env = parseEnv(readFileSync(new URL('.env', root), 'utf8'));
const raw = env.DATABASE_URL?.replace(
  /<new password>|<password>/gi,
  encodeURIComponent(env.SUPABASE_DB_PASSWORD || ''),
);
if (!raw || /<|your-|new password/i.test(raw))
  throw new Error('DATABASE_URL still contains placeholders.');
const db = new URL(raw);
const expected = env.SUPABASE_PROJECT_REF;
if (!expected || !db.username.includes(expected))
  throw new Error('Database user does not match SUPABASE_PROJECT_REF.');
const localPsql = new URL('tools/postgresql-client/psql.exe', root);
const psql = existsSync(localPsql) ? fileURLToPath(localPsql) : 'psql';
const processEnv = {
  ...process.env,
  PGHOST: db.hostname,
  PGPORT: db.port || '5432',
  PGUSER: decodeURIComponent(db.username),
  PGPASSWORD: env.SUPABASE_DB_PASSWORD || decodeURIComponent(db.password),
  PGDATABASE: db.pathname.slice(1),
  PGSSLMODE: env.PGSSLMODE || 'require',
  PGCONNECT_TIMEOUT: '15',
  PGAPPNAME: 'bughunt-migrations',
};
if (env.PGSSLROOTCERT) processEnv.PGSSLROOTCERT = env.PGSSLROOTCERT;
function run(sql, allowOutput = false) {
  const result = spawnSync(
    psql,
    ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'],
    { input: sql, env: processEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 5e6 },
  );
  if (result.error) {
    console.error('psql could not run:', result.error.code || 'unknown');
    process.exit(1);
  }
  if (result.status !== 0) {
    let safe = (result.stderr || 'Database command failed')
      .split('\n')
      .filter((l) => /ERROR|FATAL|error:/.test(l))
      .join('\n');
    for (const value of [env.SUPABASE_DB_PASSWORD, env.SUPABASE_SECRET_KEY, raw])
      if (value) safe = safe.replaceAll(value, '[REDACTED]');
    console.error(safe);
    process.exit(1);
  }
  return allowOutput ? result.stdout.trim() : null;
}
const mode = process.argv[2] || 'check';
if (mode === 'check') {
  const result = run(
    `select json_build_object('connected',true,'competition_schema_exists',exists(select 1 from pg_namespace where nspname='bughunt'),'postgres_version',current_setting('server_version_num'));`,
    true,
  );
  console.log(result);
} else if (mode === 'migrate') {
  const exists = run(`select exists(select 1 from pg_namespace where nspname='bughunt');`, true);
  if (exists === 't') {
    const ledger = run(`select to_regclass('bughunt.schema_migrations') is not null;`, true);
    if (ledger !== 't')
      throw new Error('Existing untracked bughunt schema found. Stopping without overwriting it.');
  }
  const files = readdirSync(new URL('backend/supabase/migrations/', root))
    .filter((x) => /^\d+.*\.sql$/.test(x))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL('backend/supabase/migrations/' + file, root), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (exists === 't') {
      const old = run(
        `select checksum from bughunt.schema_migrations where version='${file}';`,
        true,
      );
      if (old) {
        if (old !== checksum) throw new Error('Applied migration changed: ' + file);
        console.log('Already applied:', file);
        continue;
      }
    }
    const ledger = `create table if not exists bughunt.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now()); alter table bughunt.schema_migrations enable row level security;`;
    // This ledger definition is included in migration 001; no runtime schema changes.
    run(
      `begin; select pg_advisory_xact_lock(2026,9002); ${sql}\n insert into bughunt.schema_migrations(version,checksum) values('${file}','${checksum}'); commit;`,
    );
    console.log('Applied:', file);
  }
} else if (mode === 'seed') {
  const path = new URL('private/official-content.json', root);
  if (!existsSync(path)) throw new Error('Private official question bank is missing.');
  const content = JSON.parse(readFileSync(path, 'utf8'));
  if (content.questions.length !== 23 || content.bugs.length !== 12)
    throw new Error('Invalid official content counts.');
  const literal = (v) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
  let sql = `begin; select pg_advisory_xact_lock(2026,9002); do $$ begin if exists(select 1 from bughunt.rounds where status<>'draft') then raise exception 'Question bank is frozen after a round opens'; end if; end $$;`;
  for (const q of content.questions) {
    const { explanation, rubric, accepted, ...row } = q;
    sql += `\ninsert into bughunt.questions select * from jsonb_populate_record(null::bughunt.questions,${literal(row)}) on conflict(id) do nothing;\ninsert into bughunt.answer_keys select * from jsonb_populate_record(null::bughunt.answer_keys,${literal({ question_id: q.id, explanation, rubric, accepted })}) on conflict(question_id) do nothing;`;
  }
  for (const b of content.bugs)
    sql += `\ninsert into bughunt.bugs select * from jsonb_populate_record(null::bughunt.bugs,${literal(b)}) on conflict(id) do nothing;`;
  sql += '\ncommit;';
  run(sql);
  console.log('Private official content loaded. Existing content was preserved.');
} else if (mode === 'staff') {
  const [email, role] = process.argv.slice(3);
  if (!email || !['admin', 'judge'].includes(role))
    throw new Error('Usage: database.mjs staff EMAIL admin|judge');
  const escaped = email.replaceAll("'", "''");
  run(
    `begin; insert into bughunt.staff_access(email,role) values(lower('${escaped}'),'${role}') on conflict(email) do update set role=excluded.role; insert into bughunt.staff(user_id,role) select id,'${role}' from auth.users where lower(email)=lower('${escaped}') and email_confirmed_at is not null on conflict(user_id) do update set role=excluded.role; insert into bughunt.audit(action,target,new_value,reason) values('provision_staff','account',jsonb_build_object('role','${role}'),'Operator provisioned staff using private database access'); commit;`,
  );
  console.log('Staff access reserved; it activates after email confirmation and sign-in.');
} else throw new Error('Unknown database command.');
