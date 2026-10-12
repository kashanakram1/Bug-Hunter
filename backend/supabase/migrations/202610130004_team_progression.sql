-- Local draft: progression belongs to the team, independently of global round status.
alter table bughunt.event add column self_progression boolean not null default true;
create function bughunt.progress_team(t uuid) returns integer language plpgsql security definer set search_path='' as $$
declare s bughunt.round_sessions; begin
 perform 1 from bughunt.teams where id=t for update;
 loop
  select * into s from bughunt.round_sessions where team_id=t and round_id<=3 order by round_id desc limit 1 for update;
  if not found or s.completed_at is not null then return null; end if;
  if clock_timestamp()<s.ends_at then return s.round_id; end if;
  update bughunt.round_sessions set completed_at=s.ends_at where team_id=t and round_id=s.round_id;
  if s.round_id=3 then return null; end if;
  insert into bughunt.round_sessions(team_id,round_id,started_at,ends_at)
  select t,s.round_id+1,s.ends_at,s.ends_at+make_interval(secs=>duration_seconds) from bughunt.rounds where id=s.round_id+1 on conflict do nothing;
 end loop;
end $$;
alter function bughunt.bh_start_round_manual(integer) rename to bh_start_round_legacy;
create function bughunt.bh_start_round_manual(p_round integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); active integer; last_round integer; s bughunt.round_sessions; begin
 if p_round=4 or not (select self_progression from bughunt.event where id) then return bughunt.bh_start_round_legacy(p_round); end if;
 perform bughunt.ensure_writable();
 perform 1 from bughunt.teams where id=t for update;
 if p_round not between 1 and 3 or not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 select max(round_id) into last_round from bughunt.round_sessions where team_id=t and round_id<=3;
 if last_round is null then
  if p_round<>1 then raise exception 'Start with Round 1'; end if;
  if not exists(select 1 from bughunt.rounds where id=1 and status='open') then raise exception 'Competition is not open'; end if;
 else
  active:=bughunt.progress_team(t);
  select max(round_id) into last_round from bughunt.round_sessions where team_id=t and round_id<=3;
  if p_round=active then select * into s from bughunt.round_sessions where team_id=t and round_id=p_round; return to_jsonb(s)||jsonb_build_object('server_time',now()); end if;
  if p_round<>last_round+1 then raise exception 'This round is locked; move to the next round in order'; end if;
 end if;
 if not exists(select 1 from bughunt.questions where round_id=p_round) then raise exception 'Round questions are not ready'; end if;
 update bughunt.round_sessions set completed_at=coalesce(completed_at,clock_timestamp()) where team_id=t and round_id<p_round and completed_at is null;
 insert into bughunt.round_sessions(team_id,round_id,started_at,ends_at) select t,p_round,now(),now()+make_interval(secs=>duration_seconds) from bughunt.rounds where id=p_round;
 select * into s from bughunt.round_sessions where team_id=t and round_id=p_round;
 return to_jsonb(s)||jsonb_build_object('server_time',now());
end $$;
alter function bughunt.assert_round_manual(uuid,integer) rename to assert_round_legacy;
create function bughunt.assert_round_manual(t uuid,r integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if r=4 or not (select self_progression from bughunt.event where id) then perform bughunt.assert_round_legacy(t,r); return; end if;
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Team is not approved'; end if;
 if bughunt.progress_team(t) is distinct from r then raise exception 'This round is locked; continue with your current round'; end if;
end $$;
alter function bughunt.bh_finish_round_manual(integer) rename to bh_finish_round_legacy;
create function bughunt.bh_finish_round_manual(p_round integer) returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); active integer; begin
 if p_round=4 or not (select self_progression from bughunt.event where id) then perform bughunt.bh_finish_round_legacy(p_round); return; end if;
 perform bughunt.ensure_writable();
 perform 1 from bughunt.teams where id=t for update;
 if exists(select 1 from bughunt.round_sessions where team_id=t and round_id=p_round and completed_at is not null) then return; end if;
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 active:=bughunt.progress_team(t);
 if active is distinct from p_round then raise exception 'This round is locked'; end if;
 if p_round<3 then perform bughunt.bh_start_round_manual(p_round+1);
 else update bughunt.round_sessions set completed_at=now() where team_id=t and round_id=p_round; end if;
end $$;
-- Decorate manual preview state with the same team-owned progression contract as scheduled mode.
alter function bughunt.bh_team_state(integer) rename to bh_team_state_scheduled;
create function bughunt.bh_team_state(p_round integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); active integer; v jsonb; begin
 if (select online_enabled or not self_progression from bughunt.event where id) then return bughunt.bh_team_state_scheduled(p_round); end if;
 active:=bughunt.progress_team(t);
 v:=bughunt.bh_team_state_scheduled(p_round);
 if p_round<=3 then
  v:=v||jsonb_build_object('round',(v->'round')||jsonb_build_object('status',case when active=p_round then 'open' else 'closed' end,'paused_at',null),
   'questions',case when active=p_round and exists(select 1 from bughunt.teams where id=t and status='approved') then coalesce((select jsonb_agg(to_jsonb(q) order by ordinal) from bughunt.questions q where round_id=p_round),'[]') else '[]'::jsonb end,
   'submissions',case when active=p_round then v->'submissions' else '[]'::jsonb end,'drafts',case when active=p_round then v->'drafts' else '[]'::jsonb end);
 end if;
 return v||jsonb_build_object('self_progression',true,'active_round',active,'online_entered',exists(select 1 from bughunt.round_sessions where team_id=t and round_id=1));
