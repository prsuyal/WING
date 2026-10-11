-- Match ride pickup resolution: trip override, confirmed campus, then confirmed home.
-- Preserve the existing ownership, booking, approval, payment and time checks.
create or replace function public.wing_journey_terms_valid(p_owner uuid,p_action uuid)
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
      if not found then
        select * into addr from public.wing_addresses where owner_id=p_owner and kind='home' and confirmed order by updated_at desc limit 1 for share;
      end if;
      loc:=addr.address; src:='address:'||addr.id::text;
    end if;
    return t.version=a.trip_version and loc is not distinct from a.payload->>'pickup' and src is not distinct from a.payload->>'pickupSource' and pay.version=(a.payload->>'paymentVersion')::integer and pay.label=a.payload->>'paymentLabel' and (a.payload->>'pickupAt')::timestamptz>now() and a.payload->>'simulated'='true';
  end if;
  select * into c from public.wing_calendar_connections where owner_id=p_owner for share;
  return found and c.status='connected' and c.selection_version=(a.payload->>'selectionVersion')::integer and (a.payload->>'calendarId')=any(c.selected_ids) and (a.payload->>'rideActionId' is null or exists(select 1 from public.wing_journey_actions r where r.owner_id=p_owner and r.trip_id=a.trip_id and r.id=(a.payload->>'rideActionId')::uuid and r.kind='ride' and r.status='confirmed'));
end;
$$;
