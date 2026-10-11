create table public.wing_calendar_connections (
  owner_id uuid primary key references public.wing_users(id) on delete cascade,
  credentials_cipher text,
  status text not null default 'connected' check(status in ('connected','disconnected','error')),
  choices jsonb not null default '[]',
  selected_ids text[] not null default '{}',
  selection_version integer not null default 1,
  refreshed_at timestamptz,
  range_start timestamptz,
  range_end timestamptz,
  windows jsonb not null default '[]'
);
create table public.wing_calendar_links (
  token_hash text primary key,
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  source_message_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  state_hash text unique,
  browser_hash text,
  verifier_cipher text,
  foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id)
);
create index wing_calendar_links_owner_source_idx on public.wing_calendar_links(owner_id,source_message_id);
create table public.wing_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  source_message_id uuid not null,
  confirmation_message_id uuid,
  last_edit_message_id uuid not null,
  origin text not null check(origin in ('text','screenshot')),
  status text not null default 'candidate' check(status in ('candidate','confirmed','discarded')),
  version integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique(owner_id,source_message_id),
  foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id),
  foreign key(owner_id,confirmation_message_id) references public.wing_messages(owner_id,id),
  foreign key(owner_id,last_edit_message_id) references public.wing_messages(owner_id,id),
  check(status<>'confirmed' or confirmation_message_id is not null)
);
create index wing_schedules_owner_created_idx on public.wing_schedules(owner_id,created_at desc);
create index wing_schedules_owner_confirmation_idx on public.wing_schedules(owner_id,confirmation_message_id);
create table public.wing_calendar_actions (
  id uuid primary key,
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  source_message_id uuid not null,
  approval_message_id uuid,
  calendar_id text not null,
  selection_version integer not null,
  event_id text not null,
  event jsonb not null,
  review_text text not null,
  status text not null default 'review' check(status in ('review','processing','confirmed','failed','unknown')),
  leased_until timestamptz,
  created_at timestamptz not null default now(),
  unique(owner_id,source_message_id),
  unique(owner_id,event_id),
  foreign key(owner_id,source_message_id) references public.wing_messages(owner_id,id),
  foreign key(owner_id,approval_message_id) references public.wing_messages(owner_id,id)
);
create index wing_calendar_actions_owner_approval_idx on public.wing_calendar_actions(owner_id,approval_message_id);
alter table public.wing_calendar_connections enable row level security;
alter table public.wing_calendar_links enable row level security;
alter table public.wing_schedules enable row level security;
alter table public.wing_calendar_actions enable row level security;
revoke all on public.wing_calendar_connections,public.wing_calendar_links,public.wing_schedules,public.wing_calendar_actions from public,anon,authenticated;
grant all on public.wing_calendar_connections,public.wing_calendar_links,public.wing_schedules,public.wing_calendar_actions to service_role;
