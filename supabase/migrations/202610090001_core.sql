-- Additive initial schema. All competition data is private; browsers use authorized RPCs.
create schema if not exists bughunt;
revoke all on schema bughunt from public, anon, authenticated;

create table bughunt.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now());

create table bughunt.staff (
 user_id uuid primary key references auth.users(id), role text not null check(role in ('admin','judge'))
);
create table bughunt.event (
 id boolean primary key default true check(id), name text not null default 'Bug Hunt 2026',
 leaderboard_visible boolean not null default false, results_released boolean not null default false,
 registration_open boolean not null default true, finalized_at timestamptz,
 updated_at timestamptz not null default now()
);
insert into bughunt.event(id) values(true);
create table bughunt.teams (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id),
 name text not null check(length(name) between 3 and 30 and name=btrim(name)),
 leader text not null check(length(leader) between 1 and 100), email text not null,
 university text not null check(length(university) between 1 and 150), department text not null check(length(department) between 1 and 150),
 members jsonb not null check(jsonb_typeof(members)='array' and jsonb_array_length(members) between 2 and 4),
 newcomer boolean not null default false, status text not null default 'pending' check(status in ('pending','approved','rejected','disqualified')),
 session_limit integer not null default 1 check(session_limit between 1 and 2), created_at timestamptz not null default now(),
 total_score numeric not null default 0, solved integer not null default 0, penalties numeric not null default 0,
 reached_at timestamptz not null default now(), final_completed_at timestamptz
);
create unique index teams_name_unique on bughunt.teams(lower(name));
create index teams_ranking on bughunt.teams(status,total_score desc,solved desc,reached_at,penalties,final_completed_at);
create table bughunt.rounds (
 id integer primary key check(id between 1 and 4), name text not null, duration_seconds integer not null check(duration_seconds between 60 and 14400),
 max_points integer not null, status text not null default 'draft' check(status in ('draft','open','paused','closed')),
 paused_at timestamptz, opened_at timestamptz, closed_at timestamptz
);
insert into bughunt.rounds(id,name,duration_seconds,max_points) values
 (1,'Bug Blitz',1200,100),(2,'Code Breaker',1800,200),(3,'System Under Attack',1800,300),(4,'Final Debugging Arena',2400,500);
