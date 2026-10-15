-- Repair a variable/SQL alias collision in the noncanonical shared-list grading branch.
-- Existing answers, scoring rules, attempt limits, grants and scheduling remain unchanged.
create or replace function bughunt.bh_submit(p_question text,p_answer jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); q bughunt.questions; k bughunt.answer_keys; s bughunt.submissions; n integer; item jsonb; pts numeric:=0; normalized_answer text; canonical boolean:=true; correct integer:=0; begin
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
   normalized_answer:=bughunt.normalize(p_answer->>(item->>'field'));
   if exists(select 1 from jsonb_array_elements_text(item->'values') accepted_value(value) where bughunt.normalize(accepted_value.value)=normalized_answer) then pts:=pts+(item->>'points')::numeric; correct:=correct+1;
   else canonical:=false; end if;
  end loop;
  if p_question='R1-Q5' then pts:=case when correct=3 then 10 when correct=2 then 5 else 0 end; end if;
  if p_question='R1-Q4' and not (bughunt.normalize(p_answer->>'a')='1' and bughunt.normalize(p_answer->>'a2')='1 2') then
   pts:=case when exists(select 1 from jsonb_array_elements(k.accepted->'parts') accepted_part(part), jsonb_array_elements_text(accepted_part.part->'values') accepted_value(value) where accepted_part.part->>'field'='b' and bughunt.normalize(accepted_value.value)=bughunt.normalize(p_answer->>'b')) then 5 else 0 end;
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
revoke all on function bughunt.bh_submit(text,jsonb,uuid) from public,anon,authenticated,service_role;
