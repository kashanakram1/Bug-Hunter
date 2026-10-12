-- Local draft: retain audit provenance without mandatory operator-written reasons.
alter function bughunt.bh_admin(text,jsonb,text) rename to bh_admin_with_note;
create function bughunt.bh_admin(p_action text,p_payload jsonb,p_reason text) returns jsonb
language sql security definer set search_path='' as $$
 select bughunt.bh_admin_with_note(p_action,p_payload,coalesce(nullif(btrim(p_reason),''),'Organizer action: '||p_action));
$$;
alter function bughunt.bh_grade(uuid,jsonb,text) rename to bh_grade_with_note;
create function bughunt.bh_grade(p_submission uuid,p_scores jsonb,p_note text) returns void
language sql security definer set search_path='' as $$
 select bughunt.bh_grade_with_note(p_submission,p_scores,coalesce(nullif(btrim(p_note),''),'Rubric review'));
$$;
alter function bughunt.bh_review_claim(uuid,text,integer,text,text) rename to bh_review_claim_with_note;
create function bughunt.bh_review_claim(p_claim uuid,p_verdict text,p_bug integer,p_extra text,p_note text) returns void
language sql security definer set search_path='' as $$
 select bughunt.bh_review_claim_with_note(p_claim,p_verdict,p_bug,p_extra,coalesce(nullif(btrim(p_note),''),'Claim review: '||p_verdict));
$$;
revoke all on function bughunt.bh_admin(text,jsonb,text),bughunt.bh_admin_with_note(text,jsonb,text),bughunt.bh_grade(uuid,jsonb,text),bughunt.bh_grade_with_note(uuid,jsonb,text),bughunt.bh_review_claim(uuid,text,integer,text,text),bughunt.bh_review_claim_with_note(uuid,text,integer,text,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