create table bughunt.questions (
 id text primary key, round_id integer not null references bughunt.rounds(id), title text not null,
 language text not null, difficulty text not null, prompt text not null, code text not null default '',
 fields jsonb not null, max_points integer not null check(max_points>0), max_attempts integer not null check(max_attempts between 1 and 3),
 kind text not null default 'answer' check(kind in ('answer','arena','report')), ordinal integer not null,
 unique(round_id,ordinal)
);
create table bughunt.answer_keys (
 question_id text primary key references bughunt.questions(id), explanation text not null,
 rubric jsonb not null, accepted jsonb not null default '{}'
);
create table bughunt.bugs (
 id integer primary key, title text not null, location text not null, explanation text not null,
 severity text not null check(severity in ('minor','medium','major','critical')), points integer not null,
 check((severity='minor' and points=10) or (severity='medium' and points=25) or (severity='major' and points=45) or (severity='critical' and points=70))
);
create table bughunt.qualifications (
 team_id uuid references bughunt.teams(id), round_id integer references bughunt.rounds(id), qualified boolean not null,
 primary key(team_id,round_id)
);
create table bughunt.round_sessions (
 team_id uuid references bughunt.teams(id), round_id integer references bughunt.rounds(id),
 started_at timestamptz not null default now(), ends_at timestamptz not null, completed_at timestamptz,
 primary key(team_id,round_id)
);
create table bughunt.login_leases (
 team_id uuid references bughunt.teams(id), session_id uuid not null, expires_at timestamptz not null,
 primary key(team_id,session_id)
);
create table bughunt.submissions (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references bughunt.teams(id),
 question_id text not null references bughunt.questions(id), request_id uuid not null, attempt integer not null,
 answer jsonb not null, suggested_score numeric not null default 0, score numeric,
 state text not null default 'pending' check(state in ('pending','graded')), submitted_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id), reviewed_at timestamptz, rubric_scores jsonb, note text,
 unique(team_id,question_id,attempt), unique(team_id,request_id)
);
create index submissions_queue on bughunt.submissions(state,submitted_at);
create index submissions_team_question on bughunt.submissions(team_id,question_id,score desc);
create table bughunt.drafts (
 team_id uuid references bughunt.teams(id), question_id text references bughunt.questions(id),
 answer jsonb not null, revision integer not null default 1, updated_at timestamptz not null default now(), primary key(team_id,question_id)
);
create table bughunt.claims (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references bughunt.teams(id), request_id uuid not null,
 location text not null, cause text not null, impact text not null, fix text not null,
 state text not null default 'pending' check(state in ('pending','verified','rejected','duplicate','extra')),
 bug_id integer references bughunt.bugs(id), extra_label text, points integer not null default 0,
 submitted_at timestamptz not null default now(), reviewed_by uuid references auth.users(id), reviewed_at timestamptz, note text,
 unique(team_id,request_id)
);
create unique index claims_once_per_bug on bughunt.claims(team_id,bug_id) where state='verified';
create unique index claims_once_per_extra on bughunt.claims(team_id,lower(extra_label)) where state='extra';
create index claims_queue on bughunt.claims(state,submitted_at);
create table bughunt.first_blood (
 bug_id integer primary key references bughunt.bugs(id), team_id uuid not null references bughunt.teams(id),
 claim_id uuid not null unique references bughunt.claims(id), awarded_at timestamptz not null default now()
);
create table bughunt.adjustments (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references bughunt.teams(id),
 amount numeric not null check(amount between -5000 and 5000), reason text not null, source text not null,
 actor uuid references auth.users(id), created_at timestamptz not null default now(), unique(team_id,source)
);
create table bughunt.activity (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references bughunt.teams(id), round_id integer not null references bughunt.rounds(id),
 request_id uuid not null, kind text not null check(kind in ('tab','fullscreen','paste')),
 created_at timestamptz not null default now(), unique(team_id,request_id)
);
create index activity_threshold on bughunt.activity(team_id,round_id,kind);
create table bughunt.announcements (
 id uuid primary key default gen_random_uuid(), message text not null check(length(message) between 1 and 2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table bughunt.clarifications (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references bughunt.teams(id),
 question text not null check(length(question) between 1 and 2000), answer text, answered_by uuid references auth.users(id),
 created_at timestamptz not null default now(), answered_at timestamptz
);
create index clarification_team on bughunt.clarifications(team_id,created_at desc);
create table bughunt.audit (
 id bigint generated always as identity primary key, actor uuid, action text not null, target text,
 old_value jsonb, new_value jsonb, reason text, created_at timestamptz not null default now()
);
create table bughunt.certificates (
 id uuid primary key default gen_random_uuid(), team_id uuid not null references bughunt.teams(id),
 team_name text not null, award text not null, event_name text not null, issued_at timestamptz not null default now(),
 unique(team_id,award)
);

-- No browser has schema USAGE or table privileges. Explicit policies provide defense in depth.
do $$ declare t text; begin
 foreach t in array array['schema_migrations','staff','event','teams','rounds','questions','answer_keys','bugs','qualifications','round_sessions','login_leases','submissions','drafts','claims','first_blood','adjustments','activity','announcements','clarifications','audit','certificates'] loop
  execute format('alter table bughunt.%I enable row level security',t);
  execute format('create policy deny_direct_access on bughunt.%I for all to anon, authenticated using (false) with check (false)',t);
 end loop;
end $$;
revoke all on all tables in schema bughunt from public,anon,authenticated;
revoke all on all sequences in schema bughunt from public,anon,authenticated;
alter default privileges in schema bughunt revoke execute on functions from public;

create function bughunt.require_user() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); sid uuid:=(auth.jwt()->>'session_id')::uuid;
begin
 if u is null or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=u) then raise exception 'Sign in required' using errcode='28000'; end if;
 return u;
end $$;
create function bughunt.require_staff(admin_only boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); begin
 if not exists(select 1 from bughunt.staff where user_id=u and (not admin_only or role='admin')) then raise exception 'Staff access required' using errcode='42501'; end if;
 return u;
end $$;
create function bughunt.require_team(lease_required boolean default true) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); t uuid; begin
 select id into t from bughunt.teams where owner_id=u;
 if t is null then raise exception 'Register your team first'; end if;
 if lease_required and not exists(select 1 from bughunt.login_leases where team_id=t and session_id=(auth.jwt()->>'session_id')::uuid and expires_at>now()) then raise exception 'Competition session expired or active on another device'; end if;
 return t;
