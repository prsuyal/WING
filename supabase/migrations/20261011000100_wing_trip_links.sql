-- Minimal phase 6 sharing for phase 1 planning data. No bookings or tracking.
create table public.wing_trip_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  trip_id uuid not null,
  source_message_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, trip_id) references public.wing_trips(owner_id, id) on delete cascade,
  foreign key (owner_id, source_message_id) references public.wing_messages(owner_id, id),
  check (expires_at > created_at)
);
create index wing_trip_links_owner_trip_idx on public.wing_trip_links(owner_id, trip_id);
alter table public.wing_trip_links enable row level security;
revoke all on public.wing_trip_links from public, anon, authenticated;
grant all on public.wing_trip_links to service_role;
