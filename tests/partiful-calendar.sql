\set ON_ERROR_STOP on
begin;
insert into sf_users (id, name, invite_code) values
 ('00000000-0000-0000-0000-000000000001', 'One', 'one'),
 ('00000000-0000-0000-0000-000000000002', 'Two', 'two');
insert into sf_partiful_connections (user_id, feed_enc, feed_fp) select id, 'test', 'fp' from sf_users;
insert into sf_attendance (user_id, event_id, status, source) values
 ('00000000-0000-0000-0000-000000000001', 'manual', 'interested', 'manual');
select sf_apply_partiful_calendar('00000000-0000-0000-0000-000000000001', 'fp', '[{"event_id":"shared","partiful_id":"abcdefghijklmnopqrst"},{"event_id":"manual","partiful_id":"ABCDEFGHIJKLMNOPQRST"}]', 2);
select sf_apply_partiful_calendar('00000000-0000-0000-0000-000000000001', 'fp', '[{"event_id":"shared","partiful_id":"abcdefghijklmnopqrst"},{"event_id":"manual","partiful_id":"ABCDEFGHIJKLMNOPQRST"}]', 2);
select sf_apply_partiful_calendar('00000000-0000-0000-0000-000000000002', 'fp', '[{"event_id":"shared","partiful_id":"abcdefghijklmnopqrst"}]', 1);
do $$ begin
 if (select count(*) from sf_attendance) <> 3 then raise exception 'idempotency / two-user association failed'; end if;
 if not exists (select 1 from sf_attendance where event_id='manual' and source='manual' and status='interested') then raise exception 'manual overwritten'; end if;
 if not exists (select 1 from sf_partiful_connections where user_id='00000000-0000-0000-0000-000000000001' and imported_event_ids @> array['manual','shared'] and event_count=2) then raise exception 'membership/status missing'; end if;
end $$;
select sf_apply_partiful_calendar('00000000-0000-0000-0000-000000000001', 'fp', '[]', 0);
do $$ begin
 if (select count(*) from sf_attendance where user_id='00000000-0000-0000-0000-000000000001') <> 1 then raise exception 'stale removal failed'; end if;
 if not exists (select 1 from sf_attendance where event_id='manual' and source='manual') then raise exception 'manual deleted'; end if;
 if sf_apply_partiful_calendar('00000000-0000-0000-0000-000000000002', 'wrong-fingerprint', '[]', 0) then raise exception 'stale feed applied'; end if;
end $$;
select sf_disconnect_partiful_calendar('00000000-0000-0000-0000-000000000001');
select sf_disconnect_partiful_calendar('00000000-0000-0000-0000-000000000002');
do $$ begin
 if (select count(*) from sf_attendance) <> 1 or not exists (select 1 from sf_attendance where source='manual') then raise exception 'disconnect failed'; end if;
 if exists (select 1 from sf_partiful_connections) then raise exception 'connection not deleted'; end if;
 if sf_apply_partiful_calendar('00000000-0000-0000-0000-000000000002', 'fp', '[{"event_id":"shared"}]', 1) then raise exception 'disconnected feed restored'; end if;
 if has_function_privilege('anon', 'sf_apply_partiful_calendar(uuid,text,jsonb,integer)', 'execute') then raise exception 'anon can apply'; end if;
 if has_function_privilege('authenticated', 'sf_disconnect_partiful_calendar(uuid)', 'execute') then raise exception 'authenticated can disconnect others'; end if;
end $$;
rollback;
