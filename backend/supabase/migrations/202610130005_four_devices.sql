-- Four active competition sessions for every team; no organizer override needed.
-- Retain the legacy session_limit column for compatibility with historical migrations.
alter table bughunt.teams add column device_limit integer not null default 4 check(device_limit=4);
create or replace function bughunt.bh_heartbeat() returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=bughunt.require_team(false); sid uuid:=(auth.jwt()->>'session_id')::uuid; lim integer; begin
 select device_limit into lim from bughunt.teams where id=t for update;
 if not exists(select 1 from bughunt.login_leases where team_id=t and session_id=sid and expires_at>clock_timestamp())
 and (select count(*) from bughunt.login_leases where team_id=t and expires_at>clock_timestamp())>=lim then
  if not exists(select 1 from bughunt.audit where action='blocked_login' and target=t::text and created_at>now()-interval '15 minutes') then
   perform bughunt.audit_write('blocked_login',t::text,null,jsonb_build_object('session',sid),'Four-device team limit reached');
  end if;
  return jsonb_build_object('allowed',false,'message','All four team devices are active. Sign out on another device, or wait two minutes after it disconnects.');
 end if;
 insert into bughunt.login_leases(team_id,session_id,expires_at) values(t,sid,clock_timestamp()+interval '120 seconds')
 on conflict(team_id,session_id) do update set expires_at=excluded.expires_at;
 return jsonb_build_object('allowed',true,'device_limit',lim,'server_time',now());
end $$;
alter function bughunt.bh_admin(text,jsonb,text) rename to bh_admin_before_four_devices;
create function bughunt.bh_admin(p_action text,p_payload jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform bughunt.require_staff(true);
 if p_action='sessions' and p_payload ? 'limit' then raise exception 'Every team automatically allows four devices; organizer limit overrides are disabled'; end if;
 return bughunt.bh_admin_before_four_devices(p_action,p_payload,p_reason);
end $$;
revoke all on function bughunt.bh_heartbeat(),bughunt.bh_admin(text,jsonb,text),bughunt.bh_admin_before_four_devices(text,jsonb,text) from public,anon,authenticated,service_role;
create or replace function bughunt.check_rpc_budget(p_name text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid; maximum integer:=120; begin
 if p_name in ('bh_public_state','bh_verify_certificate') then
  if not bughunt.consume_budget('public:read','gateway',30000,60) then raise exception 'Rate limit exceeded'; end if;
  return;
 end if;
 u:=bughunt.require_user();
 if not bughunt.consume_budget('user:all',u::text,240,60) then raise exception 'Rate limit exceeded'; end if;
 if p_name='bh_heartbeat' then maximum:=40;
 elsif p_name in ('bh_register','bh_start_round','bh_finish_round') then maximum:=20;
 end if;
 if not bughunt.consume_budget('rpc:'||p_name,u::text,maximum,60) then raise exception 'Rate limit exceeded'; end if;
end $$;

revoke all on function bughunt.check_rpc_budget(text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
