create table public.wing_flight_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  trip_id uuid not null,
  source_message_id uuid not null,
  trip_version integer not null check(trip_version>0),
  profile_version integer not null check(profile_version>0),
  request_key text not null check(length(request_key)=64),
  request jsonb not null check(jsonb_typeof(request)='object'),
  result jsonb not null check(jsonb_typeof(result)='object' and jsonb_typeof(result->'options')='array' and jsonb_array_length(result->'options')<=3),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,trip_id,source_message_id,request_key),
  foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade,
  foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id)
);
create index wing_flight_searches_owner_trip_created_idx on public.wing_flight_searches(owner_id,trip_id,created_at desc);
create index wing_flight_searches_owner_source_idx on public.wing_flight_searches(owner_id,source_message_id);
alter table public.wing_flight_searches enable row level security;
revoke all on public.wing_flight_searches from public,anon,authenticated;
grant all on public.wing_flight_searches to service_role;

create function public.wing_save_flight_search(p_owner uuid,p_source uuid,p_trip uuid,p_trip_version integer,p_profile_version integer,p_key text,p_request jsonb,p_result jsonb,p_expires timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_profile integer; v_trip integer; v_id uuid;
begin
  select version into v_profile from public.wing_profiles where owner_id=p_owner for share;
  if not found or v_profile<>p_profile_version then raise exception 'Profile changed'; end if;
  select version into v_trip from public.wing_trips where owner_id=p_owner and id=p_trip and status='planning' for share;
  if not found or v_trip<>p_trip_version then raise exception 'Trip changed or unavailable'; end if;
  if not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then raise exception 'Invalid search source'; end if;
  if p_expires<=now() or p_expires>now()+interval '16 minutes' then raise exception 'Invalid search expiry'; end if;
  insert into public.wing_flight_searches(owner_id,trip_id,source_message_id,trip_version,profile_version,request_key,request,result,expires_at)
  values(p_owner,p_trip,p_source,p_trip_version,p_profile_version,p_key,p_request,p_result,p_expires)
  on conflict(owner_id,trip_id,source_message_id,request_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.wing_flight_searches where owner_id=p_owner and trip_id=p_trip and source_message_id=p_source and request_key=p_key; end if;
  return v_id;
end;
$$;
revoke all on function public.wing_save_flight_search(uuid,uuid,uuid,integer,integer,text,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.wing_save_flight_search(uuid,uuid,uuid,integer,integer,text,jsonb,jsonb,timestamptz) to service_role;

create or replace function public.wing_patch_facts(p_owner uuid, p_source uuid, p_patch jsonb, p_status text, p_trip uuid default null, p_version integer default null)
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
    if v_field not in ('name','timeZone','school','schoolCity','departureAirport','homeCity','homeAirport','budgetCents','budgetMeaning','nonstop','baggage','cabin','notifications','arrivalPreference','arrivalAirport','outboundDate','returnDate','earliestDeparture','latestDeparture','minLayoverSavingsCents','allowMissedCommitments') then
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

