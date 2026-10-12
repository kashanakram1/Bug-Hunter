-- Local draft: do not apply to the live database before organizer approval.
alter table bughunt.event add column event_timezone text not null default 'Asia/Karachi';
alter table bughunt.event add column onsite_date date;
alter table bughunt.event add column online_enabled boolean not null default false;
alter table bughunt.event add column online_starts_at timestamptz;
alter table bughunt.event add column online_entry_closes_at timestamptz;
alter table bughunt.event add column online_ends_at timestamptz;
alter table bughunt.event add constraint online_window_valid check (
 not online_enabled or (online_starts_at is not null and online_entry_closes_at is not null and online_ends_at is not null
 and online_entry_closes_at=online_starts_at+interval '20 minutes' and online_ends_at=online_starts_at+interval '100 minutes'));

create function bughunt.online_window() returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('enabled',online_enabled,'timezone',event_timezone,'onsite_date',onsite_date,'starts_at',online_starts_at,'entry_closes_at',online_entry_closes_at,'ends_at',online_ends_at,
 'phase',case when not online_enabled then 'manual' when clock_timestamp()<online_starts_at then 'scheduled' when clock_timestamp()>=online_ends_at then 'closed' when clock_timestamp()>=online_entry_closes_at then 'entry_closed' else 'entry_open' end)
 from bughunt.event where id;
$$;
create function bughunt.online_rounds(value jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when (r->>'id')::integer<=3 and (select online_enabled from bughunt.event where id)
 then r||jsonb_build_object('status',case when clock_timestamp()<(select online_starts_at from bughunt.event where id) then 'draft' when clock_timestamp()>=(select online_ends_at from bughunt.event where id) then 'closed' else 'open' end,'paused_at',null) else r end order by (r->>'id')::integer),'[]'::jsonb)
 from jsonb_array_elements(value) r;
$$;
-- Serialize transitions with submissions, preventing an answer racing a round lock.
create function bughunt.sync_online(t uuid) returns integer language plpgsql security definer set search_path='' as $$
declare s bughunt.round_sessions; deadline timestamptz; begin
 perform 1 from bughunt.teams where id=t for update;
 select least(e.online_ends_at,initial.started_at+interval '80 minutes') into deadline from bughunt.event e join bughunt.round_sessions initial on initial.team_id=t and initial.round_id=1 where e.id;
 loop
  select * into s from bughunt.round_sessions where team_id=t and round_id<=3 and completed_at is null order by round_id limit 1 for update;
  if not found then return null; end if;
  if clock_timestamp()<least(s.ends_at,deadline) then return s.round_id; end if;
  update bughunt.round_sessions set completed_at=least(s.ends_at,deadline),ends_at=least(ends_at,deadline) where team_id=t and round_id=s.round_id;
  if s.round_id<3 and s.ends_at<deadline then
   insert into bughunt.round_sessions(team_id,round_id,started_at,ends_at)
   select t,s.round_id+1,s.ends_at,least(s.ends_at+make_interval(secs=>duration_seconds),deadline) from bughunt.rounds where id=s.round_id+1
   on conflict do nothing;
  end if;
 end loop;
end $$;

-- Keep the original manual final and historical mode available.
alter function bughunt.assert_round(uuid,integer) rename to assert_round_manual;
create function bughunt.assert_round(t uuid,r integer) returns void language plpgsql security definer set search_path='' as $$
declare active integer; e bughunt.event; begin
 select * into e from bughunt.event where id;
 if e.online_enabled and r=4 and (e.onsite_date is null or (clock_timestamp() at time zone e.event_timezone)::date<>e.onsite_date) then raise exception 'The final is available only on its scheduled on-site date'; end if;
 if not e.online_enabled or r=4 then perform bughunt.assert_round_manual(t,r); return; end if;
 if r not between 1 and 3 or clock_timestamp()<e.online_starts_at or clock_timestamp()>=e.online_ends_at then raise exception 'Online competition is outside its scheduled window'; end if;
 active:=bughunt.sync_online(t);
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Team is not approved'; end if;
 if active is distinct from r then raise exception 'This round is locked; continue with your current round'; end if;
end $$;

