create function public.bh_claim(p_location text,p_cause text,p_impact text,p_fix text,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); result uuid; begin
 perform 1 from bughunt.teams where id=t for update;
 select id into result from bughunt.claims where team_id=t and request_id=p_request; if found then return result; end if;
 perform bughunt.ensure_writable(); perform bughunt.assert_round(t,4);
 if length(btrim(p_location)) not between 1 and 200 or length(btrim(p_cause)) not between 1 and 4000 or length(btrim(p_impact)) not between 1 and 4000 or length(btrim(p_fix)) not between 1 and 12000 then raise exception 'Complete all fields within their size limits'; end if;
 if (select count(*) from bughunt.claims where team_id=t)>=40 then raise exception 'Claim limit reached (40)'; end if;
 insert into bughunt.claims(team_id,request_id,location,cause,impact,fix) values(t,p_request,p_location,p_cause,p_impact,p_fix) returning id into result;
 return result;
end $$;
create function public.bh_activity(p_round integer,p_kind text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); n integer; begin
 perform 1 from bughunt.teams where id=t for update;
 perform bughunt.assert_round(t,p_round);
 if (select count(*) from bughunt.activity where team_id=t and round_id=p_round)>=200 then return jsonb_build_object('review',true); end if;
 insert into bughunt.activity(team_id,round_id,request_id,kind) values(t,p_round,p_request,p_kind) on conflict(team_id,request_id) do nothing;
 select count(*) into n from bughunt.activity where team_id=t and round_id=p_round and kind='tab';
 if n>=5 then
  insert into bughunt.adjustments(team_id,amount,reason,source) values(t,-10,'Five or more tab switches in round '||p_round,'tabs:'||p_round) on conflict(team_id,source) do nothing;
  perform bughunt.recalculate(t);
 end if;
 return jsonb_build_object('tab_count',n,'warning',n>=3,'review',n>=8);
end $$;
create function public.bh_ask(p_question text) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); result uuid; begin
 perform 1 from bughunt.teams where id=t for update;
 if (select count(*) from bughunt.clarifications where team_id=t)>=50 then raise exception 'Clarification limit reached'; end if;
 if exists(select 1 from bughunt.clarifications where team_id=t and created_at>now()-interval '15 seconds') then raise exception 'Please wait before sending another clarification'; end if;
 insert into bughunt.clarifications(team_id,question) values(t,btrim(p_question)) returning id into result; return result;
end $$;
create function public.bh_staff_data(p_tab text default 'overview',p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_staff(); result jsonb; begin
 if p_offset not between 0 and 100000 then raise exception 'Invalid page'; end if;
 if p_tab='queue' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select s.*,t.name team_name,q.title,q.round_id,q.max_points,q.prompt,q.code,q.fields,k.explanation,k.rubric from bughunt.submissions s
   join bughunt.teams t on t.id=s.team_id join bughunt.questions q on q.id=s.question_id join bughunt.answer_keys k on k.question_id=q.id
   where s.state='pending' order by s.submitted_at limit 50 offset p_offset) x;
 elsif p_tab='claims' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)) from (select c.*,t.name team_name from bughunt.claims c join bughunt.teams t on t.id=c.team_id where c.state='pending' order by c.submitted_at limit 50 offset p_offset) x),'[]'),
  'bugs',(select jsonb_agg(to_jsonb(b) order by id) from bughunt.bugs b));
 elsif p_tab='questions' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select q.*,k.explanation,k.rubric from bughunt.questions q join bughunt.answer_keys k on k.question_id=q.id order by q.round_id,q.ordinal) x;
 elsif p_tab='clarifications' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select c.*,t.name team_name from bughunt.clarifications c join bughunt.teams t on t.id=c.team_id order by (c.answer is null) desc,c.created_at desc limit 50 offset p_offset) x;
 elsif p_tab='overview' then
  return jsonb_build_object('teams',(select count(*) from bughunt.teams),'approved',(select count(*) from bughunt.teams where status='approved'),'active',(select count(distinct team_id) from bughunt.login_leases where expires_at>now()),
   'pending_reviews',(select count(*) from bughunt.submissions where state='pending')+(select count(*) from bughunt.claims where state='pending'),
   'rounds',(select jsonb_agg(to_jsonb(r) order by id) from bughunt.rounds r),'event',(select to_jsonb(e) from bughunt.event e where id),'server_time',now());
 else
  perform bughunt.require_staff(true);
  if p_tab='teams' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select * from bughunt.teams order by created_at limit 50 offset p_offset) x;
  elsif p_tab='audit' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select * from bughunt.audit order by id desc limit 50 offset p_offset) x;
  elsif p_tab='activity' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
    select t.id,t.name,a.round_id,count(*) filter(where a.kind='tab') tab_switches,count(*) filter(where a.kind='fullscreen') fullscreen_exits,count(*) filter(where a.kind='paste') pastes,max(a.created_at) last_event
    from bughunt.activity a join bughunt.teams t on t.id=a.team_id group by t.id,t.name,a.round_id order by max(a.created_at) desc limit 50 offset p_offset) x;
  elsif p_tab='results' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
    select row_number() over(order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,id) rank,id,name,total_score,solved,penalties,reached_at,final_completed_at from bughunt.teams where status='approved'
    order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,id limit 500 offset p_offset) x;
  else raise exception 'Unknown staff view'; end if;
 end if;
 return jsonb_build_object('items',result);
