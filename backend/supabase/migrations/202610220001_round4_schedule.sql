-- Round 4 only. No existing data is reset or rewritten.
create table bughunt.round4_finalizations (
 team_id uuid primary key references bughunt.teams(id),
 finalized_at timestamptz not null,
 reason text not null check(reason in ('manual','expired')),
 saved_drafts jsonb not null,
 draft_outcomes jsonb not null
);
alter table bughunt.round4_finalizations enable row level security;
create policy round4_finalization_private on bughunt.round4_finalizations for all using(false) with check(false);
revoke all on bughunt.round4_finalizations from public,anon,authenticated,service_role;

create function bughunt.protect_round4_timer() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.round_id=4 and
  (new.round_id<>4 or new.team_id<>old.team_id or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)) then
  raise exception 'Finalized Round 4 cannot be reopened or reassigned';
 end if;
 if new.round_id=4 then
  if tg_op='INSERT' and new.ends_at is distinct from new.started_at+interval '40 minutes' then
   raise exception 'Round 4 requires exactly 40 minutes';
  elsif tg_op='UPDATE' and (new.started_at is distinct from old.started_at or new.ends_at is distinct from old.ends_at) then
   raise exception 'Round 4 timer cannot be reset or extended';
  end if;
 end if;
 return new;
end $$;
create trigger round4_timer_immutable before insert or update on bughunt.round_sessions
for each row execute function bughunt.protect_round4_timer();

create function bughunt.round4_opening() returns timestamptz language sql immutable set search_path='' as $$
 select timestamptz '2026-10-22 04:30:00+00';
$$;
create function bughunt.round4_info(t uuid) returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('opens_at',bughunt.round4_opening(),'duration_seconds',2400,
 'started_at',s.started_at,'ends_at',s.ends_at,'completed_at',s.completed_at,
 'phase',case when s.completed_at is not null then 'completed'
 when s.ends_at is not null and clock_timestamp()>=s.ends_at then 'expired'
 when s.team_id is not null then 'active'
 when clock_timestamp()<bughunt.round4_opening() then 'scheduled' else 'ready' end)
 from (select t id) x left join bughunt.round_sessions s on s.team_id=x.id and s.round_id=4;
$$;

-- Shared by explicit completion, offline sweeps, and authorized state/entry reads.
-- The team lock is also taken by every final write, so a final snapshot is consistent.
create function bughunt.finalize_round4(t uuid,manual boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare s bughunt.round_sessions; d record; q bughunt.questions; n integer; draft_answer jsonb;
 finish_at timestamptz; snapshots jsonb; outcomes jsonb:='{}'; issue text; begin
 perform 1 from bughunt.teams where id=t for update;
 select * into s from bughunt.round_sessions where team_id=t and round_id=4;
 if s.team_id is null or s.completed_at is not null then return false; end if;
 if not manual and clock_timestamp()<s.ends_at then return false; end if;
 finish_at:=least(clock_timestamp(),s.ends_at);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.question_id),'[]') into snapshots
 from bughunt.drafts x join bughunt.questions y on y.id=x.question_id where x.team_id=t and y.round_id=4;
 for d in select x.* from bughunt.drafts x join bughunt.questions y on y.id=x.question_id
          where x.team_id=t and y.round_id=4 order by x.question_id loop
  draft_answer:=d.answer; issue:=null;
  select * into q from bughunt.questions where id=d.question_id;
  -- Existing submissions and claims are never edited; each valid unsubmitted draft
  -- enters the normal pending review queue. Every draft, including incomplete work,
  -- is retained unchanged in the final snapshot with its outcome.
  if q.kind='arena' then
   if exists(select 1 from bughunt.claims c where c.team_id=t
    and c.location=draft_answer->>'location' and c.cause=draft_answer->>'cause'
    and c.impact=draft_answer->>'impact' and c.fix=draft_answer->>'fix') then issue:='already submitted';
   elsif not (coalesce(length(btrim(draft_answer->>'location')),0) between 1 and 200
    and coalesce(length(btrim(draft_answer->>'cause')),0) between 1 and 4000
    and coalesce(length(btrim(draft_answer->>'impact')),0) between 1 and 4000
    and coalesce(length(btrim(draft_answer->>'fix')),0) between 1 and 12000) then issue:='incomplete or invalid; preserved';
   elsif (select count(*) from bughunt.claims where team_id=t)>=40 then issue:='claim limit reached; preserved';
   else
    insert into bughunt.claims(team_id,request_id,location,cause,impact,fix,submitted_at)
    values(t,gen_random_uuid(),draft_answer->>'location',draft_answer->>'cause',draft_answer->>'impact',draft_answer->>'fix',finish_at);
   end if;
  else
   select count(*)+1 into n from bughunt.submissions where team_id=t and question_id=q.id;
   if exists(select 1 from bughunt.submissions x where x.team_id=t and x.question_id=q.id and x.answer=draft_answer) then issue:='already submitted';
   elsif n>q.max_attempts then issue:='attempt limit reached; preserved';
   else
    begin perform bughunt.validate_answer(q,draft_answer);
    exception when raise_exception then issue:='incomplete or invalid; preserved'; end;
    if issue is null then
     insert into bughunt.submissions(team_id,question_id,request_id,attempt,answer,suggested_score,score,state,submitted_at)
     values(t,q.id,gen_random_uuid(),n,draft_answer,0,null,'pending',finish_at);
    end if;
   end if;
  end if;
  outcomes:=outcomes||jsonb_build_object(d.question_id,coalesce(issue,'submitted for review'));
 end loop;
 insert into bughunt.round4_finalizations(team_id,finalized_at,reason,saved_drafts,draft_outcomes)
 values(t,finish_at,case when clock_timestamp()>=s.ends_at then 'expired' else 'manual' end,snapshots,outcomes);
 update bughunt.round_sessions set completed_at=finish_at where team_id=t and round_id=4 and completed_at is null;
 update bughunt.teams set final_completed_at=finish_at where id=t and final_completed_at is null;
 return true;