alter function bughunt.bh_start_round(integer) rename to bh_start_round_manual;
create function bughunt.bh_start_round(p_round integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); e bughunt.event; active integer; s bughunt.round_sessions; begin
 select * into e from bughunt.event where id;
 if e.online_enabled and p_round=4 and (e.onsite_date is null or (clock_timestamp() at time zone e.event_timezone)::date<>e.onsite_date) then raise exception 'The final is available only on its scheduled on-site date'; end if;
 if e.online_enabled and p_round=4 and clock_timestamp()<e.online_ends_at then raise exception 'The online competition must end before the final starts'; end if;
 if not e.online_enabled or p_round=4 then return bughunt.bh_start_round_manual(p_round); end if;
 perform 1 from bughunt.teams where id=t for update;
 if p_round not between 1 and 3 or clock_timestamp()<e.online_starts_at or clock_timestamp()>=e.online_ends_at then raise exception 'Online competition is outside its scheduled window'; end if;
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 if not exists(select 1 from bughunt.round_sessions where team_id=t and round_id=1) then
  if clock_timestamp()>=e.online_entry_closes_at then raise exception 'The competition entry window has closed'; end if;
  if p_round<>1 then raise exception 'Start with Round 1'; end if;
  if (select count(distinct round_id) from bughunt.questions where round_id<=3)<>3 then raise exception 'The online question bank is not ready'; end if;
  insert into bughunt.round_sessions(team_id,round_id,ends_at) select t,1,least(now()+make_interval(secs=>duration_seconds),e.online_ends_at) from bughunt.rounds where id=1;
 end if;
 active:=bughunt.sync_online(t);
 if p_round=active+1 then
  update bughunt.round_sessions set completed_at=now() where team_id=t and round_id=active;
  insert into bughunt.round_sessions(team_id,round_id,ends_at) select t,p_round,least(now()+make_interval(secs=>duration_seconds),(select started_at+interval '80 minutes' from bughunt.round_sessions where team_id=t and round_id=1),e.online_ends_at) from bughunt.rounds where id=p_round on conflict do nothing;
  active:=p_round;
 end if;
 if active is distinct from p_round then raise exception 'This round is locked; continue with your current round'; end if;
 select * into s from bughunt.round_sessions where team_id=t and round_id=p_round;
 return to_jsonb(s)||jsonb_build_object('server_time',now());
end $$;

alter function bughunt.bh_finish_round(integer) rename to bh_finish_round_manual;
create function bughunt.bh_finish_round(p_round integer) returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); e bughunt.event; active integer; begin
 select * into e from bughunt.event where id;
 if not e.online_enabled or p_round=4 then perform bughunt.bh_finish_round_manual(p_round); return; end if;
 perform 1 from bughunt.teams where id=t for update;
 active:=bughunt.sync_online(t);
 -- A lost response can safely retry a transition without consuming the next round.
 if exists(select 1 from bughunt.round_sessions where team_id=t and round_id=p_round and completed_at is not null) then return; end if;
 perform bughunt.assert_round(t,p_round);
 update bughunt.round_sessions set completed_at=now() where team_id=t and round_id=p_round;
 if p_round<3 then
  insert into bughunt.round_sessions(team_id,round_id,ends_at) select t,p_round+1,least(now()+make_interval(secs=>duration_seconds),(select started_at+interval '80 minutes' from bughunt.round_sessions where team_id=t and round_id=1),e.online_ends_at) from bughunt.rounds where id=p_round+1 on conflict do nothing;
 end if;
end $$;

alter function bughunt.bh_team_state(integer) rename to bh_team_state_manual;
create function bughunt.bh_team_state(p_round integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); active integer; value jsonb; readable boolean; begin
 if not (select online_enabled from bughunt.event where id) then return bughunt.bh_team_state_manual(p_round); end if;
 active:=bughunt.sync_online(t);
 value:=bughunt.bh_team_state_manual(p_round);
 if p_round<=3 then
  readable:=active=p_round and clock_timestamp()>=(select online_starts_at from bughunt.event where id) and clock_timestamp()<(select online_ends_at from bughunt.event where id) and exists(select 1 from bughunt.teams where id=t and status='approved');
  value:=value||jsonb_build_object('round',(bughunt.online_rounds(jsonb_build_array(value->'round')))->0,
   'questions',case when readable then coalesce((select jsonb_agg(to_jsonb(q) order by case when p_round=1 then md5(t::text||q.id) else lpad(q.ordinal::text,3,'0') end) from bughunt.questions q where round_id=p_round),'[]') else '[]'::jsonb end,
   'submissions',case when readable then value->'submissions' else '[]'::jsonb end,'drafts',case when readable then value->'drafts' else '[]'::jsonb end);
 end if;
 if p_round=4 and (not exists(select 1 from bughunt.qualifications where team_id=t and round_id=4 and qualified) or (clock_timestamp() at time zone (select event_timezone from bughunt.event where id))::date is distinct from (select onsite_date from bughunt.event where id)) then
  value:=value||jsonb_build_object('questions','[]'::jsonb,'submissions','[]'::jsonb,'drafts','[]'::jsonb,'claims','[]'::jsonb);
 end if;
 return value||jsonb_build_object('online',bughunt.online_window(),'active_round',active,'online_entered',exists(select 1 from bughunt.round_sessions where team_id=t and round_id=1),
 'team_ends_at',(select started_at+interval '80 minutes' from bughunt.round_sessions where team_id=t and round_id=1),
 'online_sessions',coalesce((select jsonb_agg(to_jsonb(s) order by round_id) from bughunt.round_sessions s where team_id=t and round_id<=3),'[]'::jsonb),
 'tab_count',coalesce((select count(*) from bughunt.activity where team_id=t and kind='tab'),0));
