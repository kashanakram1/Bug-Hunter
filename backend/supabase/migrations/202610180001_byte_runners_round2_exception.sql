-- Inert until a separately approved, operator-only grant is inserted.
-- Original round sessions, global schedule, and other teams remain untouched.
create table bughunt.round2_exceptions (
 team_id uuid primary key references bughunt.teams(id)
   check(team_id='9345635c-aa5f-4361-9048-4a7c18aea8a9'::uuid),
 owner_id uuid not null references auth.users(id)
   check(owner_id='c685974c-8b6c-44c4-a172-a9f122db29df'::uuid),
 authorized_at timestamptz not null default clock_timestamp(),
 started_at timestamptz,
 ends_at timestamptz,
 completed_at timestamptz,
 check ((started_at is null and ends_at is null and completed_at is null)
   or (started_at is not null and ends_at is not null and ends_at=started_at+interval '30 minutes'
       and (completed_at is null or completed_at between started_at and ends_at)))
);
alter table bughunt.round2_exceptions enable row level security;
create policy round2_exception_private on bughunt.round2_exceptions for all using(false) with check(false);
revoke all on bughunt.round2_exceptions from public,anon,authenticated,service_role;

create function bughunt.team_round2_exception(t uuid) returns bughunt.round2_exceptions
language sql volatile security definer set search_path='' as $$
 select e from bughunt.round2_exceptions e
 join bughunt.teams x on x.id=e.team_id and x.owner_id=e.owner_id
 join auth.users u on u.id=e.owner_id
 where e.team_id=t and x.status='approved' and lower(x.email)='laibanavaid15@gmail.com'
 and lower(u.email)='laibanavaid15@gmail.com';
$$;
create function bughunt.round2_exception_state(e bughunt.round2_exceptions) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('round_id',2,'started_at',e.started_at,'ends_at',e.ends_at,
 'completed_at',e.completed_at,'phase',case when e.completed_at is not null then 'completed'
 when e.started_at is null then 'ready' when clock_timestamp()>=e.ends_at then 'expired' else 'active' end);
$$;

alter function bughunt.bh_start_round(integer) rename to bh_start_round_before_round2_exception;
create function bughunt.bh_start_round(p_round integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); e bughunt.round2_exceptions; first_entry timestamptz; begin
 e:=bughunt.team_round2_exception(t);
 if e.team_id is null then return bughunt.bh_start_round_before_round2_exception(p_round); end if;
 if p_round is distinct from 2 then raise exception 'Only Round 2 is reopened for your team'; end if;
 -- Serialize first entry across all devices, reconnects, submissions, and finishing.
 perform 1 from bughunt.teams where id=t for update;
 e:=bughunt.team_round2_exception(t);
 perform bughunt.ensure_writable();
 if e.team_id is null then raise exception 'Round 2 exception is not available'; end if;
 if e.completed_at is not null or (e.ends_at is not null and clock_timestamp()>=e.ends_at) then
   raise exception 'Your reopened Round 2 time has ended';
 end if;
 if e.started_at is null then
   first_entry:=clock_timestamp();
   update bughunt.round2_exceptions set started_at=first_entry,ends_at=first_entry+interval '30 minutes'
   where team_id=t returning * into e;
 end if;
 return to_jsonb(e)||jsonb_build_object('round_id',2,'server_time',clock_timestamp());
end $$;

alter function bughunt.assert_round(uuid,integer) rename to assert_round_before_round2_exception;
create function bughunt.assert_round(t uuid,r integer) returns void
language plpgsql security definer set search_path='' as $$
declare e bughunt.round2_exceptions:=bughunt.team_round2_exception(t); begin
 if e.team_id is null then perform bughunt.assert_round_before_round2_exception(t,r); return; end if;
 perform bughunt.ensure_writable();
 if r is distinct from 2 then raise exception 'Only Round 2 is reopened for your team'; end if;
 if e.started_at is null then raise exception 'Enter reopened Round 2 first'; end if;
 if e.completed_at is not null or clock_timestamp()>=e.ends_at then raise exception 'Your reopened Round 2 time has ended'; end if;
end $$;

alter function bughunt.bh_save_draft(text,jsonb,integer) rename to bh_save_draft_before_round2_exception;
create function bughunt.bh_save_draft(p_question text,p_answer jsonb,p_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); begin
 if (bughunt.team_round2_exception(t)).team_id is not null then
   -- Check the deadline after waiting for any concurrent team operation.
   perform 1 from bughunt.teams where id=t for update;
 end if;
 return bughunt.bh_save_draft_before_round2_exception(p_question,p_answer,p_revision);
