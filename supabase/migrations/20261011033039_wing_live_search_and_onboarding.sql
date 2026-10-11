alter table public.wing_profiles add column onboarding jsonb not null default '{"introduced":false,"active":false,"skipped":[]}'::jsonb check(jsonb_typeof(onboarding)='object');
alter table public.wing_flight_actions drop constraint wing_flight_actions_offer_check;
alter table public.wing_flight_actions add constraint wing_flight_actions_offer_check check((offer->>'simulated'='true' and offer->>'inventoryVersion'='wing-demo-v1') or (offer->>'simulated'='false' and offer->>'inventoryVersion'='serpapi-v1'));

create table public.wing_search_cache (
 key text primary key check(length(key)=64), response jsonb not null, quoted_at timestamptz not null, expires_at timestamptz not null
);
create index wing_search_cache_expiry_idx on public.wing_search_cache(expires_at);
create table public.wing_search_usage (bucket text primary key, used integer not null check(used>=0));
alter table public.wing_search_cache enable row level security;
alter table public.wing_search_usage enable row level security;
revoke all on public.wing_search_cache,public.wing_search_usage from public,anon,authenticated;
grant all on public.wing_search_cache,public.wing_search_usage to service_role;

create function public.wing_use_search_request()
returns boolean language plpgsql security invoker set search_path='' as $$
declare month_key text; hour_key text; month_used integer; hour_used integer;
begin
 month_key:='month:'||to_char(now() at time zone 'UTC','YYYY-MM');
 hour_key:='hour:'||to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24');
 insert into public.wing_search_usage(bucket,used) values(month_key,0),(hour_key,0) on conflict do nothing;
 select used into month_used from public.wing_search_usage where bucket=month_key for update;
 select used into hour_used from public.wing_search_usage where bucket=hour_key for update;
 if month_used>=200 or hour_used>=40 then return false; end if;
 update public.wing_search_usage set used=used+1 where bucket in (month_key,hour_key);
 delete from public.wing_search_cache where expires_at<now();
 return true;
end;
$$;
revoke all on function public.wing_use_search_request() from public,anon,authenticated;
grant execute on function public.wing_use_search_request() to service_role;

create or replace function public.wing_begin_notice(p_owner uuid,p_notice uuid,p_lease uuid,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare n public.wing_notices; prefs public.wing_notify_state; w public.wing_watches; s public.wing_flight_searches; t public.wing_trips; m public.wing_messages; mid uuid; local_now timestamp; next_send timestamptz; price_version integer; profile_version integer;
begin
 insert into public.wing_notify_state(owner_id) values(p_owner) on conflict do nothing;
 select * into prefs from public.wing_notify_state where owner_id=p_owner for update;
 select * into n from public.wing_notices where owner_id=p_owner and id=p_notice;
 perform 1 from public.wing_watches where owner_id=p_owner and id=n.watch_id for update;
 select * into n from public.wing_notices where owner_id=p_owner and id=p_notice for update;
 if not found or n.status<>'claimed' or n.lease is distinct from p_lease or n.leased_until<=now() then return null; end if;
 select * into t from public.wing_trips where owner_id=p_owner and id=n.trip_id;
 if prefs.paused or n.expires_at<=now() or n.payload is distinct from p_payload or t.status='cancelled' or (n.watch_id is not null and t.status<>'planning') then update public.wing_notices set status='cancelled' where id=n.id; return null; end if;
 if n.watch_id is not null then
  select * into w from public.wing_watches where owner_id=p_owner and id=n.watch_id;
  select * into s from public.wing_flight_searches where owner_id=p_owner and id=w.search_id;
  select version into profile_version from public.wing_profiles where owner_id=p_owner;
  select version+1 into price_version from public.wing_demo_prices where owner_id=p_owner and trip_id=n.trip_id and comparison_key=w.comparison_key;
  if w.status<>'active' or not w.notify or w.observed_cents<>(n.payload->>'totalCents')::integer or w.observed_version<>(n.payload->>'offerVersion')::integer or (w.offer->>'simulated'='true' and coalesce(price_version,1)<>(n.payload->>'offerVersion')::integer) or t.version<>s.trip_version or profile_version<>s.profile_version then update public.wing_notices set status='cancelled' where id=n.id; return null; end if;
 end if;
 local_now:=now() at time zone n.time_zone;
 next_send:=now();
 if extract(hour from local_now)>=22 then next_send:=((local_now::date+1)+time '08:00') at time zone n.time_zone;
 elsif extract(hour from local_now)<8 then next_send:=(local_now::date+time '08:00') at time zone n.time_zone; end if;
 if prefs.last_started_at is not null then next_send:=greatest(next_send,prefs.last_started_at+interval '24 hours'); end if;
 if next_send>now() then update public.wing_notices set status='pending',due_at=next_send,lease=null,leased_until=null where id=n.id; return null; end if;
 select * into m from public.wing_messages where owner_id=p_owner and id=n.source_message_id and direction='inbound';
 if not found then raise exception 'Notification recipient unavailable'; end if;
 insert into public.wing_messages(owner_id,parent_id,space_id,provider_id,direction,body,status) values(p_owner,m.id,m.space_id,'notify_'||n.id::text,'outbound',jsonb_build_object('type','text','text',n.payload->>'text'),'prepared') returning id into mid;
 update public.wing_notices set status='sending',message_id=mid,leased_until=now()+interval '90 seconds' where id=n.id;
 update public.wing_notify_state set last_started_at=now() where owner_id=p_owner;
 if n.watch_id is not null then update public.wing_watches set anchor_cents=(n.payload->>'totalCents')::integer where owner_id=p_owner and id=n.watch_id; end if;
 return mid;
end;
$$;

