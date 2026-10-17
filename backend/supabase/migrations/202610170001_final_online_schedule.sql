-- Organizer-approved schedule: 18 October, 16:00 PKT; 30-minute entry grace.
-- The latest entrant still gets a full 80 minutes, so the global cutoff is 17:50 PKT.
alter table bughunt.event drop constraint online_window_valid;
alter table bughunt.event add constraint online_window_valid check (
 not online_enabled or (online_starts_at is not null and online_entry_closes_at is not null and online_ends_at is not null
 and online_entry_closes_at>online_starts_at and online_ends_at=online_entry_closes_at+interval '80 minutes'));

do $$ declare original jsonb; changed jsonb; old_final jsonb; begin
 select to_jsonb(e) into original from bughunt.event e where id for update;
 select to_jsonb(r) into old_final from bughunt.rounds r where id=4 for update;
 update bughunt.event set unlimited_testing=false,online_enabled=true,event_timezone='Asia/Karachi',
   online_starts_at='2026-10-18 16:00:00+05',online_entry_closes_at='2026-10-18 16:30:00+05',
   online_ends_at='2026-10-18 17:50:00+05',onsite_date='2026-10-22' where id;
 update bughunt.rounds set duration_seconds=case id when 1 then 1200 when 2 then 1800 when 3 then 1800 end
   where id between 1 and 3 and duration_seconds<>case id when 1 then 1200 when 2 then 1800 when 3 then 1800 end;
 update bughunt.rounds set status='draft',paused_at=null where id=4;
 select to_jsonb(e) into changed from bughunt.event e where id;
 perform bughunt.audit_write('schedule_online_competition','event',original,changed,
   'Organizer requested 18 October 2026 16:00 PKT start, 30-minute entry grace, 80 minutes per team, and final locked until 22 October');
 perform bughunt.audit_write('lock_final_round','4',old_final,(select to_jsonb(r) from bughunt.rounds r where id=4),
   'Final remains locked for the 22 October on-site event');
end $$;
notify pgrst,'reload schema';
