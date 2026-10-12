-- Confirmed Module-5 plan. Local only; apply after explicit deployment approval.
-- Preserve rehearsal records rather than silently treating them as official entries.
do $$ begin
 if exists(select 1 from bughunt.round_sessions where round_id<=3) then
  raise exception 'Existing rehearsal round sessions need organizer review before schedule activation; no records were removed';
 end if;
end $$;
update bughunt.event set name='Bug Hunter Module-5',event_timezone='Asia/Karachi',onsite_date='2026-10-22',
 online_starts_at='2026-10-17 16:00:00+05',online_entry_closes_at='2026-10-17 16:20:00+05',
 online_ends_at='2026-10-17 17:40:00+05',online_enabled=true,updated_at=now() where id;
update bughunt.rounds set duration_seconds=case id when 1 then 1200 when 2 then 1800 when 3 then 1800 when 4 then 2400 end where id between 1 and 4;
notify pgrst,'reload schema';
