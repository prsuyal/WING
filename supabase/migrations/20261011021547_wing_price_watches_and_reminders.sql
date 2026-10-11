create table public.wing_demo_prices (
 owner_id uuid not null references public.wing_users(id) on delete cascade, trip_id uuid not null, comparison_key text not null, delta_cents integer not null, version integer not null default 1 check(version>0), updated_at timestamptz not null default now(),
 primary key(owner_id,trip_id,comparison_key), foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade
);
alter table public.wing_users add column demo_enabled boolean not null default false;
update public.wing_users u set demo_enabled=true where exists(select 1 from public.wing_calendar_connections c where c.owner_id=u.id and c.status='connected' and cardinality(c.selected_ids)>0 and not exists(select 1 from unnest(c.selected_ids) s where s like 'synthetic%'));
create table public.wing_notify_state (
 owner_id uuid primary key references public.wing_users(id) on delete cascade, paused boolean not null default false, last_started_at timestamptz
);
create table public.wing_watches (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.wing_users(id) on delete cascade, trip_id uuid not null, search_id uuid not null, source_message_id uuid not null,
 comparison_key text not null, offer jsonb not null, mode text not null check(mode in ('target','drop')), target_cents integer, minimum_drop_cents integer not null check(minimum_drop_cents>=100), anchor_cents integer not null, observed_cents integer not null, observed_version integer not null,
 notify boolean not null, time_zone text not null, status text not null default 'active' check(status in ('active','stopped','changed')), checked_at timestamptz, created_at timestamptz not null default now(),
 unique(owner_id,id), foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade, foreign key(owner_id,search_id) references public.wing_flight_searches(owner_id,id), foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id), check((mode='target' and target_cents>0) or (mode='drop' and target_cents is null))
);
create unique index wing_watch_active_idx on public.wing_watches(owner_id,trip_id) where status='active';
create index wing_watch_search_idx on public.wing_watches(owner_id,search_id);
create index wing_watch_source_idx on public.wing_watches(owner_id,source_message_id);
create table public.wing_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.wing_users(id) on delete cascade, trip_id uuid not null, watch_id uuid, source_message_id uuid not null,
 kind text not null check(kind in ('watch','reminder')), key text not null, payload jsonb not null default '{}', due_at timestamptz not null, status text not null default 'pending' check(status in ('pending','processing','done','cancelled')), lease uuid, leased_until timestamptz, attempts integer not null default 0,
 unique(owner_id,key), foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade, foreign key(owner_id,watch_id) references public.wing_watches(owner_id,id) on delete cascade, foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id), check((kind='watch')=(watch_id is not null))
);
create index wing_jobs_due_idx on public.wing_jobs(due_at) where status in ('pending','processing');
create index wing_jobs_trip_idx on public.wing_jobs(owner_id,trip_id);
create index wing_jobs_watch_idx on public.wing_jobs(owner_id,watch_id);
create index wing_jobs_source_idx on public.wing_jobs(owner_id,source_message_id);
create table public.wing_notices (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.wing_users(id) on delete cascade, trip_id uuid not null, job_id uuid not null references public.wing_jobs(id) on delete cascade, watch_id uuid, source_message_id uuid not null,
 payload jsonb not null, time_zone text not null, due_at timestamptz not null default now(), expires_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','claimed','sending','sent','unknown','cancelled')), lease uuid, leased_until timestamptz, message_id uuid, attempts integer not null default 0, created_at timestamptz not null default now(),
 foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade, foreign key(owner_id,watch_id) references public.wing_watches(owner_id,id) on delete cascade, foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id), foreign key(owner_id,message_id) references public.wing_messages(owner_id,id)
);
create unique index wing_notice_watch_active_idx on public.wing_notices(owner_id,watch_id) where watch_id is not null and status in ('pending','claimed','sending');
create unique index wing_notice_reminder_once_idx on public.wing_notices(job_id) where watch_id is null and status<>'cancelled';
create index wing_notices_due_idx on public.wing_notices(due_at) where status in ('pending','claimed','sending');
create index wing_notices_trip_idx on public.wing_notices(owner_id,trip_id);
create index wing_notices_watch_idx on public.wing_notices(owner_id,watch_id);
create index wing_notices_source_idx on public.wing_notices(owner_id,source_message_id);
create index wing_notices_message_idx on public.wing_notices(owner_id,message_id);
alter table public.wing_demo_prices enable row level security;
alter table public.wing_notify_state enable row level security;
alter table public.wing_watches enable row level security;
alter table public.wing_jobs enable row level security;
alter table public.wing_notices enable row level security;
revoke all on public.wing_demo_prices,public.wing_notify_state,public.wing_watches,public.wing_jobs,public.wing_notices from public,anon,authenticated;
grant all on public.wing_demo_prices,public.wing_notify_state,public.wing_watches,public.wing_jobs,public.wing_notices to service_role;