end $$;
create function bughunt.ensure_writable() returns void language plpgsql security definer set search_path='' as $$
begin if (select results_released from bughunt.event where id) then raise exception 'Results are finalized'; end if; end $$;
create function bughunt.assert_round(t uuid, r integer) returns void language plpgsql security definer set search_path='' as $$
declare rs bughunt.round_sessions; state text; begin
 select status into state from bughunt.rounds where id=r for share;
 if state <> 'open' then raise exception 'Round is not open'; end if;
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Team is not approved'; end if;
 if r>1 and not exists(select 1 from bughunt.qualifications where team_id=t and round_id=r and qualified) then raise exception 'Round not available'; end if;
 select * into rs from bughunt.round_sessions where team_id=t and round_id=r;
 if rs.team_id is null or rs.completed_at is not null or now()>=rs.ends_at then raise exception 'Round time has ended or has not started'; end if;
end $$;
create function bughunt.audit_write(action text,target text,old_value jsonb,new_value jsonb,reason text default null) returns void language sql security definer set search_path='' as $$
 insert into bughunt.audit(actor,action,target,old_value,new_value,reason) values(auth.uid(),action,target,old_value,new_value,reason);
$$;
create function bughunt.recalculate(t uuid) returns void language plpgsql security definer set search_path='' as $$
declare points numeric; solved_count integer; penalty numeric; begin
 select coalesce(sum(best),0),count(*) filter(where best>=max_points) into points,solved_count from (
 select q.id,q.max_points,max(s.score) as best from bughunt.submissions s join bughunt.questions q on q.id=s.question_id
 where s.team_id=t and s.state='graded' group by q.id,q.max_points) x;
 solved_count:=solved_count+(select count(*) from bughunt.claims where team_id=t and state='verified');
 select coalesce(-sum(amount) filter(where amount<0),0) into penalty from bughunt.adjustments where team_id=t;
 points:=points+coalesce((select sum(c.points) from bughunt.claims c where c.team_id=t),0)+10*(select count(*) from bughunt.first_blood where team_id=t)+coalesce((select sum(amount) from bughunt.adjustments where team_id=t),0);
 update bughunt.teams set reached_at=case when total_score<>points then now() else reached_at end,total_score=points,solved=solved_count,penalties=penalty where id=t;
end $$;

create function public.bh_bootstrap() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); role_name text; t bughunt.teams; begin
 select role into role_name from bughunt.staff where user_id=u;
 select * into t from bughunt.teams where owner_id=u;
 return jsonb_build_object('role',coalesce(role_name,'team'),'team',case when t.id is null then null else to_jsonb(t)-'total_score'-'solved'-'penalties'-'reached_at' end,'event',(select to_jsonb(e) from bughunt.event e where id),'rounds',(select jsonb_agg(to_jsonb(r) order by id) from bughunt.rounds r),'server_time',now());
end $$;
create function public.bh_register(p_name text,p_leader text,p_university text,p_department text,p_members jsonb,p_newcomer boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); t uuid; member jsonb; email_address text; begin
 if not (select registration_open from bughunt.event where id) then raise exception 'Registration is closed'; end if;
 select email into email_address from auth.users where id=u and email_confirmed_at is not null;
 if email_address is null then raise exception 'Confirm your email before registering'; end if;
 if jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members) not between 2 and 4 or octet_length(p_members::text)>4000 then raise exception 'Teams need 2 to 4 members, including the leader'; end if;
 for member in select value from jsonb_array_elements(p_members) loop
  if length(btrim(coalesce(member->>'name',''))) not between 1 and 100 or length(coalesce(member->>'registration',''))>80 then raise exception 'Invalid member details'; end if;
 end loop;
 insert into bughunt.teams(owner_id,name,leader,email,university,department,members,newcomer)
 values(u,btrim(p_name),btrim(p_leader),email_address,btrim(p_university),btrim(p_department),p_members,p_newcomer) returning id into t;
 perform bughunt.audit_write('register',t::text,null,jsonb_build_object('name',btrim(p_name))); return t;
