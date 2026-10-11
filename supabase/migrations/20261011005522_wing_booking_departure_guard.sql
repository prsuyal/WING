create or replace function public.wing_demo_reserve_flight(p_owner uuid,p_action uuid,p_lease uuid,p_outcome text default 'confirmed')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.wing_flight_actions; t public.wing_trips; v_profile integer; v_search uuid; pay public.wing_demo_payments; reservation public.wing_flight_reservations;
begin
  select version into v_profile from public.wing_profiles where owner_id=p_owner for share;
  select trip_id into t.id from public.wing_flight_actions where owner_id=p_owner and id=p_action;
  select * into t from public.wing_trips where owner_id=p_owner and id=t.id for update;
  select * into a from public.wing_flight_actions where owner_id=p_owner and id=p_action for update;
  if not found then raise exception 'Action unavailable'; end if;
  select * into reservation from public.wing_flight_reservations where owner_id=p_owner and action_id=p_action;
  if found then return jsonb_build_object('status','confirmed','reference',reservation.reference,'simulated',true); end if;
  select * into pay from public.wing_demo_payments where owner_id=p_owner for share;
  if a.status<>'processing' or a.lease is distinct from p_lease or a.leased_until<=now() or a.approval_message_id is null then raise exception 'Approval lease unavailable'; end if;
  select id into v_search from public.wing_flight_searches where owner_id=p_owner and trip_id=a.trip_id order by created_at desc limit 1;
  if (a.offer->'outbound'->0->>'departsAt')::timestamptz<=now() then raise exception 'Departure passed'; end if;
  if t.status is distinct from 'planning' or t.version is distinct from a.trip_version or v_profile is distinct from a.profile_version or pay.version is distinct from a.payment_version or v_search is distinct from a.search_id or a.expires_at<=now() or a.offer is distinct from (select result->'options'->(a.option_number-1)->'offer' from public.wing_flight_searches where owner_id=p_owner and id=a.search_id) then raise exception 'Terms changed or expired'; end if;
  if p_outcome='failed' then
    update public.wing_flight_actions set status='failed',lease=null,leased_until=null where owner_id=p_owner and id=p_action;
    return jsonb_build_object('status','failed','simulated',true);
  end if;
  if p_outcome<>'confirmed' then raise exception 'Invalid simulated outcome'; end if;
  insert into public.wing_flight_reservations(owner_id,trip_id,action_id,reference,offer,payment_reference)
  values(p_owner,t.id,a.id,'DEMO-'||upper(replace(a.id::text,'-','')),a.offer,pay.reference) returning * into reservation;
  update public.wing_flight_actions set status='confirmed',lease=null,leased_until=null where owner_id=p_owner and id=p_action;
  update public.wing_trips set status='booked',version=version+1,updated_at=now() where owner_id=p_owner and id=t.id;
  return jsonb_build_object('status','confirmed','reference',reservation.reference,'simulated',true);
end;
$$;
