-- Background dispatch waits for the conversation request to finish; owner-scoped verification uses a captured transport.
create or replace function public.wing_claim_jobs(p_owner uuid default null)
returns setof public.wing_jobs language sql security invoker set search_path='' as $$
 with due as (select id from public.wing_jobs where (p_owner is null or owner_id=p_owner) and (p_owner is not null or exists(select 1 from public.wing_messages m where m.owner_id=wing_jobs.owner_id and m.id=wing_jobs.source_message_id and m.status='handled')) and ((status='pending' and due_at<=now()) or (status='processing' and leased_until<now())) order by due_at limit 5 for update skip locked)
 update public.wing_jobs j set status='processing',lease=gen_random_uuid(),leased_until=now()+interval '3 minutes',attempts=attempts+1 from due where j.id=due.id returning j.*;
$$;

create or replace function public.wing_claim_notices(p_owner uuid default null)
returns setof public.wing_notices language plpgsql security invoker set search_path='' as $$
begin
 -- Once a send may have started, lease recovery must never resend it.
 update public.wing_messages m set status='delivery_unknown' from public.wing_notices n where n.message_id=m.id and n.owner_id=m.owner_id and n.status='sending' and n.leased_until<now() and (p_owner is null or n.owner_id=p_owner);
 update public.wing_notices set status='unknown',lease=null,leased_until=null where status='sending' and leased_until<now() and (p_owner is null or owner_id=p_owner);
 update public.wing_notices set status='cancelled' where status in ('pending','claimed') and expires_at<=now() and (p_owner is null or owner_id=p_owner);
 return query with due as (select id from public.wing_notices where (p_owner is null or owner_id=p_owner) and (p_owner is not null or exists(select 1 from public.wing_messages m where m.owner_id=wing_notices.owner_id and m.id=wing_notices.source_message_id and m.status='handled')) and ((status='pending' and due_at<=now()) or (status='claimed' and leased_until<now())) order by due_at limit 5 for update skip locked)
 update public.wing_notices n set status='claimed',lease=gen_random_uuid(),leased_until=now()+interval '90 seconds',attempts=attempts+1 from due where n.id=due.id returning n.*;
end;
$$;