end $$;
create function bughunt.expire_round4() returns integer language plpgsql security definer set search_path='' as $$
declare item record; n integer:=0; begin
 for item in select t.id from bughunt.teams t join bughunt.round_sessions s on s.team_id=t.id
  where s.round_id=4 and s.completed_at is null and s.ends_at<=clock_timestamp()
  order by t.id limit 50 for update of t skip locked loop
  if bughunt.finalize_round4(item.id) then n:=n+1; end if;
 end loop;
 return n;
end $$;

alter function bughunt.online_rounds(jsonb) rename to online_rounds_before_round4;
create function bughunt.online_rounds(value jsonb) returns jsonb language sql volatile security definer set search_path='' as $$
 select coalesce(jsonb_agg(r||jsonb_build_object('status',case
 when (r->>'id')::int=4 and clock_timestamp()>=bughunt.round4_opening() then 'open' else 'closed' end,
 'paused_at',null) order by (r->>'id')::int),'[]') from jsonb_array_elements(value) r;
$$;
alter function bughunt.bh_start_round(integer) rename to bh_start_round_before_round4;
create function bughunt.bh_start_round(p_round integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); s bughunt.round_sessions; anchor timestamptz; begin
 if p_round is distinct from 4 then raise exception 'Rounds 1, 2 and 3 are closed'; end if;
 perform 1 from bughunt.teams where id=t for update;
 perform bughunt.ensure_writable();
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 if clock_timestamp()<bughunt.round4_opening() then raise exception 'Round 4 opens on 22 October at 9:30 AM PKT'; end if;
 select * into s from bughunt.round_sessions where team_id=t and round_id=4;
 if s.team_id is null then
  anchor:=clock_timestamp();
  insert into bughunt.round_sessions(team_id,round_id,started_at,ends_at) values(t,4,anchor,anchor+interval '40 minutes');
 end if;
 perform bughunt.finalize_round4(t);
 select * into s from bughunt.round_sessions where team_id=t and round_id=4;
 return to_jsonb(s)||jsonb_build_object('server_time',clock_timestamp());
end $$;
alter function bughunt.assert_round(uuid,integer) rename to assert_round_before_round4;
create function bughunt.assert_round(t uuid,r integer) returns void language plpgsql security definer set search_path='' as $$
declare s bughunt.round_sessions; begin
 if r is distinct from 4 then raise exception 'Rounds 1, 2 and 3 are closed'; end if;
 perform 1 from bughunt.teams where id=t for update;
 perform bughunt.ensure_writable();
 if not exists(select 1 from bughunt.teams where id=t and status='approved') then raise exception 'Approval required'; end if;
 if clock_timestamp()<bughunt.round4_opening() then raise exception 'Round 4 has not opened'; end if;
 select * into s from bughunt.round_sessions where team_id=t and round_id=4;
 if s.team_id is null or s.completed_at is not null or clock_timestamp()>=s.ends_at then raise exception 'Round 4 time has ended or has not started'; end if;
