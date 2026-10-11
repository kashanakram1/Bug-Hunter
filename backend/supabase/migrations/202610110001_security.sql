-- Additive hardening: no event records are reset or deleted.
create table bughunt.request_budgets (
 bucket text not null, subject text not null,
 window_start timestamptz not null, hits integer not null check(hits>=0), updated_at timestamptz not null default now(),
 primary key(bucket,subject)
);
alter table bughunt.request_budgets enable row level security;
create policy deny_direct_access on bughunt.request_budgets for all to anon,authenticated using(false) with check(false);
revoke all on bughunt.request_budgets from public,anon,authenticated;
create index request_budgets_expiry on bughunt.request_budgets(updated_at);

-- The upsert serializes concurrent callers for a single subject/window.
-- Return denial rather than raising so gateway counters commit independently of a failed operation.
create function bughunt.consume_budget(p_bucket text,p_subject text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare count_now integer; boundary timestamptz:=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds); begin
 insert into bughunt.request_budgets as b(bucket,subject,window_start,hits) values(p_bucket,p_subject,boundary,1)
 on conflict(bucket,subject) do update set window_start=excluded.window_start,
 hits=case when b.window_start<excluded.window_start then 1 else least(b.hits+1,p_limit+1) end,updated_at=now()
 returning hits into count_now;
 return count_now<=p_limit;
end $$;

create function public.bh_gateway_budget(p_kind text,p_ip text,p_account text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare seconds integer:=60; maximum integer; account_max integer; account_seconds integer:=600; ok boolean; begin
 if p_ip is null or p_ip !~ '^[a-f0-9]{64}$' or (p_account is not null and p_account !~ '^[a-f0-9]{64}$') then raise exception 'Invalid budget subject'; end if;
 case p_kind
  when 'rpc' then maximum:=12000;
  when 'login' then maximum:=1000; account_max:=10;
  when 'signup' then maximum:=600; account_max:=3; account_seconds:=3600;
  when 'recover' then maximum:=600; account_max:=3; account_seconds:=3600;
  when 'session' then maximum:=12000;
  when 'mfa' then maximum:=600; account_max:=10; account_seconds:=600;
  when 'callback' then maximum:=600;
  else raise exception 'Invalid budget category';
 end case;
 ok:=bughunt.consume_budget('gateway:'||p_kind,p_ip,maximum,seconds);
 if account_max is not null then
  if p_account is null then raise exception 'Account budget required'; end if;
  -- Login and email attempts are committed even when the later Auth request fails.
  ok:=bughunt.consume_budget('account:'||p_kind,p_account,account_max,account_seconds) and ok;
 end if;
 if random()<0.01 then
  delete from bughunt.request_budgets where (bucket,subject) in
   (select bucket,subject from bughunt.request_budgets where updated_at<now()-interval '1 day' order by updated_at limit 1000);
 end if;
 return jsonb_build_object('allowed',ok,'retry_after',case when ok then 0 else greatest(seconds,case when account_max is not null then account_seconds else 0 end) end);
end $$;

-- Preserve decision/score provenance without copying entire answers and rosters into the audit log.
create or replace function bughunt.audit_write(action text,target text,old_value jsonb,new_value jsonb,reason text default null) returns void
language sql security definer set search_path='' as $$
 insert into bughunt.audit(actor,action,target,old_value,new_value,reason)
 values(auth.uid(),action,target,
  old_value-'answer'-'members'-'email'-'leader'-'university'-'department'-'password'-'access_token'-'refresh_token',
  new_value-'answer'-'members'-'email'-'password'-'access_token'-'refresh_token',reason);
$$;
revoke all on function public.bh_gateway_budget(text,text,text) from public,anon,authenticated;
grant execute on function public.bh_gateway_budget(text,text,text) to service_role;

create or replace function bughunt.require_staff(admin_only boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=bughunt.require_user(); begin
 if not exists(select 1 from bughunt.staff where user_id=u and (not admin_only or role='admin')) then raise exception 'Staff access required' using errcode='42501'; end if;
 if coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'Verify your authenticator before using staff controls' using errcode='42501'; end if;
 return u;
end $$;

create function bughunt.check_rpc_budget(p_name text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid; maximum integer:=120; begin
 if p_name in ('bh_public_state','bh_verify_certificate') then
  if not bughunt.consume_budget('public:read','gateway',30000,60) then raise exception 'Rate limit exceeded'; end if;
  return;
 end if;
 u:=bughunt.require_user();
 if not bughunt.consume_budget('user:all',u::text,240,60) then raise exception 'Rate limit exceeded'; end if;
 if p_name='bh_heartbeat' then maximum:=10;
 elsif p_name in ('bh_register','bh_start_round','bh_finish_round') then maximum:=20;
 end if;
 if not bughunt.consume_budget('rpc:'||p_name,u::text,maximum,60) then raise exception 'Rate limit exceeded'; end if;
end $$;

-- Move implementations to the non-exposed schema and recreate identical public signatures.
-- Every callable database endpoint receives a budget, including direct authenticated callers.
do $$ declare f record; arguments text; call_args text; result_type text; wrapper text; begin
 for f in select p.oid,p.proname,p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'bh\_%' escape '\' and p.proname<>'bh_gateway_budget' loop
  arguments:=pg_get_function_arguments(f.oid);
  result_type:=pg_get_function_result(f.oid);
  select coalesce(string_agg('$'||g,',' order by g),'') into call_args from generate_series(1,f.pronargs) g;
  execute format('alter function %s set schema bughunt',f.oid::regprocedure);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  wrapper:=format('select bughunt.check_rpc_budget(%L); select bughunt.%I(%s);',f.proname,f.proname,call_args);
  execute format('create function public.%I(%s) returns %s language sql security definer set search_path='''' as %L',f.proname,arguments,result_type,wrapper);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',(select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.proname));
  if f.proname in ('bh_public_state','bh_verify_certificate') then
   execute format('grant execute on function %s to service_role',(select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.proname));
  else
   execute format('grant execute on function %s to authenticated',(select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.proname));
  end if;
 end loop;
end $$;
revoke all on function bughunt.consume_budget(text,text,integer,integer),bughunt.check_rpc_budget(text) from public,anon,authenticated;
-- Never collect plaintext IP addresses or emails in these budgets. The gateway supplies HMAC hashes.
-- Retention maintenance may remove only stale budgets: DELETE ... WHERE updated_at < now()-interval '1 day'.
notify pgrst,'reload schema';
