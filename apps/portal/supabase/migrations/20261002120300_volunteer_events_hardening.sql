-- Volunteer events hardening: lock shifts on edit, refuse zero-length
-- times, and limit the lead search's membership number to callers who can
-- already see it. Signatures are unchanged from the earlier migrations, so
-- grants persist; they are re-stated below anyway for safety.

create or replace function kit.validate_shifts(p_shifts jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  v jsonb;
begin
  if p_shifts is null or jsonb_typeof(p_shifts) <> 'array' or jsonb_array_length(p_shifts) = 0 then
    raise exception 'Add at least one shift';
  end if;
  if jsonb_array_length(p_shifts) > 20 then
    raise exception 'An event can have at most 20 shifts';
  end if;
  for v in select value from jsonb_array_elements(p_shifts) loop
    if nullif(v->>'start_time', '') is null or nullif(v->>'end_time', '') is null then
      raise exception 'Every shift needs a start and an end time';
    end if;
    if v->>'start_time' = v->>'end_time' then
      raise exception 'The end time must differ from the start time';
    end if;
    if coalesce(nullif(v->>'capacity', '')::integer, 0) not between 1 and 200 then
      raise exception 'Volunteers needed must be between 1 and 200';
    end if;
    if length(v->>'label') > 100 then
      raise exception 'Shift label must be 100 characters or fewer';
    end if;
  end loop;
end $$;

create or replace function public.event_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_date   date := nullif(p->>'date', '')::date;
  v_start  time := nullif(p->>'start_time', '')::time;
  v_end    time := nullif(p->>'end_time', '')::time;
  v_rule   jsonb;
  v_series uuid;
  v_dates  date[];
  v_d      date;
  v_event  uuid;
  v_ids    uuid[] := '{}';
  v_shift  jsonb;
  v_span   record;
begin
  perform kit.assert_events_manage();
  perform kit.validate_event_fields(p, true);
  perform kit.validate_shifts(p->'shifts');
  if v_date is null or v_start is null or v_end is null then
    raise exception 'Choose a date, a start time and an end time';
  end if;
  if v_start = v_end then
    raise exception 'The end time must differ from the start time';
  end if;

  if jsonb_typeof(p->'repeat') = 'object' then
    v_rule := (p->'repeat') || jsonb_build_object('start_date', v_date);
    select array_agg(d order by d) into v_dates from kit.series_dates(v_rule) d;
    if v_dates is null then
      raise exception 'That repeat creates no dates';
    end if;
    insert into public.event_series (rule, created_by) values (v_rule, auth.uid()) returning id into v_series;
  else
    v_dates := array[v_date];
  end if;

  foreach v_d in array v_dates loop
    select * into v_span from kit.local_span(v_d, v_start, v_end);
    insert into public.events (series_id, type_id, title, description, location, starts_at, ends_at,
                               lead_member_id, is_public, created_by)
    values (v_series, (p->>'type_id')::uuid, btrim(p->>'title'), nullif(btrim(p->>'description'), ''),
            nullif(btrim(p->>'location'), ''), v_span.starts_at, v_span.ends_at,
            nullif(p->>'lead_member_id', '')::uuid, coalesce((p->>'is_public')::boolean, false), auth.uid())
    returning id into v_event;

    for v_shift in select value from jsonb_array_elements(p->'shifts') loop
      select * into v_span from kit.local_span(v_d, (v_shift->>'start_time')::time, (v_shift->>'end_time')::time);
      insert into public.event_shifts (event_id, starts_at, ends_at, capacity, label)
      values (v_event, v_span.starts_at, v_span.ends_at, (v_shift->>'capacity')::integer,
              nullif(btrim(v_shift->>'label'), ''));
    end loop;

    v_ids := v_ids || v_event;
  end loop;

  return jsonb_build_object('seriesId', v_series, 'eventIds', to_jsonb(v_ids));
end $$;

create or replace function public.event_update(p_event_id uuid, p_fields jsonb, p_scope text default 'this')
returns void language plpgsql security definer set search_path = '' as $$
declare
  c_allowed constant text[] := array['type_id','title','description','location','lead_member_id',
                                     'is_public','status','date','start_time','end_time'];
  v_event public.events;
  v_key   text;
  v_date  date;
  v_start time;
  v_end   time;
  v_span  record;
  v_delta interval;
begin
  perform kit.assert_events_manage();
  if p_scope is null or p_scope not in ('this', 'following') then
    raise exception 'Unknown scope';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'changes must be an object';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not v_key = any (c_allowed) then
      raise exception 'unknown field: %', v_key;
    end if;
  end loop;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'unknown event';
  end if;
  if p_scope = 'following' and p_fields ?| array['date', 'start_time', 'end_time'] then
    raise exception 'Times can only be changed one event at a time';
  end if;
  if p_fields ? 'status' and coalesce(p_fields->>'status', '') not in ('scheduled', 'cancelled') then
    raise exception 'Unknown status';
  end if;
  -- An inactive event type must not block editing an event that already has
  -- it; only require an active type when type_id is actually changing.
  perform kit.validate_event_fields(
    case when (p_fields->>'type_id')::uuid is not distinct from v_event.type_id
      then p_fields - 'type_id'
      else p_fields
    end,
    false);

  update public.events e set
    type_id        = case when p_fields ? 'type_id' then (p_fields->>'type_id')::uuid else e.type_id end,
    title          = case when p_fields ? 'title' then btrim(p_fields->>'title') else e.title end,
    description    = case when p_fields ? 'description' then nullif(btrim(p_fields->>'description'), '') else e.description end,
    location       = case when p_fields ? 'location' then nullif(btrim(p_fields->>'location'), '') else e.location end,
    lead_member_id = case when p_fields ? 'lead_member_id' then nullif(p_fields->>'lead_member_id', '')::uuid else e.lead_member_id end,
    is_public      = case when p_fields ? 'is_public' then (p_fields->>'is_public')::boolean else e.is_public end,
    status         = case when p_fields ? 'status' then (p_fields->>'status')::public.event_status else e.status end,
    updated_at     = now()
  where e.id = p_event_id
     or (p_scope = 'following' and v_event.series_id is not null
         and e.series_id = v_event.series_id and e.starts_at > v_event.starts_at);

  if p_fields ?| array['date', 'start_time', 'end_time'] then
    v_date  := coalesce(nullif(p_fields->>'date', '')::date, (v_event.starts_at at time zone 'America/Chicago')::date);
    v_start := coalesce(nullif(p_fields->>'start_time', '')::time, (v_event.starts_at at time zone 'America/Chicago')::time);
    v_end   := coalesce(nullif(p_fields->>'end_time', '')::time, (v_event.ends_at at time zone 'America/Chicago')::time);
    if v_start = v_end then
      raise exception 'The end time must differ from the start time';
    end if;
    select * into v_span from kit.local_span(v_date, v_start, v_end);
    update public.events set starts_at = v_span.starts_at, ends_at = v_span.ends_at where id = p_event_id;

    -- A new date carries the shifts with it, keeping their local clock times.
    v_delta := (v_date - (v_event.starts_at at time zone 'America/Chicago')::date) * interval '1 day';
    if v_delta <> interval '0' then
      update public.event_shifts
         set starts_at = ((starts_at at time zone 'America/Chicago') + v_delta) at time zone 'America/Chicago',
             ends_at   = ((ends_at   at time zone 'America/Chicago') + v_delta) at time zone 'America/Chicago'
       where event_id = p_event_id;
    end if;
  end if;
end $$;

-- Locks the event row, then every one of its shift rows, before checking
-- capacity or deleting anything. event_signup locks a single shift row
-- first, so the two serialise on the same shift instead of racing: a save
-- that lowers capacity or removes a shift can no longer land between
-- event_signup's count and its insert.
create or replace function public.event_shifts_save(p_event_id uuid, p_shifts jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event  public.events;
  v_date   date;
  v_shift  jsonb;
  v_span   record;
  v_id     uuid;
  v_keep   uuid[] := '{}';
  v_active integer;
begin
  perform kit.assert_events_manage();
  perform kit.validate_shifts(p_shifts);
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'unknown event';
  end if;
  perform 1 from public.event_shifts where event_id = p_event_id for update;
  v_date := (v_event.starts_at at time zone 'America/Chicago')::date;

  for v_shift in select value from jsonb_array_elements(p_shifts) loop
    select * into v_span from kit.local_span(v_date, (v_shift->>'start_time')::time, (v_shift->>'end_time')::time);
    v_id := nullif(v_shift->>'id', '')::uuid;

    if v_id is null then
      insert into public.event_shifts (event_id, starts_at, ends_at, capacity, label)
      values (p_event_id, v_span.starts_at, v_span.ends_at, (v_shift->>'capacity')::integer,
              nullif(btrim(v_shift->>'label'), ''))
      returning id into v_id;
    else
      select count(*) into v_active from public.event_signups
       where shift_id = v_id and status in ('signed_up', 'attended');
      if (v_shift->>'capacity')::integer < v_active then
        raise exception 'Volunteers needed cannot be below the % already signed up', v_active;
      end if;
      update public.event_shifts
         set starts_at = v_span.starts_at, ends_at = v_span.ends_at,
             capacity = (v_shift->>'capacity')::integer, label = nullif(btrim(v_shift->>'label'), '')
       where id = v_id and event_id = p_event_id;
      if not found then
        raise exception 'unknown shift';
      end if;
    end if;

    v_keep := v_keep || v_id;
  end loop;

  if exists (
    select 1 from public.event_signups s
    join public.event_shifts sh on sh.id = s.shift_id
    where sh.event_id = p_event_id and not (sh.id = any (v_keep)) and s.status <> 'cancelled'
  ) then
    raise exception 'A shift with volunteers cannot be removed; cancel the event instead';
  end if;

  delete from public.event_shifts where event_id = p_event_id and not (id = any (v_keep));
end $$;

-- Picking a lead needs events.manage; adding a walk-in needs attendance
-- rights on that event. Everyone else who reaches this far (events.view)
-- can still search names for e.g. their own walk-in request, but the
-- membership number is withheld unless the caller can already see it
-- through events.manage or members.view.
create or replace function public.event_member_search(p_event_id uuid, p_query text)
returns table (id uuid, full_name text, membership_number text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_q           text := btrim(coalesce(p_query, ''));
  v_show_number boolean;
begin
  perform kit.assert_events_view();
  if p_event_id is null then
    perform kit.assert_events_manage();
  elsif not kit.can_take_attendance(p_event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;
  v_show_number := kit.has_permission('events', 'manage') or kit.has_permission('members', 'view');

  return query
  select m.id, m.first_name || ' ' || m.last_name,
         case when v_show_number then m.membership_number else null end
  from public.members m
  where (m.first_name || ' ' || m.last_name) ilike '%' || v_q || '%'
     or m.membership_number ilike v_q || '%'
  order by m.last_name, m.first_name
  limit 20;
end $$;

revoke all on function kit.validate_shifts(jsonb)             from public, anon, authenticated;
revoke all on function public.event_create(jsonb)              from public, anon;
revoke all on function public.event_update(uuid, jsonb, text)  from public, anon;
revoke all on function public.event_shifts_save(uuid, jsonb)   from public, anon;
revoke all on function public.event_member_search(uuid, text)  from public, anon;
grant execute on function public.event_create(jsonb)              to authenticated;
grant execute on function public.event_update(uuid, jsonb, text)  to authenticated;
grant execute on function public.event_shifts_save(uuid, jsonb)   to authenticated;
grant execute on function public.event_member_search(uuid, text)  to authenticated;
