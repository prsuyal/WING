create table public.wing_demo_payments (
  owner_id uuid primary key references public.wing_users(id) on delete cascade,
  reference text not null unique,
  label text not null default 'Demo Visa •••• 4242 (fictional)',
  version integer not null default 1 check(version>0)
);
create table public.wing_flight_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  trip_id uuid not null,
  search_id uuid not null,
  source_message_id uuid not null,
  approval_message_id uuid,
  trip_version integer not null,
  profile_version integer not null,
  payment_version integer not null,
  option_number integer not null check(option_number between 1 and 3),
  offer jsonb not null check(offer->>'simulated'='true'),
  assumptions jsonb not null,
  conflicts jsonb not null,
  review_text text not null,
  expires_at timestamptz not null,
  status text not null default 'review' check(status in ('review','processing','confirmed','failed','unknown','superseded')),
  lease uuid,
  leased_until timestamptz,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,source_message_id),
  foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade,
  foreign key(owner_id,search_id) references public.wing_flight_searches(owner_id,id),
  foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id),
  foreign key(owner_id,approval_message_id) references public.wing_messages(owner_id,id)
);
create unique index wing_flight_actions_active_idx on public.wing_flight_actions(owner_id,trip_id) where status in ('review','processing','unknown');
create index wing_flight_actions_search_idx on public.wing_flight_actions(owner_id,search_id);
create index wing_flight_actions_approval_idx on public.wing_flight_actions(owner_id,approval_message_id);
create table public.wing_flight_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  trip_id uuid not null,
  action_id uuid not null,
  reference text not null unique,
  offer jsonb not null,
  payment_reference text not null,
  simulated boolean not null default true check(simulated),
  created_at timestamptz not null default now(),
  unique(owner_id,trip_id),
  unique(owner_id,action_id),
  foreign key(owner_id,trip_id) references public.wing_trips(owner_id,id) on delete cascade,
  foreign key(owner_id,action_id) references public.wing_flight_actions(owner_id,id)
);
alter table public.wing_demo_payments enable row level security;
alter table public.wing_flight_actions enable row level security;
alter table public.wing_flight_reservations enable row level security;
revoke all on public.wing_demo_payments,public.wing_flight_actions,public.wing_flight_reservations from public,anon,authenticated;
grant all on public.wing_demo_payments,public.wing_flight_actions,public.wing_flight_reservations to service_role;

create function public.wing_review_flight(p_owner uuid,p_source uuid,p_search uuid,p_option integer,p_id uuid,p_review text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.wing_flight_searches; t public.wing_trips; a public.wing_flight_actions; v_profile integer; v_payment integer; o jsonb;
begin
  select version into v_profile from public.wing_profiles where owner_id=p_owner for share;
  select * into s from public.wing_flight_searches where owner_id=p_owner and id=p_search;
  if not found or s.profile_version is distinct from v_profile or s.expires_at<=now() then raise exception 'Search stale'; end if;
  select * into t from public.wing_trips where owner_id=p_owner and id=s.trip_id for update;
  if not found or t.status<>'planning' or t.version<>s.trip_version then raise exception 'Trip stale'; end if;
  if not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then raise exception 'Invalid source'; end if;
  select * into a from public.wing_flight_actions where owner_id=p_owner and source_message_id=p_source;
  if found then return a.id; end if;
  if exists(select 1 from public.wing_flight_actions where owner_id=p_owner and trip_id=t.id and status in ('processing','unknown')) then raise exception 'Reconcile existing request first'; end if;
  o:=s.result->'options'->(p_option-1);
  if p_option<1 or p_option>3 or o is null or (o->'offer'->>'expiresAt')::timestamptz<=now() then raise exception 'Offer unavailable'; end if;
  if o->'offer'->>'ownerId'<>p_owner::text or o->'offer'->>'tripId'<>t.id::text then raise exception 'Offer scope mismatch'; end if;
  insert into public.wing_demo_payments(owner_id,reference) values(p_owner,'demo_'||p_owner::text) on conflict(owner_id) do nothing;
  select version into v_payment from public.wing_demo_payments where owner_id=p_owner;
  update public.wing_flight_actions set status='superseded' where owner_id=p_owner and trip_id=t.id and status='review';
  insert into public.wing_flight_actions(id,owner_id,trip_id,search_id,source_message_id,trip_version,profile_version,payment_version,option_number,offer,assumptions,conflicts,review_text,expires_at)
  values(p_id,p_owner,t.id,s.id,p_source,t.version,v_profile,v_payment,p_option,o->'offer',s.result->'assumptions',o->'conflicts',p_review,least(s.expires_at,(o->'offer'->>'expiresAt')::timestamptz));
  return p_id;
end;
$$;

create function public.wing_claim_flight(p_owner uuid,p_action uuid,p_source uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.wing_flight_actions; t public.wing_trips; v_profile integer; v_payment integer; r public.wing_messages; v_search uuid;
begin
  select version into v_profile from public.wing_profiles where owner_id=p_owner for share;
  select trip_id into v_search from public.wing_flight_actions where owner_id=p_owner and id=p_action;
  select * into t from public.wing_trips where owner_id=p_owner and id=v_search for update;
  select * into a from public.wing_flight_actions where owner_id=p_owner and id=p_action for update;
  if not found then raise exception 'Action unavailable'; end if;
  if a.status='confirmed' or (a.status='processing' and a.leased_until>now()) then return false; end if;
  if a.status not in ('review','unknown','processing') then raise exception 'Action no longer approvable'; end if;
  select version into v_payment from public.wing_demo_payments where owner_id=p_owner for share;
  select id into v_search from public.wing_flight_searches where owner_id=p_owner and trip_id=a.trip_id order by created_at desc limit 1;
  if t.status is distinct from 'planning' or t.version is distinct from a.trip_version or v_profile is distinct from a.profile_version or v_payment is distinct from a.payment_version or v_search is distinct from a.search_id or a.expires_at<=now() or a.offer is distinct from (select result->'options'->(a.option_number-1)->'offer' from public.wing_flight_searches where owner_id=p_owner and id=a.search_id) then raise exception 'Terms changed or expired'; end if;
  select * into r from public.wing_messages where owner_id=p_owner and direction='outbound' order by created_at desc limit 1;
  if r.status is distinct from 'sent' or r.body->>'text' is distinct from a.review_text or r.id is null then raise exception 'Present exact review first'; end if;
  if p_source=a.source_message_id or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound' and created_at>=r.created_at) then raise exception 'Separate approval required'; end if;
  update public.wing_flight_actions set status='processing',lease=p_lease,leased_until=now()+interval '2 minutes',approval_message_id=p_source where owner_id=p_owner and id=p_action;
  return true;
end;
$$;

-- The simulated provider and reservation commit together; an uncertain response is reconciled by action ID.
create function public.wing_demo_reserve_flight(p_owner uuid,p_action uuid,p_lease uuid,p_outcome text default 'confirmed')
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
revoke all on function public.wing_review_flight(uuid,uuid,uuid,integer,uuid,text),public.wing_claim_flight(uuid,uuid,uuid,uuid),public.wing_demo_reserve_flight(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.wing_review_flight(uuid,uuid,uuid,integer,uuid,text),public.wing_claim_flight(uuid,uuid,uuid,uuid),public.wing_demo_reserve_flight(uuid,uuid,uuid,text) to service_role;
