-- Explicit, persistent testing mode. Official clocks and saved attempts stay intact.
alter table bughunt.event add column unlimited_testing boolean not null default false;
create table bughunt.testing_sessions (
 team_id uuid not null references bughunt.teams(id),
 round_id integer not null references bughunt.rounds(id),
 started_at timestamptz not null default now(),
 primary key(team_id,round_id)
);
alter table bughunt.testing_sessions enable row level security;
create policy testing_sessions_private on bughunt.testing_sessions for all using (false) with check (false);
revoke all on bughunt.testing_sessions from public,anon,authenticated,service_role;

alter function bughunt.online_window() rename to online_window_competition;
create function bughunt.online_window() returns jsonb language sql volatile security definer set search_path='' as $$
 select case when unlimited_testing then bughunt.online_window_competition()||jsonb_build_object(
 'enabled',false,'testing',true,'phase','testing','starts_at',null,'entry_closes_at',null,'ends_at',null)
 else bughunt.online_window_competition() end from bughunt.event where id;
$$;
alter function bughunt.online_rounds(jsonb) rename to online_rounds_competition;
create function bughunt.online_rounds(value jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select case when (select unlimited_testing from bughunt.event where id) then
 coalesce((select jsonb_agg(r||jsonb_build_object('status','open','paused_at',null) order by (r->>'id')::integer) from jsonb_array_elements(value) r),'[]'::jsonb)
 else bughunt.online_rounds_competition(value) end;
$$;

alter function bughunt.bh_start_round(integer) rename to bh_start_round_competition;
create function bughunt.bh_start_round(p_round integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; s bughunt.testing_sessions; begin
 if not (select unlimited_testing from bughunt.event where id) then return bughunt.bh_start_round_competition(p_round); end if;
 t:=bughunt.require_team();
 perform 1 from bughunt.teams where id=t for update;
 perform bughunt.ensure_writable();
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 if p_round not between 1 and 4 or p_round is null then raise exception 'Invalid round'; end if;
 if not exists(select 1 from bughunt.questions where round_id=p_round) then raise exception 'Question bank is not ready'; end if;
 insert into bughunt.testing_sessions(team_id,round_id) values(t,p_round) on conflict do nothing;
 select * into s from bughunt.testing_sessions where team_id=t and round_id=p_round;
 return to_jsonb(s)||jsonb_build_object('ends_at',null,'completed_at',null,'server_time',now(),'testing',true);
end $$;

alter function bughunt.assert_round(uuid,integer) rename to assert_round_competition;
create function bughunt.assert_round(t uuid,r integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not (select unlimited_testing from bughunt.event where id) then perform bughunt.assert_round_competition(t,r); return; end if;
 perform bughunt.ensure_writable();
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Team is not approved'; end if;
 if not exists(select 1 from bughunt.testing_sessions where team_id=t and round_id=r) then raise exception 'Enter this test first'; end if;
end $$;

alter function bughunt.bh_team_state(integer) rename to bh_team_state_competition;
create function bughunt.bh_team_state(p_round integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; r bughunt.rounds; sess bughunt.testing_sessions; can_read boolean; begin
 if not (select unlimited_testing from bughunt.event where id) then return bughunt.bh_team_state_competition(p_round); end if;
 t:=bughunt.require_team();
 select * into r from bughunt.rounds where id=p_round;
 select * into sess from bughunt.testing_sessions where team_id=t and round_id=p_round;
 can_read:=sess.team_id is not null and exists(select 1 from bughunt.teams where id=t and status='approved');
 return jsonb_build_object('server_time',now(),'testing',true,'self_progression',false,'online_entered',false,'online',bughunt.online_window(),
 'round',to_jsonb(r)||jsonb_build_object('status','open','paused_at',null),
 'session',case when sess.team_id is null then null else to_jsonb(sess)||jsonb_build_object('ends_at',null,'completed_at',null,'testing',true) end,
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)) from bughunt.qualifications q where team_id=t),'[]'),
 'questions',case when can_read then coalesce((select jsonb_agg(to_jsonb(q) order by case when p_round=1 then md5(t::text||q.id) else lpad(q.ordinal::text,3,'0') end) from bughunt.questions q where round_id=p_round),'[]') else '[]'::jsonb end,
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'question_id',s.question_id,'attempt',s.attempt,'submitted_at',s.submitted_at,'answer',s.answer)) from bughunt.submissions s join bughunt.questions q on q.id=s.question_id where s.team_id=t and q.round_id=p_round),'[]'),
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)) from bughunt.drafts d join bughunt.questions q on q.id=d.question_id where d.team_id=t and q.round_id=p_round),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c)-'bug_id'-'reviewed_by'-'note' order by c.submitted_at) from bughunt.claims c where c.team_id=t),'[]'),
 'clarifications',coalesce((select jsonb_agg(to_jsonb(c)-'answered_by' order by created_at desc) from bughunt.clarifications c where team_id=t),'[]'),
 'announcements',coalesce((select jsonb_agg(to_jsonb(a)-'created_by' order by created_at desc) from (select * from bughunt.announcements order by created_at desc limit 30) a),'[]'),
 'certificates',coalesce((select jsonb_agg(to_jsonb(c)) from bughunt.certificates c where team_id=t),'[]'));
end $$;

alter function bughunt.bh_finish_round(integer) rename to bh_finish_round_competition;
create function bughunt.bh_finish_round(p_round integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not (select unlimited_testing from bughunt.event where id) then perform bughunt.bh_finish_round_competition(p_round); return; end if;
 perform bughunt.assert_round(bughunt.require_team(),p_round);
 -- Leaving a test does not finish the official round or reset submitted answers.
end $$;

alter function bughunt.bh_activity(integer,text,uuid) rename to bh_activity_competition;
create function bughunt.bh_activity(p_round integer,p_kind text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select unlimited_testing from bughunt.event where id) then return bughunt.bh_activity_manual(p_round,p_kind,p_request); end if;
 return bughunt.bh_activity_competition(p_round,p_kind,p_request);
end $$;

-- Helpers are callable only through the existing authenticated, budgeted public RPCs.
revoke all on all functions in schema bughunt from public,anon,authenticated,service_role;