end $$;
create function public.bh_heartbeat() returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(false); sid uuid:=(auth.jwt()->>'session_id')::uuid; lim integer; begin
 select session_limit into lim from bughunt.teams where id=t for update;
 if not exists(select 1 from bughunt.login_leases where team_id=t and session_id=sid and expires_at>now()) and (select count(*) from bughunt.login_leases where team_id=t and expires_at>now())>=lim then
  if not exists(select 1 from bughunt.audit where action='blocked_login' and target=t::text and created_at>now()-interval '15 minutes') then perform bughunt.audit_write('blocked_login',t::text,null,jsonb_build_object('session',sid),'Concurrent competition session blocked'); end if;
  return jsonb_build_object('allowed',false,'message','Another device has the active competition session. Ask an organizer to release it.');
 end if;
 insert into bughunt.login_leases(team_id,session_id,expires_at) values(t,sid,now()+interval '120 seconds') on conflict(team_id,session_id) do update set expires_at=excluded.expires_at;
 return jsonb_build_object('allowed',true,'server_time',now());
end $$;
create function public.bh_release_session() returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(false); begin
 update bughunt.login_leases set expires_at=now() where team_id=t and session_id=(auth.jwt()->>'session_id')::uuid;
end $$;
create function public.bh_start_round(p_round integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); r bughunt.rounds; result bughunt.round_sessions; begin
 perform 1 from bughunt.teams where id=t and status='approved'; if not found then raise exception 'Approval required'; end if;
 select * into r from bughunt.rounds where id=p_round for share;
 if r.id is null or r.status<>'open' then raise exception 'Round not available'; end if;
 if p_round>1 and not exists(select 1 from bughunt.qualifications where team_id=t and round_id=p_round and qualified) then raise exception 'You have not qualified for this round'; end if;
 insert into bughunt.round_sessions(team_id,round_id,ends_at) values(t,p_round,now()+make_interval(secs=>r.duration_seconds)) on conflict do nothing;
 select * into result from bughunt.round_sessions where team_id=t and round_id=p_round;
 return to_jsonb(result)||jsonb_build_object('server_time',now());
end $$;
create function public.bh_team_state(p_round integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); r bughunt.rounds; sess bughunt.round_sessions; can_read boolean; begin
 select * into r from bughunt.rounds where id=p_round;
 select * into sess from bughunt.round_sessions where team_id=t and round_id=p_round;
 can_read:=sess.team_id is not null and r.status in ('open','paused') and exists(select 1 from bughunt.teams where id=t and status='approved');
 return jsonb_build_object('server_time',now(),'round',to_jsonb(r),'session',case when sess.team_id is null then null else to_jsonb(sess) end,
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)) from bughunt.qualifications q where team_id=t),'[]'),
 'questions',case when can_read then coalesce((select jsonb_agg(to_jsonb(q) order by case when p_round=1 then md5(t::text||q.id) else lpad(q.ordinal::text,3,'0') end) from bughunt.questions q where round_id=p_round),'[]') else '[]'::jsonb end,
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'question_id',s.question_id,'attempt',s.attempt,'submitted_at',s.submitted_at,'answer',s.answer)) from bughunt.submissions s join bughunt.questions q on q.id=s.question_id where s.team_id=t and q.round_id=p_round),'[]'),
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)) from bughunt.drafts d join bughunt.questions q on q.id=d.question_id where d.team_id=t and q.round_id=p_round),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c)-'bug_id'-'reviewed_by'-'note' order by c.submitted_at) from bughunt.claims c where c.team_id=t),'[]'),
 'clarifications',coalesce((select jsonb_agg(to_jsonb(c)-'answered_by' order by created_at desc) from bughunt.clarifications c where team_id=t),'[]'),
 'announcements',coalesce((select jsonb_agg(to_jsonb(a)-'created_by' order by created_at desc) from (select * from bughunt.announcements order by created_at desc limit 30) a),'[]'),
 'certificates',coalesce((select jsonb_agg(to_jsonb(c)) from bughunt.certificates c where team_id=t),'[]'));
end $$;

create function bughunt.validate_answer(q bughunt.questions,a jsonb) returns void language plpgsql security definer set search_path='' as $$
declare f jsonb; body text; begin
 if a is null or jsonb_typeof(a)<>'object' or octet_length(a::text)>32000 then raise exception 'Answer is too large or invalid'; end if;
 for f in select value from jsonb_array_elements(q.fields) loop
  if jsonb_typeof(a->(f->>'key'))<>'string' or length(btrim(coalesce(a->>(f->>'key'),'')))=0 then raise exception 'Complete every answer field'; end if;
 end loop;
 if q.kind='report' then
  body:=btrim(a->>'report');
  if cardinality(regexp_split_to_array(body,E'\\s+'))>150 then raise exception 'Incident reports have a 150-word limit'; end if;
 end if;