end $$;
create function public.bh_grade(p_submission uuid,p_scores jsonb,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_staff(); s bughunt.submissions; k bughunt.answer_keys; criterion jsonb; amount numeric; total numeric:=0; begin
 perform bughunt.ensure_writable();
 select * into s from bughunt.submissions where id=p_submission for update;
 if s.id is null or s.state<>'pending' then raise exception 'This submission was already reviewed or does not exist'; end if;
 perform 1 from bughunt.teams where id=s.team_id for update;
 select * into k from bughunt.answer_keys where question_id=s.question_id;
 if jsonb_typeof(p_scores)<>'object' or length(coalesce(p_note,'')) not between 1 and 2000 then raise exception 'Rubric and review note required'; end if;
 for criterion in select value from jsonb_array_elements(k.rubric) loop
  amount:=(p_scores->>(criterion->>'key'))::numeric;
  if amount is null or amount<0 or amount>(criterion->>'max')::numeric or amount<>trunc(amount) then raise exception 'Rubric score outside allowed range'; end if;
  total:=total+amount;
 end loop;
 if total>(select max_points from bughunt.questions where id=s.question_id) then raise exception 'Score exceeds question maximum'; end if;
 update bughunt.submissions set score=total,state='graded',rubric_scores=p_scores,note=p_note,reviewed_by=u,reviewed_at=now() where id=s.id;
 perform bughunt.recalculate(s.team_id);
 perform bughunt.audit_write('grade',s.id::text,to_jsonb(s),jsonb_build_object('score',total,'rubric',p_scores),p_note);
end $$;
create function public.bh_review_claim(p_claim uuid,p_verdict text,p_bug integer,p_extra text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_staff(); c bughunt.claims; b bughunt.bugs; verdict text:=p_verdict; award_points integer:=0; begin
 perform bughunt.ensure_writable();
 select * into c from bughunt.claims where id=p_claim for update;
 if c.id is null or c.state<>'pending' then raise exception 'Claim already reviewed or missing'; end if;
 perform 1 from bughunt.teams where id=c.team_id for update;
 if verdict not in ('verified','rejected','extra','duplicate') or length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception 'Verdict and note required'; end if;
 if verdict='verified' then
  select * into b from bughunt.bugs where id=p_bug;
  if b.id is null then raise exception 'Select a known bug'; end if;
  if exists(select 1 from bughunt.claims where team_id=c.team_id and bug_id=p_bug and state='verified') then verdict:='duplicate'; else award_points:=b.points; end if;
 elsif verdict='extra' then
  if length(btrim(coalesce(p_extra,''))) not between 3 and 150 then raise exception 'Give the additional valid bug a unique descriptive label'; end if;
  if exists(select 1 from bughunt.claims where team_id=c.team_id and lower(extra_label)=lower(btrim(p_extra)) and state='extra') then verdict:='duplicate'; else award_points:=5; end if;
 end if;
 update bughunt.claims set state=verdict,bug_id=case when verdict='verified' then p_bug else null end,extra_label=case when verdict='extra' then btrim(p_extra) else null end,points=award_points,reviewed_by=u,reviewed_at=now(),note=p_note where id=c.id;
 if verdict='verified' and b.severity='critical' then
  insert into bughunt.first_blood(bug_id,team_id,claim_id) values(b.id,c.team_id,c.id) on conflict(bug_id) do nothing;
 end if;
 if verdict='rejected' and (select count(*) from bughunt.claims where team_id=c.team_id and state='rejected')>2 then
  insert into bughunt.adjustments(team_id,amount,reason,source,actor) values(c.team_id,-5,'Incorrect final claim after two allowances','claim:'||c.id,u) on conflict(team_id,source) do nothing;
 end if;
 perform bughunt.recalculate(c.team_id);
 perform bughunt.audit_write('review_claim',c.id::text,to_jsonb(c),jsonb_build_object('verdict',verdict,'points',award_points,'bug',p_bug),p_note);
end $$;
create function public.bh_admin(p_action text,p_payload jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
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
   if exists(select 1 from bughunt.rounds where id<>r and status in ('open','paused')) then raise exception 'Close the other active round first'; end if;
   if r>1 and exists(select 1 from bughunt.rounds where id<r and status<>'closed') then raise exception 'Close earlier rounds first'; end if;
   if r>1 and not exists(select 1 from bughunt.qualifications where round_id=r and qualified) then raise exception 'Publish qualification first'; end if;
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
create function public.bh_public_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare visible boolean; released boolean; begin
 select leaderboard_visible,results_released into visible,released from bughunt.event where id;
 return jsonb_build_object('server_time',now(),'event',(select jsonb_build_object('name',name,'leaderboard_visible',leaderboard_visible,'results_released',results_released,'registration_open',registration_open) from bughunt.event where id),
 'rounds',(select jsonb_agg(to_jsonb(r) order by id) from bughunt.rounds r),
 'active_teams',(select count(distinct team_id) from bughunt.login_leases where expires_at>now()),
 'announcements',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,message,created_at from bughunt.announcements order by created_at desc limit 10) x),'[]'),
 'leaderboard',case when visible then coalesce((select jsonb_agg(to_jsonb(x)) from (select name,total_score,solved,row_number() over(order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,id) rank from bughunt.teams where status='approved' order by total_score desc,solved desc,reached_at,penalties,final_completed_at nulls last,id limit 100) x),'[]') else '[]'::jsonb end,
 'first_blood',case when visible then coalesce((select jsonb_agg(jsonb_build_object('team',t.name,'at',f.awarded_at)) from bughunt.first_blood f join bughunt.teams t on t.id=f.team_id),'[]') else '[]'::jsonb end,
 'countdown', (select max(s.ends_at) from bughunt.round_sessions s join bughunt.rounds r on r.id=s.round_id where r.status='open' and s.completed_at is null));
end $$;
create function public.bh_verify_certificate(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',id,'team_name',team_name,'event_name',event_name,'award',award,'issued_at',issued_at) from bughunt.certificates where id=p_id;
$$;
create function public.bh_my_results() returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); begin
 if not(select results_released from bughunt.event where id) then return jsonb_build_object('released',false); end if;
 return jsonb_build_object('released',true,'team',(select jsonb_build_object('score',total_score,'solved',solved,'penalties',penalties) from bughunt.teams where id=t),
 'scores',coalesce((select jsonb_agg(to_jsonb(x)) from (select q.round_id,s.question_id,max(s.score) score from bughunt.submissions s join bughunt.questions q on q.id=s.question_id where s.team_id=t group by q.round_id,s.question_id order by q.round_id,s.question_id) x),'[]'));
end $$;
-- Privilege allowlist: never leave PostgreSQL's default PUBLIC EXECUTE on RPCs.
revoke all on all functions in schema bughunt from public,anon,authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'bh\_%' escape '\' loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.bh_public_state() to anon;
grant execute on function public.bh_verify_certificate(uuid) to anon;
