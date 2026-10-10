-- Safe draft retry after a lost response; no changes to previously applied migrations.
create or replace function public.bh_save_draft(p_question text,p_answer jsonb,p_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(); q bughunt.questions; rev integer; begin
 select * into q from bughunt.questions where id=p_question; if q.id is null then raise exception 'Question not found'; end if;
 perform bughunt.assert_round(t,q.round_id);
 if p_answer is null or jsonb_typeof(p_answer)<>'object' or octet_length(p_answer::text)>32000 or p_revision<0 then raise exception 'Invalid draft'; end if;
 select revision into rev from bughunt.drafts where team_id=t and question_id=p_question and answer=p_answer and revision=p_revision+1;
 if found then return rev; end if;
 insert into bughunt.drafts(team_id,question_id,answer,revision) values(t,p_question,p_answer,1)
 on conflict(team_id,question_id) do update set answer=excluded.answer,revision=bughunt.drafts.revision+1,updated_at=now() where bughunt.drafts.revision=p_revision
 returning revision into rev;
 if rev is null then raise exception 'Draft changed on another device. Reload before editing'; end if;
 return rev;
end $$;
create index audit_action_target_time on bughunt.audit(action,target,created_at desc);
create index adjustments_team on bughunt.adjustments(team_id);
create index first_blood_team on bughunt.first_blood(team_id);
create index round_sessions_round on bughunt.round_sessions(round_id,team_id);
create index qualifications_round on bughunt.qualifications(round_id,qualified,team_id);
create index login_leases_active on bughunt.login_leases(expires_at,team_id);
create index claims_team on bughunt.claims(team_id,state);
-- Existing grants are preserved by CREATE OR REPLACE; declare them explicitly too.
revoke all on function public.bh_save_draft(text,jsonb,integer) from public,anon;
grant execute on function public.bh_save_draft(text,jsonb,integer) to authenticated;
