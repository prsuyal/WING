create table public.wing_users (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique check (identity_key ~ '^wing_user_[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create table public.wing_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.wing_users(id) on delete cascade,
  space_id text not null,
  provider_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body jsonb not null,
  status text not null check (status in ('processing', 'prepared', 'sent', 'handled', 'failed', 'delivery_unknown')),
  parent_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, space_id, provider_id, direction),
  foreign key (owner_id, parent_id) references public.wing_messages(owner_id, id)
);
create index wing_messages_owner_created_idx on public.wing_messages(owner_id, created_at);

alter table public.wing_users enable row level security;
alter table public.wing_messages enable row level security;
revoke all on public.wing_users, public.wing_messages from public, anon, authenticated;
grant all on public.wing_users, public.wing_messages to service_role;

create function public.wing_receive_message(p_identity_key text, p_space_id text, p_provider_id text, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid;
  v_message uuid;
  v_new boolean;
begin
  if length(p_space_id) not between 1 and 512 or length(p_provider_id) not between 1 and 512
    or p_body is null or jsonb_typeof(p_body) <> 'object' or coalesce(p_body->>'type', '') not in ('text', 'attachment') then
    raise exception 'Invalid inbound message';
  end if;
  insert into public.wing_users(identity_key) values (p_identity_key)
    on conflict(identity_key) do update set identity_key = excluded.identity_key returning id into v_owner;
  insert into public.wing_messages(owner_id, space_id, provider_id, direction, body, status)
    values (v_owner, p_space_id, p_provider_id, 'inbound', p_body, 'processing')
    on conflict(owner_id, space_id, provider_id, direction) do nothing returning id into v_message;
  v_new := v_message is not null;
  if not v_new then
    select id into v_message from public.wing_messages
      where owner_id = v_owner and space_id = p_space_id and provider_id = p_provider_id and direction = 'inbound';
  end if;
  return jsonb_build_object('userId', v_owner, 'messageId', v_message, 'isNew', v_new);
end;
$$;
revoke all on function public.wing_receive_message(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.wing_receive_message(text, text, text, jsonb) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('wing-attachments', 'wing-attachments', false, 5242880, array['image/*'])
  on conflict(id) do nothing;
