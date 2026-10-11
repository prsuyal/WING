create table public.wing_journey_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  trip_id uuid not null,
  flight_action_id uuid not null,
  kind text not null check(kind in ('ride','itinerary')),
  source_message_id uuid not null,
  approval_message_id uuid,
  trip_version integer not null,
  payload jsonb not null,
  terms_hash text not null check(length(terms_hash)=64),
  review_text text not null,
  status text not null default 'review' check(status in ('review','processing','unknown','confirmed','failed','superseded')),
  expires_at timestamptz not null default now()+interval '30 minutes',
  lease uuid,
  leased_until timestamptz,
  claimed_payload jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,source_message_id,kind),
  foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade,
  foreign key(owner_id,flight_action_id) references public.wing_flight_actions(owner_id,id),
  foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id),
  foreign key(owner_id,approval_message_id) references public.wing_messages(owner_id,id)
);
create unique index wing_journey_active_idx on public.wing_journey_actions(owner_id,trip_id,kind) where status in ('review','processing','unknown');
create unique index wing_journey_ride_once_idx on public.wing_journey_actions(owner_id,trip_id) where kind='ride' and status='confirmed';
create unique index wing_journey_itinerary_once_idx on public.wing_journey_actions(owner_id,trip_id,terms_hash) where kind='itinerary' and status='confirmed';
create index wing_journey_flight_idx on public.wing_journey_actions(owner_id,flight_action_id);
create index wing_journey_source_idx on public.wing_journey_actions(owner_id,source_message_id);
create index wing_journey_approval_idx on public.wing_journey_actions(owner_id,approval_message_id);
alter table public.wing_journey_actions enable row level security;
revoke all on public.wing_journey_actions from public,anon,authenticated;
grant all on public.wing_journey_actions to service_role;

