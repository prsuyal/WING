create table public.wing_profiles (
  owner_id uuid primary key references public.wing_users(id) on delete cascade,
  version integer not null default 1,
  facts jsonb not null default '{}',
  active_trip_id uuid,
  memory_evidence jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table public.wing_trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  title text not null check(length(title) between 1 and 100),
  purpose text not null check(length(purpose) between 1 and 200),
  facts jsonb not null default '{}',
  status text not null default 'planning' check(status in ('planning','selected','booked','traveling','home','cancelled')),
  pickup_override jsonb,
  version integer not null default 1,
  creation_message_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, id),
  unique(owner_id, creation_message_id, title),
  foreign key(owner_id, creation_message_id) references public.wing_messages(owner_id, id)
);
create index wing_trips_owner_created_idx on public.wing_trips(owner_id, created_at);
alter table public.wing_profiles add foreign key(owner_id, active_trip_id) references public.wing_trips(owner_id, id) on delete set null (active_trip_id);

create table public.wing_addresses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  kind text not null check(kind in ('campus','home')),
  address text not null check(length(address) between 5 and 500),
  confirmed boolean not null default false,
  source_message_id uuid not null,
  consent_message_id uuid,
  updated_at timestamptz not null default now(),
  unique(owner_id, source_message_id, kind, address),
  foreign key(owner_id, source_message_id) references public.wing_messages(owner_id, id),
  foreign key(owner_id, consent_message_id) references public.wing_messages(owner_id, id),
  check(not confirmed or consent_message_id is not null)
);
create index wing_addresses_owner_idx on public.wing_addresses(owner_id, updated_at desc);

create table public.wing_memory_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  source_message_id uuid not null,
  document_id text not null unique,
  content text not null,
  state text not null default 'pending' check(state in ('pending','processing','done')),
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  leased_until timestamptz,
  indexed_at timestamptz,
  foreign key(owner_id, source_message_id) references public.wing_messages(owner_id, id)
);
create index wing_memory_documents_due_idx on public.wing_memory_documents(due_at) where state <> 'done';

alter table public.wing_profiles enable row level security;
alter table public.wing_trips enable row level security;
alter table public.wing_addresses enable row level security;
alter table public.wing_memory_documents enable row level security;
revoke all on public.wing_profiles, public.wing_trips, public.wing_addresses, public.wing_memory_documents from public, anon, authenticated;
grant all on public.wing_profiles, public.wing_trips, public.wing_addresses, public.wing_memory_documents to service_role;

create function public.wing_patch_facts(p_owner uuid, p_source uuid, p_patch jsonb, p_status text, p_trip uuid default null, p_version integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_facts jsonb; v_version integer; v_field text; v_value jsonb; v_fact jsonb;
begin
  if p_status not in ('confirmed','tentative') or jsonb_typeof(p_patch) <> 'object' or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then
    raise exception 'Invalid fact source';
  end if;
  if p_trip is null then
    insert into public.wing_profiles(owner_id) values(p_owner) on conflict do nothing;
    select facts,version into v_facts,v_version from public.wing_profiles where owner_id=p_owner for update;
  else
    select facts,version into v_facts,v_version from public.wing_trips where owner_id=p_owner and id=p_trip for update;
    if not found or v_version <> p_version then raise exception 'Trip unavailable or changed; reload before editing'; end if;
  end if;
  for v_field,v_value in select key,value from jsonb_each(p_patch) loop
    if v_field not in ('name','timeZone','school','schoolCity','departureAirport','homeCity','homeAirport','budgetCents','budgetMeaning','nonstop','baggage','cabin','notifications','arrivalPreference','outboundDate','returnDate','earliestDeparture','latestDeparture','allowMissedCommitments') then
      raise exception 'Unsupported fact';
    end if;
    v_fact := jsonb_build_object('value',v_value,'sourceMessageId',p_source,'updatedAt',now());
    v_facts := jsonb_set(v_facts,array[v_field],case when p_status='confirmed' then jsonb_build_object('confirmed',v_fact)
      else coalesce(v_facts->v_field,'{}')||jsonb_build_object('tentative',v_fact) end);
  end loop;
  v_version := v_version+1;
  if p_trip is null then
    update public.wing_profiles set facts=v_facts,version=v_version,updated_at=now() where owner_id=p_owner;
  else
    update public.wing_trips set facts=v_facts,version=v_version,updated_at=now() where owner_id=p_owner and id=p_trip;
  end if;
  if p_status='confirmed' then
    insert into public.wing_memory_documents(owner_id,source_message_id,document_id,content)
    values(p_owner,p_source,'facts_'||coalesce(p_trip::text,p_owner::text)||'_'||v_version,
      jsonb_build_object('currentTravelFacts',p_patch,'tripId',p_trip,'version',v_version)::text);
  end if;
  return jsonb_build_object('facts',v_facts,'version',v_version);
end;
$$;
revoke all on function public.wing_patch_facts(uuid,uuid,jsonb,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.wing_patch_facts(uuid,uuid,jsonb,text,uuid,integer) to service_role;

create function public.wing_claim_memory(p_owner uuid default null)
returns setof public.wing_memory_documents language sql security invoker set search_path='' as $$
  with due as (
    select d.id from public.wing_memory_documents d join public.wing_messages m on m.id=d.source_message_id and m.owner_id=d.owner_id
    where m.status='handled' and (p_owner is null or d.owner_id=p_owner)
      and ((d.state='pending' and d.due_at<=now()) or (d.state='processing' and d.leased_until<now()))
    order by d.due_at limit 5 for update of d skip locked
  )
  update public.wing_memory_documents d set state='processing',leased_until=now()+interval '5 minutes',attempts=attempts+1
    from due where d.id=due.id returning d.*;
$$;
revoke all on function public.wing_claim_memory(uuid) from public,anon,authenticated;
grant execute on function public.wing_claim_memory(uuid) to service_role;
