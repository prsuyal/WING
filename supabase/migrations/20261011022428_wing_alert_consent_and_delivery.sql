create function public.wing_enable_watch(p_owner uuid,p_watch uuid,p_source uuid,p_review text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.wing_watches; m public.wing_messages; source public.wing_messages;
begin
 perform 1 from public.wing_notify_state where owner_id=p_owner for update;
 select * into w from public.wing_watches where owner_id=p_owner and id=p_watch for update;
 if not found or w.status<>'active' or w.notify then raise exception 'Current watch consent required'; end if;
 select * into m from public.wing_messages where owner_id=p_owner and direction='outbound' order by created_at desc limit 1;
 select * into source from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound';
 if not found or p_source=w.source_message_id or source.created_at<m.created_at or m.status is distinct from 'sent' or m.parent_id is distinct from w.source_message_id or m.body->>'text' is distinct from p_review then raise exception 'Separate delivered watch consent required'; end if;
 update public.wing_watches set notify=true,source_message_id=p_source where id=p_watch;
 update public.wing_notify_state set paused=false where owner_id=p_owner;
 return true;
end;
$$;

create function public.wing_change_demo_price(p_owner uuid,p_trip uuid,p_source uuid,p_key text,p_delta integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.wing_users where id=p_owner and demo_enabled) or not exists(select 1 from public.wing_messages where owner_id=p_owner and id=p_source and direction='inbound') then raise exception 'Demo account required'; end if;
 perform 1 from public.wing_trips where owner_id=p_owner and id=p_trip and status='planning' for update;
 if not found or not exists(select 1 from public.wing_watches where owner_id=p_owner and trip_id=p_trip and comparison_key=p_key and status='active') then raise exception 'Owned active watch required'; end if;
 insert into public.wing_demo_prices(owner_id,trip_id,comparison_key,delta_cents) values(p_owner,p_trip,p_key,p_delta) on conflict(owner_id,trip_id,comparison_key) do update set delta_cents=p_delta,version=public.wing_demo_prices.version+1,updated_at=now();
 update public.wing_jobs set due_at=now(),payload=payload||jsonb_build_object('recheck',true) where owner_id=p_owner and trip_id=p_trip and kind='watch' and status in ('pending','processing');
 return true;
end;
$$;

create function public.wing_finish_alert_job(p_owner uuid,p_job uuid,p_lease uuid,p_status text,p_delay integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('pending','done','cancelled') or p_delay<0 or p_delay>21600000 then raise exception 'Invalid job completion'; end if;
 update public.wing_jobs set status=p_status,due_at=case when p_status='pending' and payload->>'recheck'='true' then now() else now()+p_delay*interval '1 millisecond' end,payload=payload-'recheck',lease=null,leased_until=null where owner_id=p_owner and id=p_job and status='processing' and lease=p_lease and leased_until>now();
 return found;
end;
$$;

create function public.wing_finish_notice(p_owner uuid,p_notice uuid,p_lease uuid,p_status text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n public.wing_notices;
begin
 if p_status not in ('sent','unknown') then raise exception 'Invalid delivery outcome'; end if;
 select * into n from public.wing_notices where owner_id=p_owner and id=p_notice and status='sending' and lease=p_lease for update;
 if not found then return false; end if;
 update public.wing_messages set status=case when p_status='sent' then 'sent' else 'delivery_unknown' end where owner_id=p_owner and id=n.message_id;
 update public.wing_notices set status=p_status,lease=null,leased_until=null where id=n.id;
 return true;
end;
$$;
revoke all on function public.wing_enable_watch(uuid,uuid,uuid,text),public.wing_change_demo_price(uuid,uuid,uuid,text,integer),public.wing_finish_alert_job(uuid,uuid,uuid,text,integer),public.wing_finish_notice(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.wing_enable_watch(uuid,uuid,uuid,text),public.wing_change_demo_price(uuid,uuid,uuid,text,integer),public.wing_finish_alert_job(uuid,uuid,uuid,text,integer),public.wing_finish_notice(uuid,uuid,uuid,text) to service_role;
