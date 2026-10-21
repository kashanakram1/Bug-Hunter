-- Server-side expiry continues while every browser is closed.
create extension if not exists pg_cron with schema pg_catalog;
revoke all on schema cron from public,anon,authenticated,service_role;
select cron.schedule('bughunt-round4-expiry','* * * * *','select bughunt.expire_round4();');