end $$;
create function bughunt.normalize(s text) returns text language sql immutable set search_path='' as $$
 select coalesce(string_agg(token[1],' '),'') from regexp_matches(lower(coalesce(s,'')), '[[:alnum:]_]+|[^[:alnum:]_[:space:]\[\],;"'']', 'g') as token;
$$;
create function public.bh_save_draft(p_question text,p_answer jsonb,p_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); q bughunt.questions; rev integer; begin
 select * into q from bughunt.questions where id=p_question; if q.id is null then raise exception 'Question not found'; end if;
 perform bughunt.assert_round(t,q.round_id);
 if jsonb_typeof(p_answer)<>'object' or octet_length(p_answer::text)>32000 then raise exception 'Invalid draft'; end if;
 insert into bughunt.drafts(team_id,question_id,answer,revision) values(t,p_question,p_answer,1)
 on conflict(team_id,question_id) do update set answer=excluded.answer,revision=bughunt.drafts.revision+1,updated_at=now() where bughunt.drafts.revision=p_revision
 returning revision into rev;
 if rev is null then raise exception 'Draft changed on another device. Reload before editing'; end if;
 return rev;
end $$;
create function public.bh_submit(p_question text,p_answer jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); q bughunt.questions; k bughunt.answer_keys; s bughunt.submissions; n integer; item jsonb; pts numeric:=0; v text; canonical boolean:=true; correct integer:=0; begin
 perform 1 from bughunt.teams where id=t for update;
 select * into s from bughunt.submissions where team_id=t and request_id=p_request;
 if found then return jsonb_build_object('id',s.id,'message','Submission recorded'); end if;
 perform bughunt.ensure_writable();
 select * into q from bughunt.questions where id=p_question; if q.id is null or q.kind='arena' then raise exception 'Invalid question'; end if;
 perform bughunt.assert_round(t,q.round_id); perform bughunt.validate_answer(q,p_answer);
 select count(*)+1 into n from bughunt.submissions where team_id=t and question_id=p_question;
 if n>q.max_attempts then raise exception 'No attempts remaining'; end if;
 select * into k from bughunt.answer_keys where question_id=p_question;
 if q.round_id=1 then
  for item in select value from jsonb_array_elements(k.accepted->'parts') loop
   v:=bughunt.normalize(p_answer->>(item->>'field'));
   if exists(select 1 from jsonb_array_elements_text(item->'values') x where bughunt.normalize(x)=v) then pts:=pts+(item->>'points')::numeric; correct:=correct+1;
   else canonical:=false; end if;
  end loop;
  if p_question='R1-Q5' then pts:=case when correct=3 then 10 when correct=2 then 5 else 0 end; end if;
  if p_question='R1-Q4' and not (bughunt.normalize(p_answer->>'a')='1' and bughunt.normalize(p_answer->>'a2')='1 2') then
   pts:=case when exists(select 1 from jsonb_array_elements(k.accepted->'parts') part, jsonb_array_elements_text(part->'values') v where part->>'field'='b' and bughunt.normalize(v)=bughunt.normalize(p_answer->>'b')) then 5 else 0 end;
  end if;
  if p_question='R1-Q9' and bughunt.normalize(p_answer->>'a')<>'1 2 3 4' then pts:=0; end if;
  if p_question='R1-Q10' and bughunt.normalize(p_answer->>'sequence') in ('a d f e c b','adfecb') then pts:=5; end if;
 elsif q.round_id in (2,3) then
  for item in select value from jsonb_array_elements(k.rubric) loop
   if exists(select 1 from jsonb_array_elements_text(coalesce(item->'keywords','[]')) word where lower(p_answer::text) like '%'||word||'%') then pts:=pts+(item->>'max')::numeric; end if;
  end loop;
 end if;
 insert into bughunt.submissions(team_id,question_id,request_id,attempt,answer,suggested_score,score,state)
 values(t,p_question,p_request,n,p_answer,pts,case when q.round_id=1 and canonical then pts else null end,case when q.round_id=1 and canonical then 'graded' else 'pending' end) returning * into s;
 perform bughunt.recalculate(t);
 return jsonb_build_object('id',s.id,'message','Submission recorded');
end $$;
create function public.bh_finish_round(p_round integer) returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); begin
 perform bughunt.assert_round(t,p_round);
 update bughunt.round_sessions set completed_at=now() where team_id=t and round_id=p_round and completed_at is null;
 if p_round=4 then update bughunt.teams set final_completed_at=now() where id=t and final_completed_at is null; end if;
end $$;