end $$;
alter function bughunt.bh_finish_round(integer) rename to bh_finish_round_before_round4;
create function bughunt.bh_finish_round(p_round integer) returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); begin
 if p_round is distinct from 4 then raise exception 'Rounds 1, 2 and 3 are closed'; end if;
 perform 1 from bughunt.teams where id=t for update;
 if exists(select 1 from bughunt.round_sessions where team_id=t and round_id=4 and completed_at is not null) then return; end if;
 if exists(select 1 from bughunt.round_sessions where team_id=t and round_id=4 and ends_at<=clock_timestamp()) then
  perform bughunt.finalize_round4(t); return;
 end if;
 perform bughunt.assert_round(t,4); perform bughunt.finalize_round4(t,true);
end $$;
-- Replace only the state builder to avoid earlier-round progression/exception paths.
alter function bughunt.bh_team_state(integer) rename to bh_team_state_before_round4;
create function bughunt.bh_team_state(p_round integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); s bughunt.round_sessions; info jsonb; can_read boolean; begin
 perform bughunt.finalize_round4(t);
 select * into s from bughunt.round_sessions where team_id=t and round_id=4;
 info:=bughunt.round4_info(t);
 can_read:=p_round=4 and s.team_id is not null and exists(select 1 from bughunt.teams where id=t and status='approved')
   and clock_timestamp()>=bughunt.round4_opening();
 return jsonb_build_object('server_time',clock_timestamp(),'round4',info,'self_progression',false,'online_entered',false,
 'online',bughunt.online_window(),'active_round',case when info->>'phase'='active' then 4 else null end,
 'round',(select bughunt.online_rounds(jsonb_build_array(to_jsonb(r)))->0 from bughunt.rounds r where id=p_round),
 'session',case when p_round=4 and s.team_id is not null then to_jsonb(s) else null end,
 'qualifications','[]'::jsonb,
 'questions',case when can_read then coalesce((select jsonb_agg(to_jsonb(q) order by ordinal) from bughunt.questions q where round_id=4),'[]') else '[]'::jsonb end,
 'submissions',case when can_read then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'question_id',x.question_id,'attempt',x.attempt,'submitted_at',x.submitted_at,'answer',x.answer)) from bughunt.submissions x join bughunt.questions q on q.id=x.question_id where x.team_id=t and q.round_id=4),'[]') else '[]'::jsonb end,
 'drafts',case when can_read then coalesce((select jsonb_agg(to_jsonb(x)) from bughunt.drafts x join bughunt.questions q on q.id=x.question_id where x.team_id=t and q.round_id=4),'[]') else '[]'::jsonb end,
 'claims',case when can_read then coalesce((select jsonb_agg(to_jsonb(c)-'bug_id'-'points'-'reviewed_by'-'reviewed_at'-'note') from bughunt.claims c where team_id=t),'[]') else '[]'::jsonb end,
 'clarifications',coalesce((select jsonb_agg(to_jsonb(c)-'answered_by' order by created_at desc) from bughunt.clarifications c where team_id=t),'[]'),
 'announcements',coalesce((select jsonb_agg(to_jsonb(a)-'created_by' order by created_at desc) from (select * from bughunt.announcements order by created_at desc limit 30) a),'[]'),
 'certificates',coalesce((select jsonb_agg(to_jsonb(c)) from bughunt.certificates c where team_id=t),'[]'));
end $$;
-- Preserve existing telemetry rules while avoiding the earlier-round scheduler.
alter function bughunt.bh_activity(integer,text,uuid) rename to bh_activity_before_round4;
create function bughunt.bh_activity(p_round integer,p_kind text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin return bughunt.bh_activity_manual(p_round,p_kind,p_request); end $$;
alter function bughunt.bh_heartbeat() rename to bh_heartbeat_before_round4;
create function bughunt.bh_heartbeat() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t uuid:=bughunt.require_team(false); begin
 result:=bughunt.bh_heartbeat_before_round4();
 perform bughunt.finalize_round4(t);
 return result;
end $$;
revoke all on function bughunt.protect_round4_timer(),bughunt.round4_opening(),bughunt.round4_info(uuid),
 bughunt.finalize_round4(uuid,boolean),bughunt.expire_round4(),bughunt.online_rounds(jsonb),
 bughunt.bh_start_round(integer),bughunt.assert_round(uuid,integer),bughunt.bh_finish_round(integer),
 bughunt.bh_team_state(integer),bughunt.bh_activity(integer,text,uuid),bughunt.bh_heartbeat()
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
