create index wing_memory_documents_owner_source_idx on public.wing_memory_documents(owner_id, source_message_id);
create index wing_messages_owner_parent_idx on public.wing_messages(owner_id, parent_id);