create function public.wing_journey_terms_valid(p_owner uuid,p_action uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.wing_journey_actions; t public.wing_trips; c public.wing_calendar_connections; pay public.wing_demo_payments; loc text; src text; addr public.wing_addresses;
begin
  select * into a from public.wing_journey_actions where owner_id=p_owner and id=p_action;
  if not found then return false; end if;
  select * into t from public.wing_trips where owner_id=p_owner and id=a.trip_id;
  if not found or t.status not in ('booked','traveling','home') or not exists(select 1 from public.wing_flight_actions f join public.wing_flight_reservations r on r.owner_id=f.owner_id and r.action_id=f.id where f.owner_id=p_owner and f.id=a.flight_action_id and f.trip_id=a.trip_id and f.status='confirmed' and r.trip_id=a.trip_id and r.offer=f.offer) then return false; end if;
  if a.kind='ride' then
    select * into pay from public.wing_demo_payments where owner_id=p_owner for share;
    if t.pickup_override is not null then loc:=t.pickup_override->>'address'; src:='override:'||(t.pickup_override->>'sourceMessageId');
    else
      select * into addr from public.wing_addresses where owner_id=p_owner and kind='campus' and confirmed order by updated_at desc limit 1 for share;
      loc:=addr.address; src:='address:'||addr.id::text;
    end if;
    return t.version=a.trip_version and loc is not distinct from a.payload->>'pickup' and src is not distinct from a.payload->>'pickupSource' and pay.version=(a.payload->>'paymentVersion')::integer and pay.label=a.payload->>'paymentLabel' and (a.payload->>'pickupAt')::timestamptz>now() and a.payload->>'simulated'='true';
  end if;
  select * into c from public.wing_calendar_connections where owner_id=p_owner for share;
  return found and c.status='connected' and c.selection_version=(a.payload->>'selectionVersion')::integer and (a.payload->>'calendarId')=any(c.selected_ids) and (a.payload->>'rideActionId' is null or exists(select 1 from public.wing_journey_actions r where r.owner_id=p_owner and r.trip_id=a.trip_id and r.id=(a.payload->>'rideActionId')::uuid and r.kind='ride' and r.status='confirmed'));
end;
$$;

create function public.wing_review_journey(p_owner uuid,p_source uuid,p_trip uuid,p_flight uuid,p_kind text,p_payload jsonb,p_hash text,p_review text,p_id uuid,p_version integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare t public.wing_trips; a public.wing_journey_actions;
begin
  select * into t from public.wing_trips where owner_id=p_owner and id=p_trip for update;
  if not found or t.version<>p_version or t.status not in ('booked','traveling','home') then raise exception 'Trip unavailable or changed'; end if;
  if not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then raise exception 'Invalid source'; end if;
  select * into a from public.wing_journey_actions where owner_id=p_owner and source_message_id=p_source and kind=p_kind;
  if found then return a.id; end if;
  select * into a from public.wing_journey_actions where owner_id=p_owner and trip_id=p_trip and kind=p_kind and (status in ('processing','unknown') or (status='confirmed' and (p_kind='ride' or terms_hash=p_hash))) order by created_at desc limit 1;
  if found then return a.id; end if;
  select * into a from public.wing_journey_actions where owner_id=p_owner and trip_id=p_trip and kind=p_kind and status='review' and payload=p_payload order by created_at desc limit 1;
  if found and a.expires_at>now() then return a.id; end if;
  update public.wing_journey_actions set status='superseded' where owner_id=p_owner and trip_id=p_trip and kind=p_kind and status='review';
  insert into public.wing_journey_actions(id,owner_id,trip_id,flight_action_id,kind,source_message_id,trip_version,payload,terms_hash,review_text) values(p_id,p_owner,p_trip,p_flight,p_kind,p_source,p_version,p_payload,p_hash,p_review);
  if not public.wing_journey_terms_valid(p_owner,p_id) then raise exception 'Invalid journey terms'; end if;
  return p_id;
end;
$$;

create function public.wing_claim_journey(p_owner uuid,p_action uuid,p_source uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.wing_journey_actions; r public.wing_messages; t_id uuid;
begin
  select trip_id into t_id from public.wing_journey_actions where owner_id=p_owner and id=p_action;
  perform 1 from public.wing_trips where owner_id=p_owner and id=t_id for update;
  select * into a from public.wing_journey_actions where owner_id=p_owner and id=p_action for update;
  if not found then raise exception 'Action unavailable'; end if;
  if a.status='confirmed' or (a.status='processing' and a.leased_until>now()) then return false; end if;
  if a.status not in ('review','processing','unknown') or a.expires_at<=now() or not public.wing_journey_terms_valid(p_owner,p_action) then raise exception 'Terms changed or expired'; end if;
  select * into r from public.wing_messages where owner_id=p_owner and direction='outbound' order by created_at desc limit 1;
  if r.id is null or r.status is distinct from 'sent' or r.body->>'text' is distinct from a.review_text then raise exception 'Present exact review first'; end if;
  if p_source=a.source_message_id or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound' and created_at>=r.created_at) then raise exception 'Separate approval required'; end if;
  update public.wing_journey_actions set status='processing',lease=p_lease,leased_until=now()+interval '3 minutes',approval_message_id=p_source,claimed_payload=payload where owner_id=p_owner and id=p_action;
  return true;
end;
$$;

create function public.wing_finish_journey(p_owner uuid,p_action uuid,p_lease uuid,p_outcome text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.wing_journey_actions; t_id uuid;
begin
  select trip_id into t_id from public.wing_journey_actions where owner_id=p_owner and id=p_action;
  perform 1 from public.wing_trips where owner_id=p_owner and id=t_id for update;
  select * into a from public.wing_journey_actions where owner_id=p_owner and id=p_action for update;
  if not found then raise exception 'Action unavailable'; end if;
  if a.status='confirmed' then return true; end if;
  if a.status<>'processing' or a.lease is distinct from p_lease or a.leased_until<=now() or a.approval_message_id is null or a.payload is distinct from a.claimed_payload or a.expires_at<=now() or not public.wing_journey_terms_valid(p_owner,p_action) then raise exception 'Approved journey terms changed'; end if;
  if p_outcome not in ('confirmed','failed') or (p_outcome='failed' and a.kind<>'ride') then raise exception 'Invalid outcome'; end if;
  update public.wing_journey_actions set status=p_outcome,lease=null,leased_until=null where owner_id=p_owner and id=p_action;
  return true;
end;
$$;
revoke all on function public.wing_journey_terms_valid(uuid,uuid),public.wing_review_journey(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,integer),public.wing_claim_journey(uuid,uuid,uuid,uuid),public.wing_finish_journey(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.wing_journey_terms_valid(uuid,uuid),public.wing_review_journey(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid,integer),public.wing_claim_journey(uuid,uuid,uuid,uuid),public.wing_finish_journey(uuid,uuid,uuid,text) to service_role;
