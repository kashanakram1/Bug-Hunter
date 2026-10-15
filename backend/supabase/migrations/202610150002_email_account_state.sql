-- Server-only account lookup makes email-send outcomes explicit without exposing user records.
create function public.bh_email_account_state(p_email text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('exists',count(*)>0,'confirmed',coalesce(bool_or(email_confirmed_at is not null),false))
 from auth.users where lower(email)=lower(btrim(p_email))
$$;
revoke all on function public.bh_email_account_state(text) from public,anon,authenticated;
grant execute on function public.bh_email_account_state(text) to service_role;
