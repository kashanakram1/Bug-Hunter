-- Organizer-requested removal of mandatory authenticator verification.
-- Preserve authenticated identity and server-side staff/admin authorization.
create or replace function bughunt.require_staff(admin_only boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); begin
 if not exists(select 1 from bughunt.staff where user_id=u and (not admin_only or role='admin')) then
  raise exception 'Staff access required' using errcode='42501';
 end if;
 return u;
end $$;
revoke all on function bughunt.require_staff(boolean) from public,anon,authenticated;
notify pgrst,'reload schema';
