-- Volunteer events, piece 1: schema, permissions and recurrence dates.
-- Spec: docs/superpowers/specs/2026-09-29-volunteer-events-design.md

insert into public.role_permissions (role_id, section, can_view, can_manage)
select id, 'events', true, true from public.roles where slug = 'administrator'
on conflict (role_id, section) do nothing;

insert into public.role_permissions (role_id, section, can_view, can_manage)
select id, 'events', true, false from public.roles where slug = 'member'
on conflict (role_id, section) do nothing;

create type public.program_category as enum ('faith', 'family', 'community', 'life');
create type public.event_status as enum ('scheduled', 'cancelled');
create type public.signup_status as enum ('signed_up', 'cancelled', 'attended', 'no_show');

create table public.event_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> '' and length(name) <= 100),
  category    public.program_category not null,
  description text check (length(description) <= 1000),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index event_types_name_uk on public.event_types (lower(name));

insert into public.event_types (name, category) values
  ('Food Pantry', 'community'),
  ('Handy Man Services', 'community'),
  ('Honor Flights', 'community'),
  ('Breakfast with Knights', 'family'),
  ('Foster Children Support', 'family'),
  ('Right to Life', 'life');

create table public.event_series (
  id         uuid primary key default gen_random_uuid(),
  rule       jsonb not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.events (
  id             uuid primary key default gen_random_uuid(),
  series_id      uuid references public.event_series on delete set null,
  type_id        uuid not null references public.event_types,
  title          text not null check (btrim(title) <> '' and length(title) <= 200),
  description    text check (length(description) <= 5000),
  location       text check (length(location) <= 300),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  lead_member_id uuid references public.members on delete set null,
  is_public      boolean not null default false,
  status         public.event_status not null default 'scheduled',
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index events_starts_idx on public.events (starts_at);
create index events_series_idx on public.events (series_id, starts_at);

create table public.event_shifts (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events on delete cascade,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  capacity  integer not null check (capacity between 1 and 200),
  label     text check (length(label) <= 100),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index event_shifts_event_idx on public.event_shifts (event_id);

create table public.event_signups (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.event_shifts on delete cascade,
  member_id    uuid not null references public.members on delete cascade,
  status       public.signup_status not null default 'signed_up',
  hours        numeric(4,2) check (hours is null or (hours between 0 and 24 and hours * 4 = trunc(hours * 4))),
  added_by     uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  confirmed_by uuid references auth.users on delete set null,
  confirmed_at timestamptz,
  check ((status = 'attended') = (hours is not null))
);
create unique index event_signups_active_uk on public.event_signups (shift_id, member_id) where status <> 'cancelled';
create index event_signups_member_idx on public.event_signups (member_id);

alter table public.event_types   enable row level security;
alter table public.event_series  enable row level security;
alter table public.events        enable row level security;
alter table public.event_shifts  enable row level security;
alter table public.event_signups enable row level security;

revoke all on public.event_types, public.event_series, public.events, public.event_shifts, public.event_signups
  from anon, authenticated;
grant select on public.event_types, public.events, public.event_shifts to authenticated;

create policy event_types_read  on public.event_types  for select to authenticated using (kit.has_permission('events', 'view'));
create policy events_read       on public.events       for select to authenticated using (kit.has_permission('events', 'view'));
create policy event_shifts_read on public.event_shifts for select to authenticated using (kit.has_permission('events', 'view'));

create or replace function kit.assert_events_view()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('events', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function kit.assert_events_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('events', 'manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- The caller's member record, or null when their sign-in is not linked.
create or replace function kit.my_member_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = (select auth.uid())
$$;

-- events.manage, or the event's lead.
create or replace function kit.can_take_attendance(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select kit.has_permission('events', 'manage') or exists (
    select 1 from public.events e
    join public.members m on m.id = e.lead_member_id
    where e.id = p_event_id and m.user_id = (select auth.uid())
  )
$$;

-- A local (Chicago) date and clock times as instants. An end at or before
-- the start is on the next day, so 22:00-02:00 is four hours.
create or replace function kit.local_span(p_date date, p_start time, p_end time,
  out starts_at timestamptz, out ends_at timestamptz)
language sql stable set search_path = '' as $$
  select (p_date + p_start) at time zone 'America/Chicago',
         ((case when p_end <= p_start then p_date + 1 else p_date end) + p_end) at time zone 'America/Chicago'
$$;

-- The single source of a series' dates (used by event_create and the preview).
create or replace function kit.series_dates(p_rule jsonb)
returns setof date language plpgsql stable set search_path = '' as $$
declare
  v_freq     text := p_rule->>'freq';
  v_start    date := nullif(p_rule->>'start_date', '')::date;
  v_until    date := nullif(p_rule->>'until', '')::date;
  v_interval integer;
  v_weekdays integer[];
  v_weekday  integer;
  v_nth      integer;
  v_week0    date;
  v_d        date;
  v_month    date;
  v_last     date;
begin
  if v_start is null or v_until is null then
    raise exception 'Choose a first date and an end date for the repeat';
  end if;
  if v_until < v_start then
    raise exception 'The repeat must end on or after the first date';
  end if;
  if v_until > (v_start + interval '1 year')::date then
    raise exception 'A repeat can run for at most one year';
  end if;

  if v_freq = 'weekly' then
    v_interval := coalesce(nullif(p_rule->>'interval', '')::integer, 1);
    if v_interval not between 1 and 4 then
      raise exception 'Repeat every 1 to 4 weeks';
    end if;
    select array_agg(value::integer) into v_weekdays
    from jsonb_array_elements_text(coalesce(p_rule->'weekdays', '[]'::jsonb));
    if v_weekdays is null or exists (select 1 from unnest(v_weekdays) w where w not between 0 and 6) then
      raise exception 'Choose at least one weekday';
    end if;
    v_week0 := v_start - extract(dow from v_start)::integer;
    for v_d in select g::date from generate_series(v_start::timestamp, v_until::timestamp, interval '1 day') g loop
      if extract(dow from v_d)::integer = any (v_weekdays) and ((v_d - v_week0) / 7) % v_interval = 0 then
        return next v_d;
      end if;
    end loop;
  elsif v_freq = 'monthly' then
    v_weekday := nullif(p_rule->>'weekday', '')::integer;
    v_nth := nullif(p_rule->>'nth', '')::integer;
    if v_weekday is null or v_weekday not between 0 and 6 then
      raise exception 'Choose a weekday';
    end if;
    if v_nth is null or not (v_nth between 1 and 4 or v_nth = -1) then
      raise exception 'Choose first, second, third, fourth or last';
    end if;
    for v_month in
      select g::date from generate_series(date_trunc('month', v_start::timestamp), v_until::timestamp, interval '1 month') g
    loop
      if v_nth = -1 then
        v_last := (v_month + interval '1 month' - interval '1 day')::date;
        v_d := v_last - ((extract(dow from v_last)::integer - v_weekday + 7) % 7);
      else
        v_d := v_month + ((v_weekday - extract(dow from v_month)::integer + 7) % 7) + (v_nth - 1) * 7;
      end if;
      if v_d between v_start and v_until then
        return next v_d;
      end if;
    end loop;
  else
    raise exception 'Unknown repeat pattern';
  end if;
end $$;

create or replace function kit.validate_event_fields(p jsonb, p_require boolean)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (p_require or p ? 'type_id') and not exists (
    select 1 from public.event_types where id = nullif(p->>'type_id', '')::uuid and active
  ) then
    raise exception 'Choose an active event type';
  end if;
  if (p_require or p ? 'title') and (nullif(btrim(p->>'title'), '') is null or length(btrim(p->>'title')) > 200) then
    raise exception 'Title is required (200 characters at most)';
  end if;
  if length(p->>'description') > 5000 then
    raise exception 'Description must be 5000 characters or fewer';
  end if;
  if length(p->>'location') > 300 then
    raise exception 'Location must be 300 characters or fewer';
  end if;
  if nullif(p->>'lead_member_id', '') is not null
     and not exists (select 1 from public.members where id = (p->>'lead_member_id')::uuid) then
    raise exception 'The lead must be a council member';
  end if;
end $$;

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
    if coalesce(nullif(v->>'capacity', '')::integer, 0) not between 1 and 200 then
      raise exception 'Volunteers needed must be between 1 and 200';
    end if;
    if length(v->>'label') > 100 then
      raise exception 'Shift label must be 100 characters or fewer';
    end if;
  end loop;
end $$;

revoke all on function kit.assert_events_view()            from public, anon, authenticated;
revoke all on function kit.assert_events_manage()          from public, anon, authenticated;
revoke all on function kit.my_member_id()                  from public, anon, authenticated;
revoke all on function kit.can_take_attendance(uuid)       from public, anon, authenticated;
revoke all on function kit.local_span(date, time, time)    from public, anon, authenticated;
revoke all on function kit.series_dates(jsonb)             from public, anon, authenticated;
revoke all on function kit.validate_event_fields(jsonb, boolean) from public, anon, authenticated;
revoke all on function kit.validate_shifts(jsonb)          from public, anon, authenticated;

create or replace function public.event_series_preview(p_rule jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer;
  v_first date;
  v_last  date;
begin
  perform kit.assert_events_manage();
  select count(*), min(d), max(d) into v_count, v_first, v_last from kit.series_dates(p_rule) d;
  return jsonb_build_object('count', v_count, 'first', v_first, 'last', v_last);
end $$;

create or replace function public.event_types_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
begin
  perform kit.assert_events_manage();
  if v_name = '' or length(v_name) > 100 then
    raise exception 'Name is required (100 characters at most)';
  end if;
  if p->>'category' is null or p->>'category' not in ('faith', 'family', 'community', 'life') then
    raise exception 'Choose a category';
  end if;
  if length(p->>'description') > 1000 then
    raise exception 'Description must be 1000 characters or fewer';
  end if;
  if exists (select 1 from public.event_types where lower(name) = lower(v_name) and id is distinct from v_id) then
    raise exception 'An event type with that name already exists';
  end if;

  if v_id is null then
    insert into public.event_types (name, category, description, active)
    values (v_name, (p->>'category')::public.program_category, nullif(btrim(p->>'description'), ''),
            coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.event_types
       set name = v_name,
           category = (p->>'category')::public.program_category,
           description = nullif(btrim(p->>'description'), ''),
           active = coalesce((p->>'active')::boolean, true)
     where id = v_id;
    if not found then
      raise exception 'unknown event type';
    end if;
  end if;

  return v_id;
end $$;

revoke all on function public.event_series_preview(jsonb) from public, anon;
revoke all on function public.event_types_save(jsonb)     from public, anon;
grant execute on function public.event_series_preview(jsonb) to authenticated;
grant execute on function public.event_types_save(jsonb)     to authenticated;