end $$;
create or replace function bughunt.bh_admin_manual(p_action text,p_payload jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_staff(true); t uuid; r integer; old jsonb; row_round bughunt.rounds; secs integer; team_count integer; take_count integer; target_status text; begin
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 or octet_length(p_payload::text)>10000 then raise exception 'A reason (3–1000 characters) is required'; end if;
 perform pg_advisory_xact_lock(2026,9001);
 if p_action not in ('announcement','reply','sessions','settings') then perform bughunt.ensure_writable(); end if;
 if p_action='team_status' then
  t:=(p_payload->>'team_id')::uuid; target_status:=p_payload->>'status';
  if target_status not in ('approved','rejected','disqualified','pending') then raise exception 'Invalid team status'; end if;
  select to_jsonb(x) into old from bughunt.teams x where id=t for update;
  if old is null then raise exception 'Team not found'; end if;
  update bughunt.teams set status=target_status where id=t;
 elsif p_action='sessions' then
  t:=(p_payload->>'team_id')::uuid;
  select to_jsonb(x) into old from bughunt.teams x where id=t for update;
  if old is null then raise exception 'Team not found'; end if;
  update bughunt.teams set session_limit=coalesce((p_payload->>'limit')::integer,session_limit) where id=t;
  if coalesce((p_payload->>'release')::boolean,false) then update bughunt.login_leases set expires_at=now() where team_id=t; end if;
 elsif p_action='round' then
  r:=(p_payload->>'round')::integer; target_status:=p_payload->>'status';
  select * into row_round from bughunt.rounds where id=r for update; old:=to_jsonb(row_round);
  if row_round.id is null or target_status not in ('open','paused','closed') then raise exception 'Invalid round action'; end if;
  if target_status='paused' and row_round.status<>'open' then raise exception 'Only an open round can pause'; end if;
  if target_status='open' then
   if r=4 and not exists(select 1 from bughunt.qualifications where round_id=4 and qualified) then raise exception 'Publish final qualification first'; end if;
   if not exists(select 1 from bughunt.questions where round_id=r) then raise exception 'Load the official question bank before opening'; end if;
   if row_round.status='paused' then
    update bughunt.round_sessions set ends_at=ends_at+(now()-row_round.paused_at) where round_id=r and completed_at is null and ends_at>row_round.paused_at;
   elsif row_round.status='closed' then
    secs:=coalesce((p_payload->>'seconds')::integer,0);
    if secs not between 60 and 7200 then raise exception 'Reopening needs 60–7200 seconds of additional time'; end if;
    update bughunt.round_sessions set ends_at=greatest(ends_at,now())+make_interval(secs=>secs) where round_id=r and completed_at is null;
   end if;
  end if;
  update bughunt.rounds set status=target_status,paused_at=case when target_status='paused' then now() else null end,opened_at=case when target_status='open' then coalesce(opened_at,now()) else opened_at end,closed_at=case when target_status='closed' then now() else null end where id=r;
  if r=4 and target_status='open' then update bughunt.event set leaderboard_visible=true where id; end if;
 elsif p_action='pause_all' then
  select jsonb_agg(to_jsonb(x)) into old from bughunt.rounds x;
  update bughunt.rounds set status='paused',paused_at=now() where status='open';
 elsif p_action='extend' then
  r:=(p_payload->>'round')::integer; t:=nullif(p_payload->>'team_id','')::uuid; secs:=(p_payload->>'seconds')::integer;
  perform 1 from bughunt.rounds where id=r for update;
  if secs is null or secs not between 1 and 7200 then raise exception 'Extension must be 1–7200 seconds'; end if;
  select jsonb_agg(to_jsonb(x)) into old from bughunt.round_sessions x where round_id=r and (t is null or team_id=t);
  update bughunt.round_sessions set ends_at=ends_at+make_interval(secs=>secs) where round_id=r and completed_at is null and (t is null or team_id=t);
 elsif p_action='qualify' then
  r:=(p_payload->>'round')::integer;
  if r not between 2 and 4 or exists(select 1 from bughunt.rounds where id<r and status<>'closed') then raise exception 'Close preceding rounds before qualification'; end if;
  if exists(select 1 from bughunt.round_sessions where round_id=r) then raise exception 'Qualification is frozen once teams start the round'; end if;
  if exists(select 1 from bughunt.submissions s join bughunt.questions q on q.id=s.question_id where q.round_id<r and s.state='pending') then raise exception 'Finish earlier judging before qualification'; end if;
  select count(*) into team_count from bughunt.teams where status='approved';
  take_count:=case when r=2 then team_count when r=3 then ceil(0.75*(select count(*) from bughunt.round_sessions s join bughunt.teams t on t.id=s.team_id where s.round_id=r-1 and t.status='approved'))::integer else case when team_count<=20 then 8 else 10 end end;
  take_count:=coalesce((p_payload->>'count')::integer,take_count);
  if take_count not between 1 and 10000 then raise exception 'Invalid qualifier count'; end if;
  update bughunt.qualifications set qualified=false where round_id=r;
  insert into bughunt.qualifications(team_id,round_id,qualified)
  select t.id,r,true from bughunt.teams t where t.status='approved' and exists(select 1 from bughunt.round_sessions where team_id=t.id and round_id=r-1)
  order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,t.id limit take_count
  on conflict(team_id,round_id) do update set qualified=true;
 elsif p_action='adjust' then
  t:=(p_payload->>'team_id')::uuid;
  perform 1 from bughunt.teams where id=t for update;
  insert into bughunt.adjustments(team_id,amount,reason,source,actor) values(t,(p_payload->>'amount')::numeric,p_reason,'manual:'||(p_payload->>'request_id')::uuid,u) on conflict(team_id,source) do nothing;
  perform bughunt.recalculate(t);
 elsif p_action='announcement' then
  insert into bughunt.announcements(message,created_by) values(p_payload->>'message',u);
 elsif p_action='reply' then
  if length(btrim(coalesce(p_payload->>'answer',''))) not between 1 and 2000 then raise exception 'Reply must be 1–2000 characters'; end if;
  select to_jsonb(x) into old from bughunt.clarifications x where id=(p_payload->>'id')::uuid;
  update bughunt.clarifications set answer=p_payload->>'answer',answered_by=u,answered_at=now() where id=(p_payload->>'id')::uuid;
  if not found then raise exception 'Clarification not found'; end if;
  if coalesce((p_payload->>'broadcast')::boolean,false) then insert into bughunt.announcements(message,created_by) values(p_payload->>'answer',u); end if;
 elsif p_action='settings' then
  select to_jsonb(x) into old from bughunt.event x where id;
  update bughunt.event set leaderboard_visible=coalesce((p_payload->>'leaderboard_visible')::boolean,leaderboard_visible),registration_open=coalesce((p_payload->>'registration_open')::boolean,registration_open),updated_at=now() where id;
 elsif p_action='finalize' then
  if exists(select 1 from bughunt.rounds where status<>'closed') or exists(select 1 from bughunt.submissions where state='pending') or exists(select 1 from bughunt.claims where state='pending') then raise exception 'Close all rounds and complete all judging first'; end if;
  update bughunt.event set results_released=true,leaderboard_visible=true,finalized_at=now() where id;
  insert into bughunt.certificates(team_id,team_name,award,event_name)
  select t.id,t.name,'Participation',e.name from bughunt.teams t cross join bughunt.event e where t.status='approved' on conflict do nothing;
  insert into bughunt.certificates(team_id,team_name,award,event_name)
  select t.id,t.name,'Finalist',e.name from bughunt.teams t cross join bughunt.event e where t.status='approved' and exists(select 1 from bughunt.qualifications q where q.team_id=t.id and q.round_id=4 and q.qualified) on conflict do nothing;
  insert into bughunt.certificates(team_id,team_name,award,event_name)
  select x.id,x.name,'Place '||x.rank,e.name from (select id,name,row_number() over(order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,id) rank from bughunt.teams where status='approved') x cross join bughunt.event e where rank<=3 on conflict do nothing;
  insert into bughunt.certificates(team_id,team_name,award,event_name)
  select t.id,t.name,'Fastest Fixer',e.name from bughunt.first_blood f join bughunt.teams t on t.id=f.team_id cross join bughunt.event e where t.status='approved' order by f.awarded_at,t.id limit 1 on conflict do nothing;
  insert into bughunt.certificates(team_id,team_name,award,event_name)
  select t.id,t.name,'Best Newcomer Team',e.name from bughunt.teams t cross join bughunt.event e where t.status='approved' and t.newcomer order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,t.id limit 1 on conflict do nothing;
  insert into bughunt.certificates(team_id,team_name,award,event_name)
  select t.id,t.name,'Best Incident Report',e.name from bughunt.submissions s join bughunt.teams t on t.id=s.team_id cross join bughunt.event e where s.question_id='R4-REPORT' and s.state='graded' and s.score>0 and t.status='approved' order by s.score desc,s.submitted_at,t.id limit 1 on conflict do nothing;
 else raise exception 'Unknown action'; end if;
 perform bughunt.audit_write(p_action,coalesce(t::text,r::text,'event'),old,p_payload,p_reason);
 return jsonb_build_object('ok',true);
end $$;

revoke all on function bughunt.progress_team(uuid),bughunt.bh_start_round_manual(integer),bughunt.bh_start_round_legacy(integer),bughunt.assert_round_manual(uuid,integer),bughunt.assert_round_legacy(uuid,integer),bughunt.bh_finish_round_manual(integer),bughunt.bh_finish_round_legacy(integer),bughunt.bh_team_state(integer),bughunt.bh_team_state_scheduled(integer),bughunt.bh_admin_manual(text,jsonb,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
