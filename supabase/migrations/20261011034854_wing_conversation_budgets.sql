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
    if v_field not in ('name','timeZone','school','schoolCity','departureAirport','homeCity','homeAirport','budgetCents','budgetMeaning','budgetMode','nonstop','baggage','cabin','notifications','arrivalPreference','arrivalAirport','outboundDate','returnDate','earliestDeparture','latestDeparture','minLayoverSavingsCents','allowMissedCommitments') then
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
