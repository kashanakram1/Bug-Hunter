-- Open portal access retains the real per-team and per-round clocks.
alter table bughunt.testing_sessions add column ends_at timestamptz;
alter table bughunt.testing_sessions add column completed_at timestamptz;
-- Previously untimed entries receive a fresh real clock; saved answers stay intact.
update bughunt.testing_sessions s set started_at=now(),ends_at=now()+make_interval(secs=>r.duration_seconds)
from bughunt.rounds r where r.id=s.round_id;
alter table bughunt.testing_sessions alter column ends_at set not null;

create function bughunt.testing_deadline(t uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select min(started_at)+interval '80 minutes' from bughunt.testing_sessions where team_id=t and round_id<=3;
$$;
create or replace function bughunt.online_window() returns jsonb language sql volatile security definer set search_path='' as $$
 select case when unlimited_testing then bughunt.online_window_competition()||jsonb_build_object(
 'enabled',false,'access_override',true,'phase','open','starts_at',null,'entry_closes_at',null,'ends_at',null)
 else bughunt.online_window_competition() end from bughunt.event where id;
$$;
create or replace function bughunt.bh_start_round(p_round integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; s bughunt.testing_sessions; deadline timestamptz; begin
 if not (select unlimited_testing from bughunt.event where id) then return bughunt.bh_start_round_competition(p_round); end if;
 t:=bughunt.require_team();
 perform 1 from bughunt.teams where id=t for update;
 perform bughunt.ensure_writable();
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 if p_round not between 1 and 4 or p_round is null then raise exception 'Invalid round'; end if;
 if not exists(select 1 from bughunt.questions where round_id=p_round) then raise exception 'Question bank is not ready'; end if;
 deadline:=case when p_round<=3 then coalesce(bughunt.testing_deadline(t),now()+interval '80 minutes') else 'infinity'::timestamptz end;
 if clock_timestamp()>=deadline then raise exception 'Your 80-minute competition time has ended'; end if;
 insert into bughunt.testing_sessions(team_id,round_id,ends_at)
 select t,p_round,least(now()+make_interval(secs=>duration_seconds),deadline) from bughunt.rounds where id=p_round on conflict do nothing;
 select * into s from bughunt.testing_sessions where team_id=t and round_id=p_round;
 return to_jsonb(s)||jsonb_build_object('server_time',now());
end $$;
create or replace function bughunt.assert_round(t uuid,r integer) returns void language plpgsql security definer set search_path='' as $$
declare s bughunt.testing_sessions; deadline timestamptz; begin
 if not (select unlimited_testing from bughunt.event where id) then perform bughunt.assert_round_competition(t,r); return; end if;
 perform bughunt.ensure_writable();
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Team is not approved'; end if;
 select * into s from bughunt.testing_sessions where team_id=t and round_id=r;
 deadline:=case when r<=3 then least(s.ends_at,bughunt.testing_deadline(t)) else s.ends_at end;
 if s.team_id is null or s.completed_at is not null or clock_timestamp()>=deadline then raise exception 'Round time has ended or has not started'; end if;
end $$;
create or replace function bughunt.bh_team_state(p_round integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; r bughunt.rounds; sess bughunt.testing_sessions; can_read boolean; begin
 if not (select unlimited_testing from bughunt.event where id) then return bughunt.bh_team_state_competition(p_round); end if;
 t:=bughunt.require_team();
 select * into r from bughunt.rounds where id=p_round;
 select * into sess from bughunt.testing_sessions where team_id=t and round_id=p_round;
 can_read:=sess.team_id is not null and exists(select 1 from bughunt.teams where id=t and status='approved');
 return jsonb_build_object('server_time',now(),'access_override',true,'self_progression',false,'online_entered',false,'online',bughunt.online_window(),'team_ends_at',bughunt.testing_deadline(t),
 'round',to_jsonb(r)||jsonb_build_object('status','open','paused_at',null),
 'session',case when sess.team_id is null then null else to_jsonb(sess)||jsonb_build_object('ends_at',case when p_round<=3 then least(sess.ends_at,bughunt.testing_deadline(t)) else sess.ends_at end) end,
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)) from bughunt.qualifications q where team_id=t),'[]'),
 'questions',case when can_read then coalesce((select jsonb_agg(to_jsonb(q) order by case when p_round=1 then md5(t::text||q.id) else lpad(q.ordinal::text,3,'0') end) from bughunt.questions q where round_id=p_round),'[]') else '[]'::jsonb end,
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'question_id',s.question_id,'attempt',s.attempt,'submitted_at',s.submitted_at,'answer',s.answer)) from bughunt.submissions s join bughunt.questions q on q.id=s.question_id where s.team_id=t and q.round_id=p_round),'[]'),
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)) from bughunt.drafts d join bughunt.questions q on q.id=d.question_id where d.team_id=t and q.round_id=p_round),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c)-'bug_id'-'reviewed_by'-'note' order by c.submitted_at) from bughunt.claims c where c.team_id=t),'[]'),
 'clarifications',coalesce((select jsonb_agg(to_jsonb(c)-'answered_by' order by created_at desc) from bughunt.clarifications c where team_id=t),'[]'),
 'announcements',coalesce((select jsonb_agg(to_jsonb(a)-'created_by' order by created_at desc) from (select * from bughunt.announcements order by created_at desc limit 30) a),'[]'),
 'certificates',coalesce((select jsonb_agg(to_jsonb(c)) from bughunt.certificates c where team_id=t),'[]'));
end $$;


create or replace function bughunt.bh_finish_round(p_round integer) returns void language plpgsql security definer set search_path='' as $$
declare t uuid; begin
 if not (select unlimited_testing from bughunt.event where id) then perform bughunt.bh_finish_round_competition(p_round); return; end if;
 t:=bughunt.require_team();
 perform 1 from bughunt.teams where id=t for update;
 if exists(select 1 from bughunt.testing_sessions where team_id=t and round_id=p_round and completed_at is not null) then return; end if;
 perform bughunt.assert_round(t,p_round);
 update bughunt.testing_sessions set completed_at=now() where team_id=t and round_id=p_round;
end $$;
alter function bughunt.bh_public_state() rename to bh_public_state_before_timed_access;
create function bughunt.bh_public_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare value jsonb:=bughunt.bh_public_state_before_timed_access(); begin
 if not (select unlimited_testing from bughunt.event where id) then return value; end if;
 return value||jsonb_build_object(
 'countdown',(select max(case when s.round_id<=3 then least(s.ends_at,bughunt.testing_deadline(s.team_id)) else s.ends_at end)
   from bughunt.testing_sessions s where s.completed_at is null and s.ends_at>clock_timestamp()
   and (s.round_id=4 or bughunt.testing_deadline(s.team_id)>clock_timestamp())),
 'active_teams',(select count(distinct team_id) from bughunt.login_leases where expires_at>now()));
end $$;
revoke all on all functions in schema bughunt from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
