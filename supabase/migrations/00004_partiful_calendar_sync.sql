-- Keep calendar membership independent of the attendance row's manual source.
alter table public.sf_partiful_connections
  add column if not exists imported_event_ids text[] not null default '{}';

-- Lock the connection through each mutation. A fetch finishing after disconnect
-- or replacement cannot recreate attendance for the old connection.
create or replace function public.sf_apply_partiful_calendar(
  p_user_id uuid, p_feed_fp text, p_events jsonb, p_total integer
) returns boolean language plpgsql set search_path = public as $$
begin
  perform 1 from sf_partiful_connections
    where user_id = p_user_id and feed_fp = p_feed_fp for update;
  if not found then return false; end if;

  insert into sf_attendance (user_id, event_id, partiful_id, status, source, updated_at)
    select p_user_id, e.event_id, e.partiful_id, 'going', 'calendar', now()
    from jsonb_to_recordset(p_events) as e(event_id text, partiful_id text)
  on conflict (user_id, event_id) do update
    set partiful_id = excluded.partiful_id, status = 'going', updated_at = now()
    where sf_attendance.source = 'calendar';

  delete from sf_attendance a where a.user_id = p_user_id and a.source = 'calendar'
    and not exists (select 1 from jsonb_to_recordset(p_events) as e(event_id text) where e.event_id = a.event_id);

  update sf_partiful_connections set
    event_count = jsonb_array_length(p_events), total_count = p_total,
    imported_event_ids = array(select e.event_id from jsonb_to_recordset(p_events) as e(event_id text)),
    last_synced_at = now(), last_error = null
    where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.sf_disconnect_partiful_calendar(p_user_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform 1 from sf_partiful_connections where user_id = p_user_id for update;
  delete from sf_attendance where user_id = p_user_id and source = 'calendar';
  delete from sf_partiful_connections where user_id = p_user_id;
end;
$$;

revoke all on function public.sf_apply_partiful_calendar(uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.sf_disconnect_partiful_calendar(uuid) from public, anon, authenticated;
grant execute on function public.sf_apply_partiful_calendar(uuid, text, jsonb, integer) to service_role;
grant execute on function public.sf_disconnect_partiful_calendar(uuid) to service_role;