end $$;

alter function bughunt.bh_bootstrap() rename to bh_bootstrap_manual;
create function bughunt.bh_bootstrap() returns jsonb language sql security definer set search_path='' as $$
 select v||jsonb_build_object('rounds',bughunt.online_rounds(v->'rounds'),'online',bughunt.online_window()) from (select bughunt.bh_bootstrap_manual() v) x;
$$;
alter function bughunt.bh_public_state() rename to bh_public_state_manual;
create function bughunt.bh_public_state() returns jsonb language sql security definer set search_path='' as $$
 select v||jsonb_build_object('rounds',bughunt.online_rounds(v->'rounds'),'online',bughunt.online_window()) from (select bughunt.bh_public_state_manual() v) x;
$$;
alter function bughunt.bh_staff_data(text,integer) rename to bh_staff_data_manual;
create function bughunt.bh_staff_data(p_tab text default 'overview',p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb:=bughunt.bh_staff_data_manual(p_tab,p_offset); begin
 if p_tab='overview' then return v||jsonb_build_object('rounds',bughunt.online_rounds(v->'rounds'),'online',bughunt.online_window()); end if; return v;
end $$;
alter function bughunt.bh_admin(text,jsonb,text) rename to bh_admin_manual;
create function bughunt.bh_admin(p_action text,p_payload jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e bughunt.event; begin
 perform bughunt.require_staff(true);
 select * into e from bughunt.event where id;
 if e.online_enabled then
  if p_action='pause_all' or (p_action in ('round','extend','qualify') and (p_payload->>'round')::integer between 1 and 3) then raise exception 'Online rounds follow the fixed event schedule; manual timing and qualification are disabled'; end if;
  if p_action='round' and (p_payload->>'round')::integer=4 and p_payload->>'status'='open' and (e.onsite_date is null or (clock_timestamp() at time zone e.event_timezone)::date<>e.onsite_date) then raise exception 'The final can open only on its scheduled on-site date'; end if;
  if (p_payload->>'round')::integer=4 and (p_action='qualify' or (p_action='round' and p_payload->>'status'='open')) then
   if clock_timestamp()<e.online_ends_at then raise exception 'The online competition must end before the final opens'; end if;
   if p_action='qualify' then
    perform bughunt.sync_online(t.id) from bughunt.teams t where t.status='approved' and exists(select 1 from bughunt.round_sessions rs where rs.team_id=t.id and rs.round_id=1);
   end if;
   update bughunt.rounds set status='closed',paused_at=null,closed_at=e.online_ends_at where id<=3 and status<>'closed';
  end if;
 end if;
 return bughunt.bh_admin_manual(p_action,p_payload,p_reason);
end $$;
-- Delayed focus telemetry may retry for five minutes after the personal deadline.
alter function bughunt.bh_activity(integer,text,uuid) rename to bh_activity_manual;
create function bughunt.bh_activity(p_round integer,p_kind text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); n integer; deadline timestamptz; begin
 if not (select online_enabled from bughunt.event where id) or p_round=4 then return bughunt.bh_activity_manual(p_round,p_kind,p_request); end if;
 perform bughunt.ensure_writable();
 perform 1 from bughunt.teams where id=t for update;
 select started_at+interval '85 minutes' into deadline from bughunt.round_sessions where team_id=t and round_id=1;
 if p_round not between 1 and 3 or deadline is null or clock_timestamp()>=deadline or not exists(select 1 from bughunt.round_sessions where team_id=t and round_id=p_round) then raise exception 'No entered round for activity reporting'; end if;
 if (select count(*) from bughunt.activity where team_id=t and round_id=p_round)>=200 then return jsonb_build_object('review',true,'tab_count',(select count(*) from bughunt.activity where team_id=t and round_id=p_round and kind='tab')); end if;
 insert into bughunt.activity(team_id,round_id,request_id,kind) values(t,p_round,p_request,p_kind) on conflict(team_id,request_id) do nothing;
 select count(*) into n from bughunt.activity where team_id=t and round_id=p_round and kind='tab';
 if n>=5 then
  insert into bughunt.adjustments(team_id,amount,reason,source) values(t,-10,'Five or more tab switches in round '||p_round,'tabs:'||p_round) on conflict(team_id,source) do nothing;
  perform bughunt.recalculate(t);
 end if;
 return jsonb_build_object('tab_count',n,'warning',n>=3,'review',n>=8);
end $$;
-- All helpers and renamed implementations remain non-callable by browser roles.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='bughunt' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
