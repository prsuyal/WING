create or replace function public.wing_change_demo_price(p_owner uuid,p_trip uuid,p_source uuid,p_key text,p_delta integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.wing_users where id=p_owner and demo_enabled) or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then raise exception 'Demo account required'; end if;
 perform 1 from public.wing_trips where owner_id=p_owner and id=p_trip and status='planning' for update;
 if not found or not exists(select 1 from public.wing_watches where owner_id=p_owner and trip_id=p_trip and comparison_key=p_key and status='active') then raise exception 'Owned active watch required'; end if;
 insert into public.wing_demo_prices(owner_id,trip_id,comparison_key,delta_cents) values(p_owner,p_trip,p_key,p_delta) on conflict(owner_id,trip_id,comparison_key) do update set delta_cents=p_delta,version=public.wing_demo_prices.version+1,updated_at=now();
 update public.wing_jobs set due_at=now(),payload=case when status='processing' then payload||jsonb_build_object('recheck',true) else payload-'recheck' end where owner_id=p_owner and trip_id=p_trip and kind='watch' and status in ('pending','processing');
 return true;
end;
$$;

create or replace function public.wing_claim_notices(p_owner uuid default null)
returns setof public.wing_notices language plpgsql security invoker set search_path='' as $$
begin
 -- Once a send may have started, lease recovery must never resend it.
 update public.wing_messages m set status='delivery_unknown' from public.wing_notices n where n.message_id=m.id and n.owner_id=m.owner_id and n.status='sending' and n.leased_until<now() and (p_owner is null or n.owner_id=p_owner);
 update public.wing_notices set status='unknown',lease=null,leased_until=null where status='sending' and leased_until<now() and (p_owner is null or owner_id=p_owner);
 update public.wing_notices set status='cancelled' where status in ('pending','claimed') and expires_at<=now() and (p_owner is null or owner_id=p_owner);
 return query with due as (select id from public.wing_notices where (p_owner is null or owner_id=p_owner) and ((status='pending' and due_at<=now()) or (status='claimed' and leased_until<now())) order by due_at limit 5 for update skip locked)
 update public.wing_notices n set status='claimed',lease=gen_random_uuid(),leased_until=now()+interval '90 seconds',attempts=attempts+1 from due where n.id=due.id returning n.*;
end;
$$;

create or replace function public.wing_save_watch(p_owner uuid,p_trip uuid,p_search uuid,p_source uuid,p_offer jsonb,p_mode text,p_target integer,p_drop integer,p_notify boolean,p_zone text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.wing_flight_searches; t public.wing_trips; w public.wing_watches; v_profile integer; wid uuid;
begin
 insert into public.wing_notify_state(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from public.wing_notify_state where owner_id=p_owner for update;
 select version into v_profile from public.wing_profiles where owner_id=p_owner for share;
 select * into t from public.wing_trips where owner_id=p_owner and id=p_trip for update;
 select * into s from public.wing_flight_searches where owner_id=p_owner and id=p_search and trip_id=p_trip;
 if not found or t.status is distinct from 'planning' or t.version is distinct from s.trip_version or v_profile is distinct from s.profile_version or s.expires_at<=now() or not exists(select 1 from jsonb_array_elements(s.result->'options') o where o->'offer'=p_offer) or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') or not exists(select 1 from public.wing_messages where owner_id=p_owner and parent_id=s.source_message_id and direction='outbound' and status='sent' and body->>'text'=s.request->>'presentation') then raise exception 'Current owned search required'; end if;
 select * into w from public.wing_watches where owner_id=p_owner and trip_id=p_trip and source_message_id=p_source;
 if found then return w.id; end if;
 update public.wing_watches set status='stopped' where owner_id=p_owner and trip_id=p_trip and status='active';
 update public.wing_jobs set status='cancelled' where owner_id=p_owner and trip_id=p_trip and kind='watch' and status in ('pending','processing');
 update public.wing_notices set status='cancelled' where owner_id=p_owner and trip_id=p_trip and watch_id is not null and status in ('pending','claimed');
 insert into public.wing_watches(owner_id,trip_id,search_id,source_message_id,comparison_key,offer,mode,target_cents,minimum_drop_cents,anchor_cents,observed_cents,observed_version,notify,time_zone) values(p_owner,p_trip,p_search,p_source,p_offer->>'comparisonKey',p_offer,p_mode,p_target,p_drop,(p_offer->>'totalCents')::integer,(p_offer->>'totalCents')::integer,(p_offer->>'version')::integer,p_notify,p_zone) returning id into wid;
 insert into public.wing_notify_state(owner_id,paused) values(p_owner,false) on conflict(owner_id) do update set paused=case when p_notify then false else public.wing_notify_state.paused end;
 insert into public.wing_jobs(owner_id,trip_id,watch_id,source_message_id,kind,key,due_at) values(p_owner,p_trip,wid,p_source,'watch','watch:'||wid::text,now()+interval '6 hours');
 return wid;
end;
$$;