create function public.wing_save_watch(p_owner uuid,p_trip uuid,p_search uuid,p_source uuid,p_offer jsonb,p_mode text,p_target integer,p_drop integer,p_notify boolean,p_zone text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.wing_flight_searches; t public.wing_trips; w public.wing_watches; v_profile integer; wid uuid;
begin
 select version into v_profile from public.wing_profiles where owner_id=p_owner for share;
 select * into t from public.wing_trips where owner_id=p_owner and id=p_trip for update;
 select * into s from public.wing_flight_searches where owner_id=p_owner and id=p_search and trip_id=p_trip;
 if not found or t.status is distinct from 'planning' or t.version is distinct from s.trip_version or v_profile is distinct from s.profile_version or s.expires_at<=now() or not exists(select 1 from jsonb_array_elements(s.result->'options') o where o->'offer'=p_offer) or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then raise exception 'Current owned search required'; end if;
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

create function public.wing_claim_jobs(p_owner uuid default null)
returns setof public.wing_jobs language sql security invoker set search_path='' as $$
 with due as (select id from public.wing_jobs where (p_owner is null or owner_id=p_owner) and ((status='pending' and due_at<=now()) or (status='processing' and leased_until<now())) order by due_at limit 5 for update skip locked)
 update public.wing_jobs j set status='processing',lease=gen_random_uuid(),leased_until=now()+interval '3 minutes',attempts=attempts+1 from due where j.id=due.id returning j.*;
$$;

create function public.wing_observe_watch(p_owner uuid,p_watch uuid,p_job uuid,p_lease uuid,p_price integer,p_version integer,p_text text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.wing_watches; n public.wing_notices; qualifies boolean;
begin
 perform 1 from public.wing_notify_state where owner_id=p_owner for update;
 select * into w from public.wing_watches where owner_id=p_owner and id=p_watch for update;
 if not found or w.status<>'active' or not exists(select 1 from public.wing_jobs where owner_id=p_owner and id=p_job and watch_id=p_watch and status='processing' and lease=p_lease and leased_until>now()) then return false; end if;
 qualifies:=case when w.mode='drop' then p_price<=w.anchor_cents-w.minimum_drop_cents else p_price<=w.target_cents and (w.anchor_cents>w.target_cents or p_price<=w.anchor_cents-w.minimum_drop_cents) end;
 update public.wing_watches set observed_cents=p_price,observed_version=p_version,checked_at=now() where owner_id=p_owner and id=p_watch;
 if qualifies and w.notify and not exists(select 1 from public.wing_notify_state where owner_id=p_owner and paused) then
  select * into n from public.wing_notices where owner_id=p_owner and watch_id=p_watch and status in ('pending','claimed','sending') for update;
  if found then
   if n.status='pending' then update public.wing_notices set payload=jsonb_build_object('text',p_text,'totalCents',p_price,'offerVersion',p_version),expires_at=now()+interval '15 minutes' where id=n.id; end if;
  else
   insert into public.wing_notices(owner_id,trip_id,job_id,watch_id,source_message_id,payload,time_zone,expires_at) values(p_owner,w.trip_id,p_job,p_watch,w.source_message_id,jsonb_build_object('text',p_text,'totalCents',p_price,'offerVersion',p_version),w.time_zone,now()+interval '15 minutes');
  end if;
 end if;
 return qualifies;
end;
$$;

create function public.wing_claim_notices(p_owner uuid default null)
returns setof public.wing_notices language plpgsql security invoker set search_path='' as $$
begin
 -- Once a send may have started, lease recovery must never resend it.
 update public.wing_messages m set status='delivery_unknown' from public.wing_notices n where n.message_id=m.id and n.owner_id=m.owner_id and n.status='sending' and n.leased_until<now();
 update public.wing_notices set status='unknown',lease=null,leased_until=null where status='sending' and leased_until<now();
 update public.wing_notices set status='cancelled' where status in ('pending','claimed') and expires_at<=now();
 return query with due as (select id from public.wing_notices where (p_owner is null or owner_id=p_owner) and ((status='pending' and due_at<=now()) or (status='claimed' and leased_until<now())) order by due_at limit 5 for update skip locked)
 update public.wing_notices n set status='claimed',lease=gen_random_uuid(),leased_until=now()+interval '90 seconds',attempts=attempts+1 from due where n.id=due.id returning n.*;
end;
$$;

create function public.wing_begin_notice(p_owner uuid,p_notice uuid,p_lease uuid,p_payload jsonb)
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
  if w.status<>'active' or not w.notify or w.observed_cents<>(n.payload->>'totalCents')::integer or w.observed_version<>(n.payload->>'offerVersion')::integer or coalesce(price_version,1)<>(n.payload->>'offerVersion')::integer or t.version<>s.trip_version or profile_version<>s.profile_version then update public.wing_notices set status='cancelled' where id=n.id; return null; end if;
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

create function public.wing_stop_notifications(p_owner uuid,p_source uuid,p_trip uuid default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') or (p_trip is not null and not exists(select 1 from public.wing_trips where owner_id=p_owner and id=p_trip)) then raise exception 'Invalid stop scope'; end if;
 if p_trip is null then insert into public.wing_notify_state(owner_id,paused) values(p_owner,true) on conflict(owner_id) do update set paused=true; end if;
 update public.wing_watches set status='stopped' where owner_id=p_owner and (p_trip is null or trip_id=p_trip) and status='active';
 update public.wing_jobs set status='cancelled',lease=null,leased_until=null where owner_id=p_owner and (p_trip is null or trip_id=p_trip) and status in ('pending','processing');
 update public.wing_notices set status='cancelled',lease=null,leased_until=null where owner_id=p_owner and (p_trip is null or trip_id=p_trip) and status in ('pending','claimed');
 return true;
end;
$$;
revoke all on function public.wing_save_watch(uuid,uuid,uuid,uuid,jsonb,text,integer,integer,boolean,text),public.wing_claim_jobs(uuid),public.wing_observe_watch(uuid,uuid,uuid,uuid,integer,integer,text),public.wing_claim_notices(uuid),public.wing_begin_notice(uuid,uuid,uuid,jsonb),public.wing_stop_notifications(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.wing_save_watch(uuid,uuid,uuid,uuid,jsonb,text,integer,integer,boolean,text),public.wing_claim_jobs(uuid),public.wing_observe_watch(uuid,uuid,uuid,uuid,integer,integer,text),public.wing_claim_notices(uuid),public.wing_begin_notice(uuid,uuid,uuid,jsonb),public.wing_stop_notifications(uuid,uuid,uuid) to service_role;

create function public.wing_save_reminders(p_owner uuid,p_trip uuid,p_source uuid,p_payloads jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb; added integer:=0; n integer;
begin
 perform 1 from public.wing_trips where owner_id=p_owner and id=p_trip and status in ('booked','traveling') for update;
 if not found or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') or jsonb_array_length(p_payloads)<>2 then raise exception 'Booked trip and reminder request required'; end if;
 insert into public.wing_notify_state(owner_id,paused) values(p_owner,false) on conflict(owner_id) do update set paused=false;
 for item in select value from jsonb_array_elements(p_payloads) loop
  if not exists(select 1 from public.wing_flight_reservations where owner_id=p_owner and trip_id=p_trip and action_id=(item->>'flightActionId')::uuid) then raise exception 'Reminder booking mismatch'; end if;
  insert into public.wing_jobs(owner_id,trip_id,source_message_id,kind,key,payload,due_at) values(p_owner,p_trip,p_source,'reminder',item->>'key',item,(item->>'dueAt')::timestamptz)
  on conflict(owner_id,key) do update set status='pending',source_message_id=p_source,payload=excluded.payload,due_at=excluded.due_at,lease=null,leased_until=null where public.wing_jobs.status='cancelled' and not exists(select 1 from public.wing_notices where job_id=public.wing_jobs.id and status in ('sending','sent','unknown'));
  get diagnostics n=row_count; added:=added+n;
 end loop;
 return added;
end;
$$;
revoke all on function public.wing_save_reminders(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wing_save_reminders(uuid,uuid,uuid,jsonb) to service_role;
