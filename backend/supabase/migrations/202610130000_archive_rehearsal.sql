-- REVIEW ONLY: requires explicit organizer approval before applying to production.
-- Preserve practice data in a private archive; keep users, registrations, and approval.
create table bughunt.rehearsal_archive (
 id bigint generated always as identity primary key,
 archived_at timestamptz not null default now(),
 purpose text not null,
 payload jsonb not null
);
alter table bughunt.rehearsal_archive enable row level security;
create policy deny_browser_access on bughunt.rehearsal_archive for all to anon,authenticated using(false) with check(false);
revoke all on bughunt.rehearsal_archive from public,anon,authenticated,service_role;
do $$
declare ids uuid[]; table_name text; rows jsonb; snapshot jsonb; records jsonb:='{}'; team_count integer; session_count integer;
begin
 select array_agg(distinct team_id),count(*) into ids,session_count from bughunt.round_sessions where round_id<=3;
 team_count:=coalesce(cardinality(ids),0);
 if team_count=0 then return; end if;
 if team_count<>3 or session_count<>5 then raise exception 'Rehearsal cohort changed; review required before resetting progress'; end if;
 if (select results_released from bughunt.event where id) or exists(select 1 from bughunt.round_sessions where not(team_id=any(ids))) then raise exception 'Other competition progress exists; operator review required'; end if;
 perform 1 from bughunt.teams where id=any(ids) for update;
 snapshot:=jsonb_build_object('event',(select to_jsonb(e) from bughunt.event e where id),
  'rounds',(select jsonb_agg(to_jsonb(r)) from bughunt.rounds r),
  'teams',(select jsonb_agg(to_jsonb(t)) from bughunt.teams t where id=any(ids)));
 foreach table_name in array array['first_blood','claims','submissions','drafts','adjustments','activity','qualifications','round_sessions','login_leases','certificates'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from bughunt.%I x where team_id=any($1)',table_name) into rows using ids;
  records:=records||jsonb_build_object(table_name,rows);
 end loop;
 insert into bughunt.rehearsal_archive(purpose,payload) values('Approved practice-progress archive before Module-5 activation',snapshot||jsonb_build_object('records',records));
 -- Foreign-key-safe, explicitly scoped cleanup of only the reviewed rehearsal teams.
 foreach table_name in array array['first_blood','claims','submissions','drafts','adjustments','activity','qualifications','round_sessions','login_leases','certificates'] loop
  execute format('delete from bughunt.%I where team_id=any($1)',table_name) using ids;
 end loop;
 update bughunt.teams set total_score=0,solved=0,penalties=0,reached_at=now(),final_completed_at=null where id=any(ids);
 update bughunt.rounds set status='draft',paused_at=null,opened_at=null,closed_at=null where id between 1 and 4;
 update bughunt.event set results_released=false,leaderboard_visible=false,finalized_at=null,updated_at=now() where id;
 perform bughunt.audit_write('archive_rehearsal','module5',null,jsonb_build_object('teams',team_count,'online_sessions',session_count),'Practice progress archived; registrations retained');
end $$;
