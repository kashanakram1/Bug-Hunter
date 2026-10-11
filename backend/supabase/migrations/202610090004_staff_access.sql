-- Operator-managed allowlist: no invitation email, password, or public role selection.
create table bughunt.staff_access (
 email text primary key check(email=lower(btrim(email))),
 role text not null check(role in ('admin','judge')),
 created_at timestamptz not null default now()
);
alter table bughunt.staff_access enable row level security;
create policy deny_direct_access on bughunt.staff_access for all to anon,authenticated using(false) with check(false);
revoke all on bughunt.staff_access from public,anon,authenticated;
create or replace function public.bh_bootstrap() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); role_name text; t bughunt.teams; begin
 insert into bughunt.staff(user_id,role)
 select a.id,s.role from auth.users a join bughunt.staff_access s on s.email=lower(a.email)
 where a.id=u and a.email_confirmed_at is not null on conflict(user_id) do nothing;
 select role into role_name from bughunt.staff where user_id=u;
 select * into t from bughunt.teams where owner_id=u;
 return jsonb_build_object('role',coalesce(role_name,'team'),'team',case when t.id is null then null else to_jsonb(t)-'total_score'-'solved'-'penalties'-'reached_at' end,'event',(select to_jsonb(e) from bughunt.event e where id),'rounds',(select jsonb_agg(to_jsonb(r) order by id) from bughunt.rounds r),'server_time',now());
end $$;
revoke all on function public.bh_bootstrap() from public,anon;
grant execute on function public.bh_bootstrap() to authenticated;
