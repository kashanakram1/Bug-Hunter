-- Separate code guessing limits from email-send quotas; retain all existing limits.
create or replace function public.bh_gateway_budget(p_kind text,p_ip text,p_account text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare seconds integer:=60; maximum integer; account_max integer; account_seconds integer:=600;
 ip_ok boolean; account_ok boolean:=true; retry_seconds integer:=0; boundary timestamptz;
begin
 if p_ip is null or p_ip !~ '^[a-f0-9]{64}$' or (p_account is not null and p_account !~ '^[a-f0-9]{64}$') then raise exception 'Invalid budget subject'; end if;
 case p_kind
  when 'rpc' then maximum:=12000;
  when 'login' then maximum:=1000; account_max:=10;
  when 'signup' then maximum:=600; account_max:=3; account_seconds:=3600;
  when 'recover' then maximum:=600; account_max:=3; account_seconds:=3600;
  when 'session' then maximum:=12000;
  when 'mfa' then maximum:=600; account_max:=10; account_seconds:=600;
  when 'callback' then maximum:=600;
  when 'email_verify' then maximum:=600; account_max:=10; account_seconds:=600;
  else raise exception 'Invalid budget category';
 end case;
 if account_max is not null and p_account is null then raise exception 'Account budget required'; end if;
 ip_ok:=bughunt.consume_budget('gateway:'||p_kind,p_ip,maximum,seconds);
 if not ip_ok then
  select window_start into boundary from bughunt.request_budgets where bucket='gateway:'||p_kind and subject=p_ip;
  retry_seconds:=greatest(1,ceil(extract(epoch from boundary+make_interval(secs=>seconds)-clock_timestamp()))::integer);
 end if;
 if account_max is not null then
  account_ok:=bughunt.consume_budget('account:'||p_kind,p_account,account_max,account_seconds);
  if not account_ok then
   select window_start into boundary from bughunt.request_budgets where bucket='account:'||p_kind and subject=p_account;
   retry_seconds:=greatest(retry_seconds,1,ceil(extract(epoch from boundary+make_interval(secs=>account_seconds)-clock_timestamp()))::integer);
  end if;
 end if;
 if random()<0.01 then
  delete from bughunt.request_budgets where (bucket,subject) in
   (select bucket,subject from bughunt.request_budgets where updated_at<now()-interval '1 day' order by updated_at limit 1000);
 end if;
 return jsonb_build_object('allowed',ip_ok and account_ok,'retry_after',retry_seconds,'limit_scope',case when not account_ok then 'account' when not ip_ok then 'ip' else null end);
end $$;