end $$;

alter function bughunt.bh_finish_round(integer) rename to bh_finish_round_before_round2_exception;
create function bughunt.bh_finish_round(p_round integer) returns void
language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); e bughunt.round2_exceptions; begin
 e:=bughunt.team_round2_exception(t);
 if e.team_id is null then perform bughunt.bh_finish_round_before_round2_exception(p_round); return; end if;
 if p_round is distinct from 2 then raise exception 'Only Round 2 is reopened for your team'; end if;
 perform 1 from bughunt.teams where id=t for update;
 e:=bughunt.team_round2_exception(t);
 if e.completed_at is not null then return; end if;
 perform bughunt.assert_round(t,2);
 update bughunt.round2_exceptions set completed_at=least(clock_timestamp(),ends_at) where team_id=t;
 -- Deliberately do not call the usual transition into Round 3.
end $$;

alter function bughunt.bh_activity(integer,text,uuid) rename to bh_activity_before_round2_exception;
create function bughunt.bh_activity(p_round integer,p_kind text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); begin
 if (bughunt.team_round2_exception(t)).team_id is not null then
   return bughunt.bh_activity_manual(p_round,p_kind,p_request);
 end if;
 return bughunt.bh_activity_before_round2_exception(p_round,p_kind,p_request);
end $$;

alter function bughunt.bh_team_state(integer) rename to bh_team_state_before_round2_exception;
create function bughunt.bh_team_state(p_round integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); e bughunt.round2_exceptions; info jsonb; r jsonb; active boolean; sess jsonb; begin
 e:=bughunt.team_round2_exception(t);
 if e.team_id is null then return bughunt.bh_team_state_before_round2_exception(p_round); end if;
 info:=bughunt.round2_exception_state(e);
 active:=(info->>'phase')='active' and p_round=2;
 select (bughunt.online_rounds(jsonb_build_array(to_jsonb(x))))->0 into r from bughunt.rounds x where id=p_round;
 if p_round=2 then
   r:=r||jsonb_build_object('status',case when (info->>'phase') in ('ready','active') then 'open' else 'closed' end,'paused_at',null);
   if e.started_at is not null then
     sess:=jsonb_build_object('team_id',t,'round_id',2,'started_at',e.started_at,'ends_at',e.ends_at,'completed_at',e.completed_at);
   end if;
 else
   select to_jsonb(s) into sess from bughunt.round_sessions s where team_id=t and round_id=p_round;
 end if;
 -- Never call sync_online for the exception: original round history stays immutable.
 return jsonb_build_object('server_time',clock_timestamp(),'round2_exception',info,
 'online',bughunt.online_window(),'self_progression',false,'online_entered',false,
 'active_round',case when (info->>'phase')='active' then 2 else null end,
 'round',r,'session',sess,'team_ends_at',e.ends_at,
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)) from bughunt.qualifications q where team_id=t),'[]'),
 'questions',case when active then coalesce((select jsonb_agg(to_jsonb(q) order by q.ordinal) from bughunt.questions q where round_id=2),'[]') else '[]'::jsonb end,
 'submissions',case when p_round=2 then coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'question_id',s.question_id,'attempt',s.attempt,'submitted_at',s.submitted_at,'answer',s.answer)) from bughunt.submissions s join bughunt.questions q on q.id=s.question_id where s.team_id=t and q.round_id=2),'[]') else '[]'::jsonb end,
 'drafts',case when p_round=2 then coalesce((select jsonb_agg(to_jsonb(d)) from bughunt.drafts d join bughunt.questions q on q.id=d.question_id where d.team_id=t and q.round_id=2),'[]') else '[]'::jsonb end,
 'claims','[]'::jsonb,
 'clarifications',coalesce((select jsonb_agg(to_jsonb(c)-'answered_by' order by created_at desc) from bughunt.clarifications c where team_id=t),'[]'),
 'announcements',coalesce((select jsonb_agg(to_jsonb(a)-'created_by' order by created_at desc) from (select * from bughunt.announcements order by created_at desc limit 30) a),'[]'),
 'certificates',coalesce((select jsonb_agg(to_jsonb(c)) from bughunt.certificates c where team_id=t),'[]'));
end $$;
revoke all on all functions in schema bughunt from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
