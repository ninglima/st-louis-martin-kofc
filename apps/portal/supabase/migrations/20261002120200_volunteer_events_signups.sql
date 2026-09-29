-- Volunteer events: sign-ups, attendance, hours and the report.

create or replace function public.event_signup(p_shift_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid;
  v_shift  public.event_shifts;
  v_status public.event_status;
  v_count  integer;
  v_id     uuid;
begin
  perform kit.assert_events_view();
  v_me := kit.my_member_id();
  if v_me is null then
    raise exception 'Your sign-in is not linked to a council member record.';
  end if;

  -- The lock serialises sign-ups for the same shift, so the last slot goes once.
  select * into v_shift from public.event_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'unknown shift';
  end if;
  select status into v_status from public.events where id = v_shift.event_id;
  if v_status <> 'scheduled' then
    raise exception 'This event has been cancelled.';
  end if;
  if v_shift.starts_at <= now() then
    raise exception 'This shift has already started.';
  end if;
  if exists (select 1 from public.event_signups where shift_id = p_shift_id and member_id = v_me and status <> 'cancelled') then
    raise exception 'You are already signed up for this shift.';
  end if;
  select count(*) into v_count from public.event_signups
   where shift_id = p_shift_id and status in ('signed_up', 'attended');
  if v_count >= v_shift.capacity then
    raise exception 'This shift is full.';
  end if;

  insert into public.event_signups (shift_id, member_id, status, added_by)
  values (p_shift_id, v_me, 'signed_up', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.event_cancel_signup(p_signup_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_signup public.event_signups;
  v_shift  public.event_shifts;
begin
  perform kit.assert_events_view();
  select * into v_signup from public.event_signups where id = p_signup_id for update;
  if not found then
    raise exception 'unknown sign-up';
  end if;
  select * into v_shift from public.event_shifts where id = v_signup.shift_id;

  if not kit.can_take_attendance(v_shift.event_id) then
    if v_signup.member_id is distinct from kit.my_member_id() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_shift.starts_at <= now() then
      raise exception 'This shift has already started.';
    end if;
  end if;
  if v_signup.status <> 'signed_up' then
    raise exception 'Only an active sign-up can be cancelled.';
  end if;

  update public.event_signups set status = 'cancelled', cancelled_at = now() where id = p_signup_id;
end $$;

create or replace function public.event_add_volunteer(p_shift_id uuid, p_member_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.event_shifts;
  v_id    uuid;
begin
  perform kit.assert_events_view();
  select * into v_shift from public.event_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'unknown shift';
  end if;
  if not kit.can_take_attendance(v_shift.event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members where id = p_member_id) then
    raise exception 'unknown member';
  end if;
  if exists (select 1 from public.event_signups where shift_id = p_shift_id and member_id = p_member_id and status <> 'cancelled') then
    raise exception 'That member is already on this shift.';
  end if;

  insert into public.event_signups (shift_id, member_id, status, added_by)
  values (p_shift_id, p_member_id, 'signed_up', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.event_set_attendance(p_signup_id uuid, p_status text, p_hours numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_signup public.event_signups;
  v_shift  public.event_shifts;
  v_hours  numeric;
begin
  perform kit.assert_events_view();
  select * into v_signup from public.event_signups where id = p_signup_id for update;
  if not found then
    raise exception 'unknown sign-up';
  end if;
  select * into v_shift from public.event_shifts where id = v_signup.shift_id;
  if not kit.can_take_attendance(v_shift.event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_shift.starts_at > now() then
    raise exception 'Attendance can be taken once the shift has started.';
  end if;
  if v_signup.status = 'cancelled' then
    raise exception 'That sign-up was cancelled.';
  end if;

  if p_status = 'attended' then
    v_hours := coalesce(p_hours, round(extract(epoch from (v_shift.ends_at - v_shift.starts_at)) / 900) / 4);
    if v_hours < 0 or v_hours > 24 or v_hours * 4 <> trunc(v_hours * 4) then
      raise exception 'Hours must be between 0 and 24, in quarter hours';
    end if;
    update public.event_signups
       set status = 'attended', hours = v_hours, confirmed_by = auth.uid(), confirmed_at = now()
     where id = p_signup_id;
  elsif p_status = 'no_show' then
    update public.event_signups
       set status = 'no_show', hours = null, confirmed_by = auth.uid(), confirmed_at = now()
     where id = p_signup_id;
  else
    raise exception 'Choose attended or no-show';
  end if;
end $$;

create or replace function kit.my_volunteering_at(p_member_id uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with rows as (
    select s.id as signup_id, s.status, s.hours, sh.starts_at, sh.ends_at, sh.label,
           e.id as event_id, e.title, e.status as event_status, t.name as type_name, t.category,
           kit.fraternal_year_of((sh.starts_at at time zone 'America/Chicago')::date) as fy
    from public.event_signups s
    join public.event_shifts sh on sh.id = s.shift_id
    join public.events e on e.id = sh.event_id
    join public.event_types t on t.id = e.type_id
    where s.member_id = p_member_id
  ),
  counted as (select * from rows where status = 'attended' and event_status = 'scheduled'),
  cur as (select kit.fraternal_year_of((p_now at time zone 'America/Chicago')::date) as y)
  select jsonb_build_object(
    'linked', true,
    'year', (select y from cur),
    'yearHours', coalesce((select sum(hours) from counted where fy = (select y from cur)), 0),
    'allTimeHours', coalesce((select sum(hours) from counted), 0),
    'byCategory', (
      select jsonb_agg(jsonb_build_object('category', x.c,
        'hours', coalesce((select sum(hours) from counted where category = x.c and fy = (select y from cur)), 0))
        order by x.ord)
      from unnest(enum_range(null::public.program_category)) with ordinality as x(c, ord)
    ),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object('signupId', signup_id, 'eventId', event_id, 'title', title,
        'startsAt', starts_at, 'endsAt', ends_at, 'label', label) order by starts_at)
      from rows where status = 'signed_up' and event_status = 'scheduled' and starts_at > p_now
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('signupId', signup_id, 'eventId', event_id, 'title', title,
        'typeName', type_name, 'startsAt', starts_at, 'status', status, 'hours', hours,
        'eventCancelled', event_status = 'cancelled') order by starts_at desc)
      from (select * from rows where starts_at <= p_now and status <> 'cancelled' order by starts_at desc limit 100) h
    ), '[]'::jsonb)
  )
$$;

create or replace function public.my_volunteering()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := kit.my_member_id();
begin
  if v_me is null then
    return jsonb_build_object('linked', false);
  end if;
  return kit.my_volunteering_at(v_me, now());
end $$;

create or replace function kit.volunteer_report_at(p_year integer, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (
    select s.member_id, s.status, s.hours, sh.id as shift_id, sh.starts_at, sh.ends_at,
           e.id as event_id, e.title, e.status as event_status, e.lead_member_id,
           t.id as type_id, t.name as type_name, t.category
    from public.event_signups s
    join public.event_shifts sh on sh.id = s.shift_id
    join public.events e on e.id = sh.event_id
    join public.event_types t on t.id = e.type_id
    where kit.fraternal_year_of((sh.starts_at at time zone 'America/Chicago')::date) = p_year
  ),
  att as (select * from base where status = 'attended' and event_status = 'scheduled')
  select jsonb_build_object(
    'year', p_year,
    'totals', jsonb_build_object(
      'hours', coalesce((select sum(hours) from att), 0),
      'volunteers', (select count(distinct member_id) from att),
      'events', (select count(distinct event_id) from att)),
    'byCategory', (
      select jsonb_agg(jsonb_build_object('category', x.c,
        'hours', coalesce((select sum(hours) from att where category = x.c), 0),
        'volunteers', (select count(distinct member_id) from att where category = x.c),
        'events', (select count(distinct event_id) from att where category = x.c)) order by x.ord)
      from unnest(enum_range(null::public.program_category)) with ordinality as x(c, ord)),
    'byType', coalesce((
      select jsonb_agg(r order by r->>'name') from (
        select jsonb_build_object('typeId', type_id, 'name', type_name, 'category', category,
          'hours', sum(hours), 'volunteers', count(distinct member_id), 'events', count(distinct event_id)) as r
        from att group by type_id, type_name, category) q), '[]'::jsonb),
    'byMember', coalesce((
      select jsonb_agg(r order by (r->>'hours')::numeric desc, r->>'name') from (
        select jsonb_build_object('memberId', m.id, 'name', m.first_name || ' ' || m.last_name,
          'membershipNumber', m.membership_number, 'events', count(distinct a.event_id), 'hours', sum(a.hours)) as r
        from att a join public.members m on m.id = a.member_id group by m.id) q), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(r order by r->>'startsAt') from (
        select jsonb_build_object('eventId', b.event_id, 'title', b.title, 'shiftId', b.shift_id,
          'startsAt', b.starts_at, 'endsAt', b.ends_at,
          'leadName', lm.first_name || ' ' || lm.last_name, 'waiting', count(*)) as r
        from base b left join public.members lm on lm.id = b.lead_member_id
        where b.status = 'signed_up' and b.event_status = 'scheduled' and b.ends_at < p_now
        group by b.event_id, b.title, b.shift_id, b.starts_at, b.ends_at, lm.first_name, lm.last_name) q), '[]'::jsonb)
  )
$$;

create or replace function public.volunteer_report(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_events_manage();
  perform kit.assert_fraternal_year(p_year);
  return kit.volunteer_report_at(p_year, now());
end $$;

revoke all on function kit.my_volunteering_at(uuid, timestamptz)  from public, anon, authenticated;
revoke all on function kit.volunteer_report_at(integer, timestamptz) from public, anon, authenticated;

revoke all on function public.event_signup(uuid)                         from public, anon;
revoke all on function public.event_cancel_signup(uuid)                  from public, anon;
revoke all on function public.event_add_volunteer(uuid, uuid)            from public, anon;
revoke all on function public.event_set_attendance(uuid, text, numeric)  from public, anon;
revoke all on function public.my_volunteering()                          from public, anon;
revoke all on function public.volunteer_report(integer)                  from public, anon;
grant execute on function public.event_signup(uuid)                        to authenticated;
grant execute on function public.event_cancel_signup(uuid)                 to authenticated;
grant execute on function public.event_add_volunteer(uuid, uuid)           to authenticated;
grant execute on function public.event_set_attendance(uuid, text, numeric) to authenticated;
grant execute on function public.my_volunteering()                         to authenticated;
grant execute on function public.volunteer_report(integer)                 to authenticated;
