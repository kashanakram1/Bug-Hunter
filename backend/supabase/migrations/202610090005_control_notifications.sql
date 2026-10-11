-- A public invalidation signal contains no question, answer, team, or score data.
-- Only organizer controls generate notifications; score updates do not fan out to 500 teams.
create table public.bh_control_signal(id boolean primary key default true check(id),changed_at timestamptz not null default now());
alter table public.bh_control_signal enable row level security;
create policy public_control_signal_read on public.bh_control_signal for select to anon,authenticated using(true);
create policy deny_control_signal_write on public.bh_control_signal for all to anon,authenticated using(false) with check(false);
revoke all on public.bh_control_signal from public,anon,authenticated;
grant select on public.bh_control_signal to anon,authenticated;
insert into public.bh_control_signal(id) values(true);
create function bughunt.notify_control() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.bh_control_signal set changed_at=clock_timestamp() where id; return null; end $$;
revoke all on function bughunt.notify_control() from public,anon,authenticated;
create trigger round_control_signal after update on bughunt.rounds for each statement execute function bughunt.notify_control();
create trigger event_control_signal after update on bughunt.event for each statement execute function bughunt.notify_control();
create trigger announcement_control_signal after insert on bughunt.announcements for each statement execute function bughunt.notify_control();
create trigger qualification_control_signal after insert or update on bughunt.qualifications for each statement execute function bughunt.notify_control();
create trigger team_approval_signal after update of status on bughunt.teams for each statement execute function bughunt.notify_control();
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.bh_control_signal; end if; end $$;
