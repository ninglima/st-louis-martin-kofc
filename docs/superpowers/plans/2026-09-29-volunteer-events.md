# Volunteer Events (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members browse a volunteer-event calendar, sign up for shifts, and see their confirmed hours; officers and event leads create events, run recurring series, take attendance and report hours by program category and fraternal year.

**Architecture:**
- **Data:** one additive Postgres migration adds the `events` RBAC section, five tables and `security definer` functions that hold every rule: capacity, attendance, hours and recurrence. Tables are read only through RLS or these functions.
- **Package:** a new `@kit/events` package (service, server actions, pure `lib/` helpers, components) follows `@kit/finance`.
- **Pages:** the portal pages live under `/home/events` and `/home/volunteering`.
- **Time zone:** all times are `timestamptz`, and every date and time rule is judged in America/Chicago.

**Tech Stack:**
- Supabase Postgres 17, pgTAP
- Next.js 16 App Router, server actions via `enhanceAction`
- React 19, react-hook-form, zod 4 (`import * as z from 'zod'`)
- Base UI shadcn components in `@kit/ui`
- Vitest (jsdom), Playwright

**Spec:** `docs/superpowers/specs/2026-09-29-volunteer-events-design.md`

## Global Constraints

- **Permission section:** key `events`, label `Volunteer Events`.
  - Description: `View: the event calendar; sign up for shifts. Manage: create, edit and cancel events; manage event types; confirm any attendance; the hours report`.
  - Seeded grants: `administrator` gets view and manage; `member` gets view.
- **Permission errors:** a refused permission raises errcode `42501`, message `forbidden`. Rule errors raise `P0001` with the exact messages given in each task.
- **Time zone:** `America/Chicago` for every date rule, display and fraternal year (`kit.fraternal_year_of`, `kit.council_today`).
- **Program categories:** `faith`, `family`, `community`, `life`, displayed as `Faith`, `Family`, `Community`, `Life`.
- **Seeded event types:**

  | Name | Category |
  | --- | --- |
  | Food Pantry | community |
  | Handy Man Services | community |
  | Honor Flights | community |
  | Breakfast with Knights | family |
  | Foster Children Support | family |
  | Right to Life | life |

- **Limits:**
  - title 200, description 5000, location 300;
  - shift label 100, type name 100, type description 1000;
  - shift capacity 1–200, at most 20 shifts per event;
  - hours 0–24 in steps of 0.25;
  - a repeat ends at most 1 year after its first date;
  - the calendar range is at most 62 days.
- **Counting:**
  - "Active" sign-ups are those with status `signed_up` or `attended`. They count toward capacity.
  - Confirmed hours are `attended` sign-ups on `scheduled` events.
- **Function conventions:**
  - every public function is `security definer`, `set search_path = ''`, revoked from `public, anon`, and granted to `authenticated`;
  - every `kit.*` helper is revoked from `public, anon, authenticated`.
- **Local database:** never run `supabase db reset`. Apply with `pnpm --filter portal exec supabase migration up`.
- **DB types:** add the new objects to `packages/supabase/src/database.types.ts` and `apps/portal/lib/database.types.ts` **by hand**. Copy entries from `supabase gen types typescript --local > $TMPDIR/types.ts`. Never commit the whole regenerated file, because it drops the `HAND-CORRECTED` annotations.
- **Server actions:** `'use server'` files export only async functions. Every action returns `{ success: true, data? } | { success: false, error }` and never throws for an expected failure.

## Review Focus

1. **A shift that crosses midnight** (22:00 → 02:00) should end on the next day and last 4 hours. Pinned in Task 1 (`kit.local_span`).
2. **A member who cancels and signs up again** for the same shift should succeed. Pinned in Task 3.
3. **Lowering a shift's capacity below its current sign-ups** should be refused with a clear message. Pinned in Task 2.
4. **"This and all later" on an event that is not in a series** should change only that event. Pinned in Task 2.
5. **An event at 11:30 pm Chicago** should appear on its Chicago date in the calendar, not the next UTC date. Pinned in Task 4 (`chicagoDate`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/portal/supabase/migrations/20261002120000_volunteer_events.sql` | Section grants, enums, tables, RLS, helpers, `kit.series_dates`, `event_series_preview`, `event_types_save` (Task 1) |
| `apps/portal/supabase/migrations/20261002120100_volunteer_events_manage.sql` | `event_create`, `event_update`, `event_shifts_save`, `events_in_range`, `event_detail`, `event_member_search` (Task 2) |
| `apps/portal/supabase/migrations/20261002120200_volunteer_events_signups.sql` | Sign-up, cancel, walk-in, attendance, `my_volunteering`, `volunteer_report` (Task 3) |
| `apps/portal/supabase/tests/events_schema.test.sql`, `events_manage.test.sql`, `events_signups.test.sql` | pgTAP, one per migration |
| `packages/supabase/src/database.types.ts`, `apps/portal/lib/database.types.ts` | Hand-added types (Task 3) |
| `packages/features/rbac/src/types/sections.ts` | `events` section (Task 4) |
| `packages/features/events/**` | New package (Tasks 4–7) |
| `packages/brand/src/config/paths.config.ts`, `packages/brand/i18n/messages/en/common.json`, `apps/portal/config/navigation.config.tsx` | Paths and nav (Task 4) |
| `apps/portal/app/home/events/**`, `apps/portal/app/home/volunteering/page.tsx`, `apps/portal/app/home/page.tsx` | Pages (Tasks 5–7) |
| `apps/e2e/tests/events/*`, `apps/e2e/tests/utils/cleanup.ts`, `apps/e2e/tests/dues/dues.po.ts` | E2E (Task 8) |

---

### Task 1: Schema, permissions, recurrence dates

**Files:**
- Create: `apps/portal/supabase/migrations/20261002120000_volunteer_events.sql`
- Test: `apps/portal/supabase/tests/events_schema.test.sql`

**Interfaces:**
- Produces:
  - **Enums:** `public.program_category`, `public.event_status ('scheduled','cancelled')`, `public.signup_status ('signed_up','cancelled','attended','no_show')`.
  - **Tables:** `public.event_types`, `public.event_series`, `public.events`, `public.event_shifts`, `public.event_signups`, with the columns below.
  - **Helpers:**
    - `kit.assert_events_view()` and `kit.assert_events_manage()`;
    - `kit.my_member_id() returns uuid`;
    - `kit.can_take_attendance(p_event_id uuid) returns boolean`;
    - `kit.local_span(p_date date, p_start time, p_end time, out starts_at timestamptz, out ends_at timestamptz)`;
    - `kit.series_dates(p_rule jsonb) returns setof date`;
    - `kit.validate_event_fields(p jsonb, p_require boolean)` and `kit.validate_shifts(p_shifts jsonb)`.
  - **Public functions:**
    - `public.event_series_preview(p_rule jsonb) returns jsonb` → `{count, first, last}`;
    - `public.event_types_save(p jsonb) returns uuid`.

- [ ] **Step 1: Write the failing test**

`apps/portal/supabase/tests/events_schema.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select no_plan();

select tests.make_user('ev1-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev1-knight@example.com', 'member') as knight \gset
select tests.make_user('ev1-none@example.com', 'no_such_role') as nobody \gset

-- section seeds
select is((select rp.can_view::text || rp.can_manage::text from public.role_permissions rp
           join public.roles r on r.id = rp.role_id where r.slug = 'administrator' and rp.section = 'events'),
  'truetrue', 'administrator can view and manage events');
select is((select rp.can_view::text || rp.can_manage::text from public.role_permissions rp
           join public.roles r on r.id = rp.role_id where r.slug = 'member' and rp.section = 'events'),
  'truefalse', 'member can view events');

-- seeded types
select is((select count(*)::int from public.event_types where name in
  ('Food Pantry','Handy Man Services','Honor Flights','Breakfast with Knights','Foster Children Support','Right to Life')),
  6, 'six seeded event types');
select is((select category::text from public.event_types where name = 'Right to Life'), 'life', 'Right to Life is a Life program');
select is((select category::text from public.event_types where name = 'Breakfast with Knights'), 'family', 'Breakfast with Knights is Family');

-- recurrence
select results_eq(
  $$ select d from kit.series_dates('{"freq":"weekly","interval":2,"weekdays":[2,4],"start_date":"2040-10-04","until":"2040-10-31"}') d $$,
  $$ values ('2040-10-04'::date), ('2040-10-16'::date), ('2040-10-18'::date), ('2040-10-30'::date) $$,
  'weekly every 2 weeks on Tuesday and Thursday');
select results_eq(
  $$ select d from kit.series_dates('{"freq":"monthly","weekday":6,"nth":2,"start_date":"2040-10-01","until":"2041-01-31"}') d $$,
  $$ values ('2040-10-13'::date), ('2040-11-10'::date), ('2040-12-08'::date), ('2041-01-12'::date) $$,
  'monthly on the 2nd Saturday');
select results_eq(
  $$ select d from kit.series_dates('{"freq":"monthly","weekday":6,"nth":-1,"start_date":"2040-10-01","until":"2041-01-31"}') d $$,
  $$ values ('2040-10-27'::date), ('2040-11-24'::date), ('2040-12-29'::date), ('2041-01-26'::date) $$,
  'monthly on the last Saturday');
select is((select count(*)::int from kit.series_dates('{"freq":"monthly","weekday":6,"nth":2,"start_date":"2040-10-20","until":"2040-11-30"}')),
  1, 'a monthly date before the start date is skipped');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":1,"weekdays":[1],"start_date":"2040-10-01","until":"2041-10-02"}') $$,
  'P0001', 'A repeat can run for at most one year', 'a repeat is capped at one year');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":1,"weekdays":[1],"start_date":"2040-10-10","until":"2040-10-01"}') $$,
  'P0001', 'The repeat must end on or after the first date', 'until before start is refused');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":1,"weekdays":[],"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Choose at least one weekday', 'weekly needs a weekday');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":5,"weekdays":[1],"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Repeat every 1 to 4 weeks', 'interval is 1 to 4');
select throws_ok($$ select kit.series_dates('{"freq":"monthly","weekday":6,"nth":5,"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Choose first, second, third, fourth or last', 'nth is 1-4 or -1');
select throws_ok($$ select kit.series_dates('{"freq":"daily","start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Unknown repeat pattern', 'unknown freq');

-- local time, DST (ends 2040-11-04) and midnight crossing
select is(((select starts_at from kit.local_span('2040-11-02', '09:00', '11:00')) at time zone 'America/Chicago')::time,
  '09:00'::time, 'local start before DST ends');
select is(((select starts_at from kit.local_span('2040-11-05', '09:00', '11:00')) at time zone 'America/Chicago')::time,
  '09:00'::time, 'local start after DST ends');
select isnt((select starts_at at time zone 'UTC' from kit.local_span('2040-11-02', '09:00', '11:00'))::time,
  (select starts_at at time zone 'UTC' from kit.local_span('2040-11-05', '09:00', '11:00'))::time,
  'the UTC hour moves across DST so the local hour does not');
select is((select ends_at - starts_at from kit.local_span('2040-10-10', '22:00', '02:00')), interval '4 hours',
  'a shift that crosses midnight ends the next day');

-- preview gate and result
select tests.act_as(:'knight');
select throws_ok($$ select public.event_series_preview('{"freq":"weekly","interval":1,"weekdays":[1],"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  '42501', 'forbidden', 'a member cannot preview a series');
select tests.act_as(:'admin');
select is(public.event_series_preview('{"freq":"monthly","weekday":6,"nth":2,"start_date":"2040-10-01","until":"2041-01-31"}'),
  '{"count": 4, "first": "2040-10-13", "last": "2041-01-12"}'::jsonb, 'preview counts and bounds the dates');

-- event types
select lives_ok($$ select public.event_types_save('{"name":"Coats for Kids","category":"community","description":"","active":true}') $$,
  'an officer adds a type');
select throws_ok($$ select public.event_types_save('{"name":"coats for kids","category":"community","active":true}') $$,
  'P0001', 'An event type with that name already exists', 'type names are unique, ignoring case');
select throws_ok($$ select public.event_types_save('{"name":"X","category":"sports","active":true}') $$,
  'P0001', 'Choose a category', 'category must be one of the four');
select throws_ok($$ select public.event_types_save('{"name":"  ","category":"life","active":true}') $$,
  'P0001', 'Name is required (100 characters at most)', 'blank name refused');
select tests.act_as(:'knight');
select throws_ok($$ select public.event_types_save('{"name":"Y","category":"life","active":true}') $$,
  '42501', 'forbidden', 'a member cannot save a type');

-- RLS
select is((select count(*)::int from public.event_types where active), 7, 'a member reads the active types');
select throws_ok($$ select count(*) from public.event_signups $$, '42501', null, 'sign-ups are not directly readable');
select tests.act_as(:'nobody');
select is((select count(*)::int from public.event_types), 0, 'no events.view, no types');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter portal exec supabase test db`
Expected: `events_schema.test.sql` fails, because `function kit.series_dates(unknown) does not exist` or there are no `events` permission rows.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20261002120000_volunteer_events.sql`:

```sql
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
```

- [ ] **Step 4: Apply the migration and run the tests**

Run:
```bash
pnpm --filter portal exec supabase migration up
pnpm --filter portal exec supabase test db
```
Expected: every file passes, including `events_schema.test.sql`.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/supabase/migrations/20261002120000_volunteer_events.sql apps/portal/supabase/tests/events_schema.test.sql
git commit -m "feat(events): schema, permissions and recurrence dates"
```

---

### Task 2: Creating, editing and reading events

**Files:**
- Create: `apps/portal/supabase/migrations/20261002120100_volunteer_events_manage.sql`
- Test: `apps/portal/supabase/tests/events_manage.test.sql`

**Interfaces:**
- Consumes (from Task 1): the tables, `kit.assert_events_*`, `kit.local_span`, `kit.series_dates`, `kit.validate_event_fields`, `kit.validate_shifts`, `kit.can_take_attendance` and `kit.my_member_id`.
- Produces:
  - `public.event_create(p jsonb) returns jsonb` → `{seriesId, eventIds}`.
    - `p` carries `type_id`, `title`, `description`, `location`, `date` (YYYY-MM-DD), `start_time` and `end_time` (HH:MM), `lead_member_id`, `is_public`, `shifts` (`[{start_time, end_time, capacity, label}]`) and an optional `repeat` (a rule without `start_date`).
  - `public.event_update(p_event_id uuid, p_fields jsonb, p_scope text default 'this') returns void`.
  - `public.event_shifts_save(p_event_id uuid, p_shifts jsonb) returns void`, where items are `{id?, start_time, end_time, capacity, label}`.
  - `public.events_in_range(p_from date, p_to date, p_type_id uuid default null)` returns table `(id, title, type_id, type_name, category, starts_at, ends_at, status, is_public, series_id, capacity int, filled int, signed_up boolean)`.
  - `public.event_detail(p_event_id uuid) returns jsonb` with this shape:

    ```
    {id, title, description, location, startsAt, endsAt, status, isPublic,
     seriesId, typeId, typeName, category, leadMemberId, leadName,
     canTakeAttendance, canManage, myMemberId,
     shifts: [{id, startsAt, endsAt, capacity, label, filled,
               signups: [{id, memberId, name, status, hours}]}]}
    ```

  - `public.event_member_search(p_event_id uuid, p_query text)` returns table `(id uuid, full_name text, membership_number text)`.

- [ ] **Step 1: Write the failing test**

`apps/portal/supabase/tests/events_manage.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select no_plan();

select tests.make_user('ev2-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev2-knight@example.com', 'member') as knight \gset
select tests.make_user('ev2-lead@example.com', 'member') as lead_user \gset
select tests.make_member('EV2-LEAD', :'lead_user') as lead_member \gset
select tests.make_member('EV2-OTHER') as other_member \gset
select id as pantry from public.event_types where name = 'Food Pantry' \gset

-- gates
select tests.act_as(:'knight');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', 'X', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',2)))),
  '42501', 'forbidden', 'a member cannot create events');

select tests.act_as(:'admin');

-- validation
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', 'X', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00', 'shifts', '[]'::json)),
  'P0001', 'Add at least one shift', 'an event needs a shift');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', 'X', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',0)))),
  'P0001', 'Volunteers needed must be between 1 and 200', 'capacity must be at least 1');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', '  ', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',2)))),
  'P0001', 'Title is required (200 characters at most)', 'title is required');

-- a single event
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Pantry', 'location', 'Hall',
    'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00', 'lead_member_id', :'lead_member',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','10:30','capacity',2,'label','Early'),
                               json_build_object('start_time','10:30','end_time','12:00','capacity',3)))::jsonb)
  ->'eventIds'->>0) as single \gset
select is((select count(*)::int from public.event_shifts where event_id = :'single'), 2, 'two shifts created');
select is(((select starts_at from public.events where id = :'single') at time zone 'America/Chicago')::text,
  '2040-10-06 09:00:00', 'the event starts at 09:00 Chicago');

-- a weekly series across DST (ends 2040-11-04)
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Tuesday pantry',
    'date', '2040-10-30', 'start_time', '09:00', 'end_time', '11:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','11:00','capacity',4)),
    'repeat', json_build_object('freq','weekly','interval',1,'weekdays',json_build_array(2),'until','2040-11-13'))::jsonb)
  ->>'seriesId') as series \gset
select is((select count(*)::int from public.events where series_id = :'series'), 3, 'three weekly events');
select is((select count(distinct (starts_at at time zone 'America/Chicago')::time)::int from public.events where series_id = :'series'),
  1, 'every date keeps the 09:00 local start');
select is((select count(*)::int from public.event_shifts sh join public.events e on e.id = sh.event_id where e.series_id = :'series'),
  3, 'each date gets its shifts');
select id as second from public.events where series_id = :'series' order by starts_at offset 1 limit 1 \gset

-- update: following changes later events only, never times
select lives_ok(format($$ select public.event_update(%L, '{"title":"Renamed"}', 'following') $$, :'second'), 'rename this and later');
select is((select array_agg(title order by starts_at) from public.events where series_id = :'series'),
  array['Tuesday pantry','Renamed','Renamed'], 'earlier events keep their title');
select throws_ok(format($$ select public.event_update(%L, '{"start_time":"10:00"}', 'following') $$, :'second'),
  'P0001', 'Times can only be changed one event at a time', 'series-wide time changes refused');
select lives_ok(format($$ select public.event_update(%L, '{"title":"Solo"}', 'following') $$, :'single'),
  'following on a non-series event');
select is((select count(*)::int from public.events where title = 'Solo'), 1, 'only that event changed');
select throws_ok(format($$ select public.event_update(%L, '{"bogus":1}', 'this') $$, :'single'),
  'P0001', 'unknown field: bogus', 'unknown field refused');

-- update: moving the date moves the shifts, keeping local time
select lives_ok(format($$ select public.event_update(%L, '{"date":"2040-11-06"}', 'this') $$, :'single'), 'move the date');
select is((select array_agg(to_char(starts_at at time zone 'America/Chicago', 'YYYY-MM-DD HH24:MI') order by starts_at)
           from public.event_shifts where event_id = :'single'),
  array['2040-11-06 09:00','2040-11-06 10:30'], 'shifts moved with the event, local times kept');

-- cancel this and later
select lives_ok(format($$ select public.event_update(%L, '{"status":"cancelled"}', 'following') $$, :'second'), 'cancel this and later');
select is((select array_agg(status::text order by starts_at) from public.events where series_id = :'series'),
  array['scheduled','cancelled','cancelled'], 'first date stays scheduled');

-- shifts save
select id as early from public.event_shifts where event_id = :'single' and label = 'Early' \gset
select tests.act_as_service();
insert into public.event_signups (shift_id, member_id) values (:'early', :'other_member');
select tests.act_as(:'admin');
select throws_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'single',
    json_build_array(json_build_object('start_time','10:30','end_time','12:00','capacity',3))),
  'P0001', 'A shift with volunteers cannot be removed; cancel the event instead', 'cannot delete a shift with volunteers');
select tests.act_as_service();
insert into public.event_signups (shift_id, member_id) values (:'early', :'lead_member');
select tests.act_as(:'admin');
select throws_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'single',
    json_build_array(json_build_object('id', :'early', 'start_time','09:00','end_time','10:30','capacity',1))),
  'P0001', 'Volunteers needed cannot be below the 2 already signed up', 'capacity cannot drop below sign-ups');
select lives_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'single',
    json_build_array(json_build_object('id', :'early', 'start_time','08:30','end_time','10:30','capacity',5,'label','Early'),
                     json_build_object('start_time','12:00','end_time','13:00','capacity',1))),
  'edit one shift, drop an empty one, add one');
select is((select count(*)::int from public.event_shifts where event_id = :'single'), 2, 'still two shifts');
select is((select capacity from public.event_shifts where id = :'early'), 5, 'capacity raised');

-- calendar
select is((select count(*)::int from public.events_in_range('2040-10-01', '2040-11-30')), 4, 'four events in range');
select is((select filled from public.events_in_range('2040-11-06', '2040-11-06') where id = :'single'), 2, 'filled counts active sign-ups');
select throws_ok($$ select * from public.events_in_range('2040-10-01', '2041-01-01') $$,
  'P0001', 'Choose a range of at most 62 days', 'range is capped');

-- detail: hours only for attendance takers or your own
select tests.act_as_service();
update public.event_signups set status = 'attended', hours = 1.5 where shift_id = :'early' and member_id = :'other_member';
select tests.act_as(:'knight');
select is(public.event_detail(:'single')->'shifts'->0->'signups'->1->'hours', 'null'::jsonb, 'a member does not see others'' hours');
select is((public.event_detail(:'single')->>'canTakeAttendance')::boolean, false, 'a member cannot take attendance');
select tests.act_as(:'lead_user');
select is((public.event_detail(:'single')->>'canTakeAttendance')::boolean, true, 'the lead can take attendance');
select isnt((select s->'hours' from jsonb_array_elements(public.event_detail(:'single')->'shifts'->0->'signups') s
             where s->>'memberId' = :'other_member'), 'null'::jsonb, 'the lead sees hours');

-- member search
select is((select count(*)::int from public.event_member_search(:'single', 'EV2-OTHER')), 1, 'the lead searches members');
select tests.act_as(:'knight');
select throws_ok(format($$ select * from public.event_member_search(%L, 'EV2') $$, :'single'),
  '42501', 'forbidden', 'a member cannot search');
select throws_ok($$ select * from public.event_member_search(null, 'EV2') $$,
  '42501', 'forbidden', 'searching for a lead needs manage');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter portal exec supabase test db`
Expected: `events_manage.test.sql` fails, because `function public.event_create(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20261002120100_volunteer_events_manage.sql`:

```sql
-- Volunteer events: creating, editing and reading events.

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
  perform kit.validate_event_fields(p_fields, false);

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

create or replace function public.events_in_range(p_from date, p_to date, p_type_id uuid default null)
returns table (
  id uuid, title text, type_id uuid, type_name text, category public.program_category,
  starts_at timestamptz, ends_at timestamptz, status public.event_status, is_public boolean,
  series_id uuid, capacity integer, filled integer, signed_up boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_me uuid;
begin
  perform kit.assert_events_view();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a range of at most 62 days';
  end if;
  v_me := kit.my_member_id();

  return query
  select e.id, e.title, e.type_id, t.name, t.category, e.starts_at, e.ends_at, e.status, e.is_public, e.series_id,
         (select coalesce(sum(sh.capacity), 0)::integer from public.event_shifts sh where sh.event_id = e.id),
         (select count(*)::integer from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
           where sh.event_id = e.id and s.status in ('signed_up', 'attended')),
         exists (select 1 from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
                  where sh.event_id = e.id and s.status in ('signed_up', 'attended') and s.member_id = v_me)
  from public.events e
  join public.event_types t on t.id = e.type_id
  where (e.starts_at at time zone 'America/Chicago')::date between p_from and p_to
    and (p_type_id is null or e.type_id = p_type_id)
  order by e.starts_at;
end $$;

create or replace function public.event_detail(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_can    boolean;
  v_me     uuid;
  v_result jsonb;
begin
  perform kit.assert_events_view();
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'unknown event';
  end if;
  v_can := kit.can_take_attendance(p_event_id);
  v_me := kit.my_member_id();

  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description, 'location', e.location,
    'startsAt', e.starts_at, 'endsAt', e.ends_at, 'status', e.status, 'isPublic', e.is_public,
    'seriesId', e.series_id, 'typeId', e.type_id, 'typeName', t.name, 'category', t.category,
    'leadMemberId', e.lead_member_id,
    'leadName', case when lm.id is null then null else lm.first_name || ' ' || lm.last_name end,
    'canTakeAttendance', v_can,
    'canManage', kit.has_permission('events', 'manage'),
    'myMemberId', v_me,
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sh.id, 'startsAt', sh.starts_at, 'endsAt', sh.ends_at, 'capacity', sh.capacity, 'label', sh.label,
        'filled', (select count(*) from public.event_signups s
                    where s.shift_id = sh.id and s.status in ('signed_up', 'attended')),
        'signups', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'memberId', s.member_id, 'name', m.first_name || ' ' || m.last_name,
            'status', s.status,
            'hours', case when v_can or s.member_id = v_me then s.hours end
          ) order by m.last_name, m.first_name)
          from public.event_signups s join public.members m on m.id = s.member_id
          where s.shift_id = sh.id and s.status <> 'cancelled'
        ), '[]'::jsonb)
      ) order by sh.starts_at)
      from public.event_shifts sh where sh.event_id = e.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.events e
  join public.event_types t on t.id = e.type_id
  left join public.members lm on lm.id = e.lead_member_id
  where e.id = p_event_id;

  return v_result;
end $$;

-- Picking a lead needs events.manage; adding a walk-in needs attendance rights on that event.
create or replace function public.event_member_search(p_event_id uuid, p_query text)
returns table (id uuid, full_name text, membership_number text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if p_event_id is null then
    perform kit.assert_events_manage();
  elsif not kit.can_take_attendance(p_event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  return query
  select m.id, m.first_name || ' ' || m.last_name, m.membership_number
  from public.members m
  where (m.first_name || ' ' || m.last_name) ilike '%' || v_q || '%'
     or m.membership_number ilike v_q || '%'
  order by m.last_name, m.first_name
  limit 20;
end $$;

revoke all on function public.event_create(jsonb)                   from public, anon;
revoke all on function public.event_update(uuid, jsonb, text)       from public, anon;
revoke all on function public.event_shifts_save(uuid, jsonb)        from public, anon;
revoke all on function public.events_in_range(date, date, uuid)     from public, anon;
revoke all on function public.event_detail(uuid)                    from public, anon;
revoke all on function public.event_member_search(uuid, text)      from public, anon;
grant execute on function public.event_create(jsonb)                to authenticated;
grant execute on function public.event_update(uuid, jsonb, text)    to authenticated;
grant execute on function public.event_shifts_save(uuid, jsonb)     to authenticated;
grant execute on function public.events_in_range(date, date, uuid)  to authenticated;
grant execute on function public.event_detail(uuid)                 to authenticated;
grant execute on function public.event_member_search(uuid, text)    to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

Run:
```bash
pnpm --filter portal exec supabase migration up
pnpm --filter portal exec supabase test db
```
Expected: every file passes.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/supabase/migrations/20261002120100_volunteer_events_manage.sql apps/portal/supabase/tests/events_manage.test.sql
git commit -m "feat(events): create, edit, series and read events"
```

---

### Task 3: Sign-ups, attendance, hours, report and DB types

**Files:**
- Create: `apps/portal/supabase/migrations/20261002120200_volunteer_events_signups.sql`
- Test: `apps/portal/supabase/tests/events_signups.test.sql`
- Modify: `packages/supabase/src/database.types.ts` and `apps/portal/lib/database.types.ts`. Add by hand every table, enum and function from Tasks 1–3.

**Interfaces:**
- Consumes: Task 1 and Task 2 objects.
- Produces:
  - `public.event_signup(p_shift_id uuid) returns uuid`
  - `public.event_cancel_signup(p_signup_id uuid) returns void`
  - `public.event_add_volunteer(p_shift_id uuid, p_member_id uuid) returns uuid`
  - `public.event_set_attendance(p_signup_id uuid, p_status text, p_hours numeric default null) returns void`
  - `kit.my_volunteering_at(p_member_id uuid, p_now timestamptz) returns jsonb`
  - `public.my_volunteering() returns jsonb`, which returns `{linked:false}` for an unlinked sign-in, or this shape:

    ```
    {linked:true, year, yearHours, allTimeHours,
     byCategory: [{category, hours}],
     upcoming: [{signupId, eventId, title, startsAt, endsAt, label}],
     history: [{signupId, eventId, title, typeName, startsAt, status, hours, eventCancelled}]}
    ```

  - `kit.volunteer_report_at(p_year integer, p_now timestamptz) returns jsonb`
  - `public.volunteer_report(p_year integer) returns jsonb`, with this shape:

    ```
    {year,
     totals: {hours, volunteers, events},
     byCategory: [{category, hours, volunteers, events}],
     byType: [{typeId, name, category, hours, volunteers, events}],
     byMember: [{memberId, name, membershipNumber, events, hours}],
     pending: [{eventId, title, shiftId, startsAt, endsAt, leadName, waiting}]}
    ```

- [ ] **Step 1: Write the failing test**

`apps/portal/supabase/tests/events_signups.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select no_plan();

select tests.make_user('ev3-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev3-a@example.com', 'member') as ua \gset
select tests.make_user('ev3-b@example.com', 'member') as ub \gset
select tests.make_user('ev3-c@example.com', 'member') as uc \gset
select tests.make_user('ev3-lead2@example.com', 'member') as ulead2 \gset
select tests.make_user('ev3-unlinked@example.com', 'member') as unlinked \gset
select tests.make_member('EV3-A', :'ua') as ma \gset
select tests.make_member('EV3-B', :'ub') as mb \gset
select tests.make_member('EV3-C', :'uc') as mc \gset
select tests.make_member('EV3-L2', :'ulead2') as ml2 \gset
select id as pantry from public.event_types where name = 'Food Pantry' \gset
select id as rtl from public.event_types where name = 'Right to Life' \gset

-- Fixture: one event with one shift, inserted directly (times relative to now()).
create or replace function tests.ev_shift(p_type uuid, p_starts timestamptz, p_hours numeric, p_capacity integer, p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_shift uuid;
begin
  insert into public.events (type_id, title, starts_at, ends_at, lead_member_id)
  values (p_type, 'Fixture', p_starts, p_starts + p_hours * interval '1 hour', p_lead) returning id into v_event;
  insert into public.event_shifts (event_id, starts_at, ends_at, capacity)
  values (v_event, p_starts, p_starts + p_hours * interval '1 hour', p_capacity) returning id into v_shift;
  return v_shift;
end $$;
grant execute on function tests.ev_shift(uuid, timestamptz, numeric, integer, uuid) to authenticated;

select tests.ev_shift(:'pantry', now() + interval '1 day', 2.5, 2, :'ma') as future \gset
select tests.ev_shift(:'pantry', now() - interval '3 hours', 2.5, 2, :'ma') as past \gset
select tests.ev_shift(:'rtl', now() - interval '5 hours', 2, 5, :'ml2') as past_rtl \gset
select event_id as future_event from public.event_shifts where id = :'future' \gset
select event_id as past_event from public.event_shifts where id = :'past' \gset

-- sign up
select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_signup(%L) $$, :'future'), 'A signs up');
select throws_ok(format($$ select public.event_signup(%L) $$, :'future'),
  'P0001', 'You are already signed up for this shift.', 'no double sign-up');
select tests.act_as(:'ub');
select lives_ok(format($$ select public.event_signup(%L) $$, :'future'), 'B signs up');
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_signup(%L) $$, :'future'), 'P0001', 'This shift is full.', 'C is refused: full');
select throws_ok(format($$ select public.event_signup(%L) $$, :'past'), 'P0001', 'This shift has already started.', 'no sign-up after start');
select tests.act_as(:'unlinked');
select throws_ok(format($$ select public.event_signup(%L) $$, :'future'),
  'P0001', 'Your sign-in is not linked to a council member record.', 'unlinked user refused');

-- cancel and re-sign
select tests.act_as(:'ub');
select lives_ok(format($$ select public.event_cancel_signup(%L) $$,
  (select id from public.event_signups where shift_id = :'future' and member_id = :'mb')), 'B cancels');
select lives_ok(format($$ select public.event_signup(%L) $$, :'future'), 'B signs up again after cancelling');
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_cancel_signup(%L) $$,
  (select id from public.event_signups where shift_id = :'future' and member_id = :'ma')), '42501', 'forbidden',
  'C cannot cancel A');

-- cancelled event
select tests.act_as_service();
update public.events set status = 'cancelled' where id = (select event_id from public.event_shifts where id = :'past_rtl');
select tests.act_as(:'uc');
select tests.act_as_service();
select tests.ev_shift(:'pantry', now() + interval '2 days', 1, 3, null) as later \gset
update public.events set status = 'cancelled' where id = (select event_id from public.event_shifts where id = :'later');
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_signup(%L) $$, :'later'), 'P0001', 'This event has been cancelled.', 'no sign-up on a cancelled event');

-- walk-ins and attendance on the past shift (lead = A)
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'mc'), '42501', 'forbidden', 'a member cannot add walk-ins');
select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'mb'), 'lead adds B');
select lives_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'mc'), 'lead adds C');
select lives_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'ma'), 'lead adds self beyond capacity');
select is((select count(*)::int from public.event_signups where shift_id = :'past' and status = 'signed_up'), 3, 'walk-ins ignore capacity');

select lives_ok(format($$ select public.event_set_attendance(%L, 'attended') $$,
  (select id from public.event_signups where shift_id = :'past' and member_id = :'mb')), 'B attended, default hours');
select is((select hours from public.event_signups where shift_id = :'past' and member_id = :'mb'), 2.50, 'default hours are the shift length');
select lives_ok(format($$ select public.event_set_attendance(%L, 'attended', 1.75) $$,
  (select id from public.event_signups where shift_id = :'past' and member_id = :'ma')), 'A attended 1.75');
select lives_ok(format($$ select public.event_set_attendance(%L, 'no_show') $$,
  (select id from public.event_signups where shift_id = :'past' and member_id = :'mc')), 'C no-show');
select is((select hours from public.event_signups where shift_id = :'past' and member_id = :'mc'), null, 'no-show has no hours');
select throws_ok(format($$ select public.event_set_attendance(%L, 'attended', 1.1) $$,
  (select id from public.event_signups where shift_id = :'past' and member_id = :'mc')),
  'P0001', 'Hours must be between 0 and 24, in quarter hours', 'quarter hours only');
select throws_ok(format($$ select public.event_set_attendance(%L, 'attended') $$,
  (select id from public.event_signups where shift_id = :'future' and member_id = :'ma')),
  'P0001', 'Attendance can be taken once the shift has started.', 'no attendance before start');
select tests.act_as(:'ulead2');
select throws_ok(format($$ select public.event_set_attendance(%L, 'attended') $$,
  (select id from public.event_signups where shift_id = :'past' and member_id = :'mb')), '42501', 'forbidden',
  'another event''s lead cannot take this attendance');
select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_cancel_signup(%L) $$,
  (select id from public.event_signups where shift_id = :'future' and member_id = :'mb')), 'the lead cancels a sign-up on their event');

-- hours: attended only, scheduled events only
select tests.act_as_service();
insert into public.event_signups (shift_id, member_id, status, hours) values (:'past_rtl', :'ma', 'attended', 3);
select is((kit.my_volunteering_at(:'ma', now())->>'yearHours')::numeric, 1.75, 'a cancelled event''s hours do not count');
select is((kit.my_volunteering_at(:'mb', now())->>'allTimeHours')::numeric, 2.50, 'B has 2.5 hours');
select is(jsonb_array_length(kit.my_volunteering_at(:'ma', now())->'upcoming'), 1, 'A has one upcoming shift');
select is(jsonb_array_length(kit.my_volunteering_at(:'ma', now())->'byCategory'), 4, 'all four categories listed');
select tests.act_as(:'unlinked');
select is(public.my_volunteering(), '{"linked": false}'::jsonb, 'unlinked sign-in');

-- report
select tests.act_as(:'ua');
select throws_ok($$ select public.volunteer_report(2040) $$, '42501', 'forbidden', 'a member cannot read the report');
select tests.act_as(:'admin');
select throws_ok($$ select public.volunteer_report(1999) $$, 'P0001', null, 'year is validated');
select tests.act_as_service();
select tests.ev_shift(:'pantry', now() - interval '6 hours', 1, 2, :'ma') as pending_shift \gset
insert into public.event_signups (shift_id, member_id) values (:'pending_shift', :'mc');
select kit.fraternal_year_of(kit.council_today()) as fy \gset
select is((kit.volunteer_report_at(:'fy', now())->'totals'->>'hours')::numeric, 4.25, 'total confirmed hours');
select is((kit.volunteer_report_at(:'fy', now())->'totals'->>'volunteers')::int, 2, 'two volunteers');
select is((kit.volunteer_report_at(:'fy', now())->'totals'->>'events')::int, 1, 'one event held');
select is((select (c->>'hours')::numeric from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'byCategory') c
           where c->>'category' = 'community'), 4.25, 'community hours');
select is((select (c->>'hours')::numeric from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'byCategory') c
           where c->>'category' = 'life'), 0::numeric, 'the cancelled Life event counts nothing');
select is((select (m->>'hours')::numeric from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'byMember') m
           where m->>'membershipNumber' = 'EV3-B'), 2.50, 'B by member');
select is((select (p->>'waiting')::int from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'pending') p
           where p->>'shiftId' = :'pending_shift'), 1, 'attendance not taken is listed');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter portal exec supabase test db`
Expected: `events_signups.test.sql` fails, because `function public.event_signup(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20261002120200_volunteer_events_signups.sql`:

```sql
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
```

- [ ] **Step 4: Apply the migration and run the tests**

Run:
```bash
pnpm --filter portal exec supabase migration up
pnpm --filter portal exec supabase test db
```
Expected: every file passes.

- [ ] **Step 5: Add the DB types by hand**

Run `pnpm --filter portal exec supabase gen types typescript --local > $TMPDIR/types.ts`. From that file, copy into **both** type files, in alphabetical position and leaving every existing line untouched:
- the `public` Tables `event_types`, `event_series`, `events`, `event_shifts` and `event_signups`;
- the Enums `program_category`, `event_status` and `signup_status`;
- the Functions `event_add_volunteer`, `event_cancel_signup`, `event_create`, `event_detail`, `event_member_search`, `event_series_preview`, `event_set_attendance`, `event_shifts_save`, `event_signup`, `event_types_save`, `event_update`, `events_in_range`, `my_volunteering` and `volunteer_report`.

Make one hand correction. In `events_in_range`'s `Returns`, mark `series_id` as `string | null`, with a `// HAND-CORRECTED` comment in the file's existing style: "`gen types` reports it non-null; it is null for a one-off event."

Then run `pnpm --filter @kit/supabase typecheck && pnpm --filter portal typecheck`. Expected: clean. The two type files must stay byte-identical (`cmp`).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/supabase/migrations/20261002120200_volunteer_events_signups.sql apps/portal/supabase/tests/events_signups.test.sql packages/supabase/src/database.types.ts apps/portal/lib/database.types.ts
git commit -m "feat(events): sign-ups, attendance, hours and the volunteer report"
```

---

### Task 4: `@kit/events` package, section, paths and navigation

**Files:**
- Create: `packages/features/events/package.json`, `tsconfig.json`, `vitest.config.ts` and `test/setup.ts`. Copy the last three from `packages/features/finance`.
- Create:
  - `packages/features/events/src/types.ts`
  - `src/lib/calendar.ts` (+ test)
  - `src/lib/format.ts` (+ test)
  - `src/lib/report-csv.ts` (+ test)
  - `src/lib/errors.ts` (+ test)
  - `src/schemas.ts` (+ test)
  - `src/server/events.service.ts`
  - `src/server/events-actions.ts`
- Modify:
  - `packages/features/rbac/src/types/sections.ts` (the `events` entry, after `finance`);
  - `packages/brand/src/config/paths.config.ts` (`events`, `volunteering`);
  - `packages/brand/i18n/messages/en/common.json` (`routes.events`, `routes.volunteering`);
  - `apps/portal/config/navigation.config.tsx`;
  - `apps/portal/package.json` (add `"@kit/events": "workspace:*"` beside `@kit/finance`).

**Interfaces:**
- Consumes: the RPCs from Tasks 1–3. `readDuesIfDeployed` from `@kit/dues/lib/dues-schema` is generic over missing-schema error codes and is reused as-is.
- Produces:
  - **`@kit/events/types`:** `ProgramCategory`, `CATEGORY_LABELS`, `SignupStatus`, `EventType`, `CalendarEvent`, `EventDetail`, `EventShift`, `ShiftSignup`, `MemberOption`, `SeriesPreview`, `MyVolunteering`, `VolunteerReport`, `EventsActionResult<T>`.
  - **`@kit/events/lib/calendar`:** `parseMonthParam`, `parseViewParam`, `shiftMonth`, `monthGrid`, `gridRange`, `CalendarDay`.
  - **`@kit/events/lib/format`:** `chicagoDate`, `chicagoTime`, `formatTime`, `formatTimeRange`, `formatDay`, `todayInChicago`.
  - **`@kit/events/lib/report-csv`:** `reportCsv`.
  - **`@kit/events/lib/errors`:** `toMessage`.
  - **`@kit/events/schemas`:** `EventFormSchema`, `EventFormValues`, `EventTypeSchema`, `EventTypeValues`, `toCreatePayload`, `toUpdateFields`, `toShiftsPayload`, `toRepeatRule`, `defaultEventValues`, `WEEKDAYS`.
  - **`@kit/events/server/events.service`:** `EventsService`.
  - **`@kit/events/server/events-actions`:**
    - `saveEventTypeAction`, `createEventAction`, `updateEventAction`, `cancelEventAction`, `previewSeriesAction`;
    - `signupAction`, `cancelSignupAction`, `addVolunteerAction`, `setAttendanceAction`, `searchMembersAction`.

- [ ] **Step 1: Scaffold the package**

`packages/features/events/package.json`:

```json
{
  "name": "@kit/events",
  "version": "0.1.0",
  "private": true,
  "typesVersions": { "*": { "*": ["src/*"] } },
  "exports": {
    "./types": "./src/types.ts",
    "./schemas": "./src/schemas.ts",
    "./server/*": "./src/server/*.ts",
    "./components/*": "./src/components/*.tsx",
    "./lib/*": "./src/lib/*.ts"
  },
  "scripts": {
    "clean": "git clean -xdf .turbo node_modules",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "devDependencies": {
    "@hookform/resolvers": "catalog:",
    "@kit/dues": "workspace:*",
    "@kit/finance": "workspace:*",
    "@kit/next": "workspace:*",
    "@kit/supabase": "workspace:*",
    "@kit/tsconfig": "workspace:*",
    "@kit/ui": "workspace:*",
    "@supabase/supabase-js": "catalog:",
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.1.0",
    "@types/jsdom": "^30.0.0",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "jsdom": "^30.1.1",
    "next": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-hook-form": "catalog:",
    "sonner": "catalog:",
    "vitest": "catalog:",
    "zod": "catalog:"
  }
}
```

Copy `tsconfig.json`, `vitest.config.ts` and `test/setup.ts` from `packages/features/finance`. The component tests in Tasks 5–7 use `getByTestId` against `data-test` attributes and jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, `toHaveClass`). Make sure `test/setup.ts`:
- calls `configure({ testIdAttribute: 'data-test' })` from `@testing-library/react`;
- imports `@testing-library/jest-dom/vitest`.

Add whichever is missing, plus the `@testing-library/jest-dom` devDependency (`^6.6.3`) if needed.

Run `pnpm install` from the repo root, with network access to `registry.npmjs.org`.

- [ ] **Step 2: Write the failing lib tests**

`src/lib/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { gridRange, monthGrid, parseMonthParam, parseViewParam, shiftMonth } from './calendar';

describe('calendar', () => {
  it('parses ?month= and falls back to the current month', () => {
    expect(parseMonthParam('2040-10', '2026-09-29')).toBe('2040-10');
    expect(parseMonthParam('2040-13', '2026-09-29')).toBe('2026-09');
    expect(parseMonthParam(undefined, '2026-09-29')).toBe('2026-09');
    expect(parseMonthParam(['2041-01', 'x'], '2026-09-29')).toBe('2041-01');
  });

  it('parses ?view=', () => {
    expect(parseViewParam('list')).toBe('list');
    expect(parseViewParam('month')).toBe('month');
    expect(parseViewParam('bogus')).toBe('month');
  });

  it('moves between months across year ends', () => {
    expect(shiftMonth('2040-12', 1)).toBe('2041-01');
    expect(shiftMonth('2041-01', -1)).toBe('2040-12');
  });

  it('builds Sunday-first weeks covering the month', () => {
    // August 2026 starts on a Saturday and needs six weeks.
    const weeks = monthGrid('2026-08', '2026-08-15');

    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]!.date).toBe('2026-07-26');
    expect(weeks[0]![6]).toMatchObject({ date: '2026-08-01', inMonth: true });
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(weeks.flat().filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-08-15']);
    expect(gridRange(weeks)).toEqual({ from: '2026-07-26', to: '2026-09-05' });
  });

  it('uses four weeks for a February that starts on Sunday', () => {
    expect(monthGrid('2026-02', '2026-09-29')).toHaveLength(4);
  });
});
```

`src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { chicagoDate, chicagoTime, formatTimeRange } from './format';

describe('format', () => {
  it('dates an 11:30 pm Chicago event on its Chicago day, not the UTC day', () => {
    expect(chicagoDate('2040-10-14T04:30:00Z')).toBe('2040-10-13');
  });

  it('gives local clock times for form defaults', () => {
    expect(chicagoTime('2040-10-13T14:00:00Z')).toBe('09:00');
    expect(chicagoTime('2040-11-05T15:00:00Z')).toBe('09:00');
  });

  it('formats a time range', () => {
    expect(formatTimeRange('2040-10-13T14:00:00Z', '2040-10-13T16:30:00Z')).toBe('9:00 AM – 11:30 AM');
  });
});
```

`src/lib/report-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { reportCsv } from './report-csv';

describe('reportCsv', () => {
  it('writes a header and one row per member, quoting where needed', () => {
    expect(
      reportCsv([
        { memberId: 'm1', name: 'Smith, John', membershipNumber: '100', events: 2, hours: 4.5 },
        { memberId: 'm2', name: '=cmd', membershipNumber: '101', events: 1, hours: 1 },
      ]),
    ).toBe('Member,Membership Number,Events,Hours\r\n"Smith, John",100,2,4.5\r\n\'=cmd,101,1,1');
  });
});
```

`src/lib/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { toMessage } from './errors';

describe('toMessage', () => {
  it('maps database errors to readable text', () => {
    expect(toMessage({ code: '42501', message: 'forbidden' })).toBe('You do not have permission to do that.');
    expect(toMessage({ code: 'P0001', message: 'This shift is full.' })).toBe('This shift is full.');
    expect(toMessage({ code: '22P02', message: 'bad uuid' })).toBe('Some of the details are not valid.');
    expect(toMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
```

`src/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { EventFormSchema, defaultEventValues, toCreatePayload, toUpdateFields } from './schemas';

const base = () => ({ ...defaultEventValues('11111111-1111-1111-1111-111111111111', '2040-10-06'), title: 'Pantry' });

describe('EventFormSchema', () => {
  it('accepts the defaults with a title', () => {
    expect(EventFormSchema.safeParse(base()).success).toBe(true);
  });

  it('needs at least one shift and valid capacities', () => {
    const noShifts = EventFormSchema.safeParse({ ...base(), shifts: [] });
    expect(noShifts.error?.issues[0]?.message).toBe('Add at least one shift');

    const zero = EventFormSchema.safeParse({ ...base(), shifts: [{ ...base().shifts[0]!, capacity: 0 }] });
    expect(zero.error?.issues[0]?.message).toBe('At least 1 volunteer');
  });

  it('needs weekdays and an end date for a weekly repeat', () => {
    const r = EventFormSchema.safeParse({ ...base(), repeat: { ...base().repeat, freq: 'weekly', weekdays: [], until: '' } });
    expect(r.error?.issues.map((i) => i.message).sort()).toEqual(['Choose at least one weekday', 'Choose when the repeat ends']);
  });
});

describe('payloads', () => {
  it('omits repeat when it is none and builds a weekly rule otherwise', () => {
    expect(toCreatePayload(base())).not.toHaveProperty('repeat');
    expect(
      toCreatePayload({ ...base(), repeat: { ...base().repeat, freq: 'weekly', weekdays: [2], interval: 1, until: '2040-12-01' } }).repeat,
    ).toEqual({ freq: 'weekly', interval: 1, weekdays: [2], until: '2040-12-01' });
    expect(
      toCreatePayload({ ...base(), repeat: { ...base().repeat, freq: 'monthly', weekday: 6, nth: -1, until: '2040-12-01' } }).repeat,
    ).toEqual({ freq: 'monthly', weekday: 6, nth: -1, until: '2040-12-01' });
  });

  it('sends times only when editing one event', () => {
    expect(toUpdateFields(base(), 'this')).toHaveProperty('start_time', '09:00');
    expect(toUpdateFields(base(), 'following')).not.toHaveProperty('start_time');
    expect(toUpdateFields(base(), 'following')).not.toHaveProperty('date');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @kit/events exec vitest run`
Expected: FAIL, because the modules are not found.

- [ ] **Step 4: Write `src/types.ts`**

```ts
export type ProgramCategory = 'faith' | 'family' | 'community' | 'life';

export const CATEGORY_LABELS: Record<ProgramCategory, string> = {
  faith: 'Faith',
  family: 'Family',
  community: 'Community',
  life: 'Life',
};

export type SignupStatus = 'signed_up' | 'cancelled' | 'attended' | 'no_show';
export type EventStatus = 'scheduled' | 'cancelled';

export interface EventType {
  id: string;
  name: string;
  category: ProgramCategory;
  description: string | null;
  active: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  typeId: string;
  typeName: string;
  category: ProgramCategory;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  isPublic: boolean;
  seriesId: string | null;
  capacity: number;
  filled: number;
  signedUp: boolean;
}

export interface ShiftSignup {
  id: string;
  memberId: string;
  name: string;
  status: SignupStatus;
  hours: number | null;
}

export interface EventShift {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  label: string | null;
  filled: number;
  signups: ShiftSignup[];
}

export interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  isPublic: boolean;
  seriesId: string | null;
  typeId: string;
  typeName: string;
  category: ProgramCategory;
  leadMemberId: string | null;
  leadName: string | null;
  canTakeAttendance: boolean;
  canManage: boolean;
  myMemberId: string | null;
  shifts: EventShift[];
}

export interface MemberOption {
  id: string;
  fullName: string;
  membershipNumber: string;
}

export interface SeriesPreview {
  count: number;
  first: string | null;
  last: string | null;
}

export type MyVolunteering =
  | { linked: false }
  | {
      linked: true;
      year: number;
      yearHours: number;
      allTimeHours: number;
      byCategory: { category: ProgramCategory; hours: number }[];
      upcoming: { signupId: string; eventId: string; title: string; startsAt: string; endsAt: string; label: string | null }[];
      history: {
        signupId: string;
        eventId: string;
        title: string;
        typeName: string;
        startsAt: string;
        status: SignupStatus;
        hours: number | null;
        eventCancelled: boolean;
      }[];
    };

export interface ReportMemberRow {
  memberId: string;
  name: string;
  membershipNumber: string;
  events: number;
  hours: number;
}

export interface VolunteerReport {
  year: number;
  totals: { hours: number; volunteers: number; events: number };
  byCategory: { category: ProgramCategory; hours: number; volunteers: number; events: number }[];
  byType: { typeId: string; name: string; category: ProgramCategory; hours: number; volunteers: number; events: number }[];
  byMember: ReportMemberRow[];
  pending: { eventId: string; title: string; shiftId: string; startsAt: string; endsAt: string; leadName: string | null; waiting: number }[];
}

export type EventsActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };
```

- [ ] **Step 5: Write the lib files**

`src/lib/calendar.ts`:

```ts
export type CalendarView = 'month' | 'list';

export interface CalendarDay {
  date: string;
  inMonth: boolean;
  isToday: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseMonthParam(raw: string | string[] | undefined, today: string): string {
  const value = first(raw);

  return value && MONTH.test(value) ? value : today.slice(0, 7);
}

export function parseViewParam(raw: string | string[] | undefined): CalendarView {
  return first(raw) === 'list' ? 'list' : 'month';
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);

  return new Date(Date.UTC(year!, m! - 1 + delta, 1)).toISOString().slice(0, 7);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);

  return d.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Sunday-first weeks covering `month` (YYYY-MM), padded with the days around it. */
export function monthGrid(month: string, today: string): CalendarDay[][] {
  const firstDay = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const weeks: CalendarDay[][] = [];
  let day = addDays(firstDay, -weekday(firstDay));

  while (day < next) {
    const week: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {
      week.push({ date: day, inMonth: day.startsWith(month), isToday: day === today });
      day = addDays(day, 1);
    }

    weeks.push(week);
  }

  return weeks;
}

export function gridRange(weeks: CalendarDay[][]): { from: string; to: string } {
  const days = weeks.flat();

  return { from: days[0]!.date, to: days[days.length - 1]!.date };
}
```

`src/lib/format.ts`:

```ts
const ZONE = 'America/Chicago';

/** YYYY-MM-DD of an instant in Chicago. */
export function chicagoDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** HH:MM (24-hour) of an instant in Chicago. */
export function chicagoTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function todayInChicago(): string {
  return chicagoDate(new Date().toISOString());
}

export function formatTime(iso: string): string {
  // Newer ICU puts a narrow no-break space (U+202F) before AM/PM.
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/\u202f/g, ' ');
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}
```

`src/lib/report-csv.ts`:

```ts
import type { ReportMemberRow } from '../types';

const FORMULA_STARTERS = /^[=@]/;

function escapeCsv(value: string): string {
  const defused = FORMULA_STARTERS.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}

export function reportCsv(rows: ReportMemberRow[]): string {
  return [
    'Member,Membership Number,Events,Hours',
    ...rows.map((r) => [r.name, r.membershipNumber, String(r.events), String(r.hours)].map(escapeCsv).join(',')),
  ].join('\r\n');
}
```

`src/lib/errors.ts`:

```ts
/** Database errors as sentences for a toast. `P0001` messages are written for people. */
export function toMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to do that.';
    case 'P0001':
      return e.message || fallback;
    case '23505':
      return 'That already exists.';
    case '22P02':
    case '22007':
    case '22008':
      return 'Some of the details are not valid.';
    default:
      return fallback;
  }
}
```

- [ ] **Step 6: Write `src/schemas.ts`**

```ts
import * as z from 'zod';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const ShiftRowSchema = z.object({
  id: z.string().optional(),
  start_time: z.string().regex(TIME, 'Enter a start time'),
  end_time: z.string().regex(TIME, 'Enter an end time'),
  capacity: z.number().int('Whole volunteers only').min(1, 'At least 1 volunteer').max(200, 'At most 200 volunteers'),
  label: z.string().trim().max(100, 'Label must be 100 characters or fewer'),
});

const RepeatSchema = z.object({
  freq: z.enum(['none', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(4),
  weekdays: z.array(z.number().int().min(0).max(6)),
  weekday: z.number().int().min(0).max(6),
  nth: z.number().int().refine((n) => (n >= 1 && n <= 4) || n === -1, 'Choose first to fourth, or last'),
  until: z.string(),
});

export const EventFormSchema = z
  .object({
    type_id: z.string().min(1, 'Choose an event type'),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
    description: z.string().trim().max(5000, 'Description must be 5000 characters or fewer'),
    location: z.string().trim().max(300, 'Location must be 300 characters or fewer'),
    date: z.string().regex(DATE, 'Choose a date'),
    start_time: z.string().regex(TIME, 'Enter a start time'),
    end_time: z.string().regex(TIME, 'Enter an end time'),
    lead_member_id: z.string(),
    lead_name: z.string(),
    is_public: z.boolean(),
    shifts: z.array(ShiftRowSchema).min(1, 'Add at least one shift').max(20, 'At most 20 shifts'),
    repeat: RepeatSchema,
  })
  .superRefine((v, ctx) => {
    if (v.repeat.freq === 'weekly' && v.repeat.weekdays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['repeat', 'weekdays'], message: 'Choose at least one weekday' });
    }
    if (v.repeat.freq !== 'none' && !DATE.test(v.repeat.until)) {
      ctx.addIssue({ code: 'custom', path: ['repeat', 'until'], message: 'Choose when the repeat ends' });
    }
  });

export type EventFormValues = z.infer<typeof EventFormSchema>;

export const EventTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  category: z.enum(['faith', 'family', 'community', 'life']),
  description: z.string().trim().max(1000, 'Description must be 1000 characters or fewer'),
  active: z.boolean(),
});

export type EventTypeValues = z.infer<typeof EventTypeSchema>;

export type RepeatRule =
  | { freq: 'weekly'; interval: number; weekdays: number[]; until: string }
  | { freq: 'monthly'; weekday: number; nth: number; until: string };

export function toRepeatRule(v: EventFormValues): RepeatRule | null {
  const r = v.repeat;

  if (r.freq === 'weekly') return { freq: 'weekly', interval: r.interval, weekdays: r.weekdays, until: r.until };
  if (r.freq === 'monthly') return { freq: 'monthly', weekday: r.weekday, nth: r.nth, until: r.until };

  return null;
}

export function toShiftsPayload(shifts: EventFormValues['shifts']) {
  return shifts.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    start_time: s.start_time,
    end_time: s.end_time,
    capacity: s.capacity,
    label: s.label,
  }));
}

export function toCreatePayload(v: EventFormValues) {
  const rule = toRepeatRule(v);

  return {
    type_id: v.type_id,
    title: v.title,
    description: v.description,
    location: v.location,
    date: v.date,
    start_time: v.start_time,
    end_time: v.end_time,
    lead_member_id: v.lead_member_id || null,
    is_public: v.is_public,
    shifts: toShiftsPayload(v.shifts),
    ...(rule ? { repeat: rule } : {}),
  };
}

/** `following` never carries times: `event_update` refuses series-wide time changes. */
export function toUpdateFields(v: EventFormValues, scope: 'this' | 'following') {
  const fields = {
    type_id: v.type_id,
    title: v.title,
    description: v.description,
    location: v.location,
    lead_member_id: v.lead_member_id || null,
    is_public: v.is_public,
  };

  return scope === 'this' ? { ...fields, date: v.date, start_time: v.start_time, end_time: v.end_time } : fields;
}

export function defaultEventValues(typeId: string, date: string): EventFormValues {
  return {
    type_id: typeId,
    title: '',
    description: '',
    location: '',
    date,
    start_time: '09:00',
    end_time: '12:00',
    lead_member_id: '',
    lead_name: '',
    is_public: false,
    shifts: [{ start_time: '09:00', end_time: '12:00', capacity: 4, label: '' }],
    repeat: { freq: 'none', interval: 1, weekdays: [], weekday: 6, nth: 1, until: '' },
  };
}
```

- [ ] **Step 7: Run the lib tests**

Run: `pnpm --filter @kit/events exec vitest run`
Expected: PASS.

- [ ] **Step 8: Write the service and actions**

`src/server/events.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import type {
  CalendarEvent,
  EventDetail,
  EventType,
  MemberOption,
  MyVolunteering,
  SeriesPreview,
  VolunteerReport,
} from '../types';

type Client = SupabaseClient<Database>;

/**
 * Typed wrapper over the events RPCs. Pass the signed-in user's client
 * (`getSupabaseServerClient`): every function checks `events.*` against
 * `auth.uid()`. Errors are thrown as-is so callers keep the Postgres `code`.
 */
export class EventsService {
  constructor(private readonly client: Client) {}

  async types(includeInactive = false): Promise<EventType[]> {
    let query = this.client.from('event_types').select('id, name, category, description, active').order('name');

    if (!includeInactive) query = query.eq('active', true);

    const { data, error } = await query;
    if (error) throw error;

    return data ?? [];
  }

  async inRange(from: string, to: string, typeId: string | null): Promise<CalendarEvent[]> {
    const { data, error } = await this.client.rpc('events_in_range', {
      p_from: from,
      p_to: to,
      ...(typeId ? { p_type_id: typeId } : {}),
    });
    if (error) throw error;

    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      typeId: r.type_id,
      typeName: r.type_name,
      category: r.category,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      isPublic: r.is_public,
      seriesId: r.series_id,
      capacity: r.capacity,
      filled: r.filled,
      signedUp: r.signed_up,
    }));
  }

  async detail(id: string): Promise<EventDetail | null> {
    const { data, error } = await this.client.rpc('event_detail', { p_event_id: id });

    if (error) {
      if (error.message === 'unknown event' || error.code === '22P02') return null;
      throw error;
    }

    return data as unknown as EventDetail;
  }

  async myVolunteering(): Promise<MyVolunteering> {
    const { data, error } = await this.client.rpc('my_volunteering');
    if (error) throw error;

    return data as unknown as MyVolunteering;
  }

  async report(year: number): Promise<VolunteerReport> {
    const { data, error } = await this.client.rpc('volunteer_report', { p_year: year });
    if (error) throw error;

    return data as unknown as VolunteerReport;
  }

  async saveType(p: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.client.rpc('event_types_save', { p: p as Json });
    if (error) throw error;

    return data;
  }

  async create(p: Record<string, unknown>): Promise<{ seriesId: string | null; eventIds: string[] }> {
    const { data, error } = await this.client.rpc('event_create', { p: p as Json });
    if (error) throw error;

    return data as unknown as { seriesId: string | null; eventIds: string[] };
  }

  async update(eventId: string, fields: Record<string, unknown>, scope: 'this' | 'following'): Promise<void> {
    const { error } = await this.client.rpc('event_update', {
      p_event_id: eventId,
      p_fields: fields as Json,
      p_scope: scope,
    });
    if (error) throw error;
  }

  async saveShifts(eventId: string, shifts: Record<string, unknown>[]): Promise<void> {
    const { error } = await this.client.rpc('event_shifts_save', { p_event_id: eventId, p_shifts: shifts as Json });
    if (error) throw error;
  }

  async preview(rule: Record<string, unknown>): Promise<SeriesPreview> {
    const { data, error } = await this.client.rpc('event_series_preview', { p_rule: rule as Json });
    if (error) throw error;

    return data as unknown as SeriesPreview;
  }

  async signup(shiftId: string): Promise<void> {
    const { error } = await this.client.rpc('event_signup', { p_shift_id: shiftId });
    if (error) throw error;
  }

  async cancelSignup(signupId: string): Promise<void> {
    const { error } = await this.client.rpc('event_cancel_signup', { p_signup_id: signupId });
    if (error) throw error;
  }

  async addVolunteer(shiftId: string, memberId: string): Promise<void> {
    const { error } = await this.client.rpc('event_add_volunteer', { p_shift_id: shiftId, p_member_id: memberId });
    if (error) throw error;
  }

  async setAttendance(signupId: string, status: 'attended' | 'no_show', hours: number | null): Promise<void> {
    const { error } = await this.client.rpc('event_set_attendance', {
      p_signup_id: signupId,
      p_status: status,
      ...(hours === null ? {} : { p_hours: hours }),
    });
    if (error) throw error;
  }

  async searchMembers(eventId: string | null, query: string): Promise<MemberOption[]> {
    const { data, error } = await this.client.rpc('event_member_search', {
      p_event_id: eventId as string,
      p_query: query,
    });
    if (error) throw error;

    return (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name, membershipNumber: r.membership_number }));
  }
}
```

If the generated `Args` types reject `p_event_id: null`, cast it as shown. Do not change the SQL.

`src/server/events-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import * as z from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { toMessage } from '../lib/errors';
import {
  EventFormSchema,
  EventTypeSchema,
  toCreatePayload,
  toShiftsPayload,
  toUpdateFields,
} from '../schemas';
import type { EventsActionResult, MemberOption, SeriesPreview } from '../types';
import { EventsService } from './events.service';

const Id = z.string().guid();
const Scope = z.enum(['this', 'following']);

function service() {
  return new EventsService(getSupabaseServerClient());
}

function invalid(issues: { message: string }[]): EventsActionResult<never> {
  return { success: false, error: issues[0]?.message ?? 'Check the details.' };
}

async function attempt<T>(fn: () => Promise<T>): Promise<EventsActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath('/home/events', 'layout');
    revalidatePath('/home/volunteering');

    return { success: true, data };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

export const saveEventTypeAction = enhanceAction(async (input: unknown) => {
  const parsed = EventTypeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  return attempt(() => service().saveType(parsed.data));
}, {});

export const createEventAction = enhanceAction(async (input: unknown) => {
  const parsed = EventFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  return attempt(() => service().create(toCreatePayload(parsed.data)));
}, {});

export const updateEventAction = enhanceAction(
  async (input: { eventId: string; scope: 'this' | 'following'; values: unknown }) => {
    const parsed = EventFormSchema.safeParse(input.values);
    if (!parsed.success) return invalid(parsed.error.issues);
    if (!Id.safeParse(input.eventId).success || !Scope.safeParse(input.scope).success) {
      return { success: false, error: 'That event no longer exists.' } as const;
    }

    return attempt(async () => {
      const s = service();
      await s.update(input.eventId, toUpdateFields(parsed.data, input.scope), input.scope);
      // Shifts belong to this event only, whatever the scope.
      await s.saveShifts(input.eventId, toShiftsPayload(parsed.data.shifts));
    });
  },
  {},
);

export const cancelEventAction = enhanceAction(async (input: { eventId: string; scope: 'this' | 'following' }) => {
  if (!Id.safeParse(input.eventId).success || !Scope.safeParse(input.scope).success) {
    return { success: false, error: 'That event no longer exists.' } as const;
  }

  return attempt(() => service().update(input.eventId, { status: 'cancelled' }, input.scope));
}, {});

export const previewSeriesAction = enhanceAction(
  async (rule: Record<string, unknown>): Promise<EventsActionResult<SeriesPreview>> => {
    try {
      return { success: true, data: await service().preview(rule) };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const signupAction = enhanceAction(async (input: { shiftId: string }) => {
  if (!Id.safeParse(input.shiftId).success) return { success: false, error: 'That shift no longer exists.' } as const;

  return attempt(() => service().signup(input.shiftId));
}, {});

export const cancelSignupAction = enhanceAction(async (input: { signupId: string }) => {
  if (!Id.safeParse(input.signupId).success) return { success: false, error: 'That sign-up no longer exists.' } as const;

  return attempt(() => service().cancelSignup(input.signupId));
}, {});

export const addVolunteerAction = enhanceAction(async (input: { shiftId: string; memberId: string }) => {
  if (!Id.safeParse(input.shiftId).success || !Id.safeParse(input.memberId).success) {
    return { success: false, error: 'Choose a member.' } as const;
  }

  return attempt(() => service().addVolunteer(input.shiftId, input.memberId));
}, {});

export const setAttendanceAction = enhanceAction(
  async (input: { signupId: string; status: 'attended' | 'no_show'; hours: number | null }) => {
    if (!Id.safeParse(input.signupId).success) return { success: false, error: 'That sign-up no longer exists.' } as const;
    if (input.status !== 'attended' && input.status !== 'no_show') return { success: false, error: 'Choose attended or no-show.' } as const;

    return attempt(() => service().setAttendance(input.signupId, input.status, input.hours));
  },
  {},
);

export const searchMembersAction = enhanceAction(
  async (input: { eventId: string | null; query: string }): Promise<EventsActionResult<MemberOption[]>> => {
    try {
      return { success: true, data: await service().searchMembers(input.eventId, String(input.query ?? '')) };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);
```

- [ ] **Step 9: Section, paths, i18n and navigation**

In `packages/features/rbac/src/types/sections.ts`, add after `finance`:

```ts
  {
    key: 'events',
    label: 'Volunteer Events',
    description:
      'View: the event calendar; sign up for shifts. Manage: create, edit and cancel events; manage event types; confirm any attendance; the hours report',
    verbs: ['view', 'manage'],
  },
```

In `packages/brand/src/config/paths.config.ts`, add `events: z.string().min(1),` and `volunteering: z.string().min(1),` to the app schema, and `events: '/home/events',` and `volunteering: '/home/volunteering',` to the values (beside `duesNotices`).

In `packages/brand/i18n/messages/en/common.json`, add to `routes`, beside `"duesNotices"`: `"events": "Events", "volunteering": "My volunteering"`.

In `apps/portal/config/navigation.config.tsx`, import `CalendarDays` and `HandHeart` from `lucide-react`, and add after the Members entry:

```tsx
      {
        label: 'common.routes.events',
        path: pathsConfig.app.events,
        Icon: <CalendarDays className={iconClasses} />,
        section: 'events',
        verb: 'view' as const,
      },
      {
        label: 'common.routes.volunteering',
        path: pathsConfig.app.volunteering,
        Icon: <HandHeart className={iconClasses} />,
        section: 'events',
        verb: 'view' as const,
      },
```

(Ruling, recorded in the plan: the layout has no member linkage, so "My volunteering" is gated on `events.view`. The page itself explains when a sign-in is not linked.)

Add `"@kit/events": "workspace:*"` to `apps/portal/package.json` dependencies, beside `@kit/finance`, and run `pnpm install`.

- [ ] **Step 10: Typecheck, test, lint and commit**

Run:
```bash
pnpm --filter @kit/events exec vitest run
pnpm turbo run typecheck --filter=@kit/events --filter=@kit/rbac --filter=portal
npx oxlint packages/features/events/src
```
Expected: all pass, and the rbac section tests still pass.

```bash
git add packages/features/events packages/features/rbac/src/types/sections.ts packages/brand/src/config/paths.config.ts packages/brand/i18n/messages/en/common.json apps/portal/config/navigation.config.tsx apps/portal/package.json pnpm-lock.yaml
git commit -m "feat(events): @kit/events package, service, actions, section and navigation"
```

---

### Task 5: Calendar and event page (sign-up, attendance)

**Files:**
- Create:
  - `packages/features/events/src/components/month-calendar.tsx` (+ test)
  - `src/components/events-list.tsx`
  - `src/components/calendar-toolbar.tsx`
  - `src/components/shift-list.tsx` (+ test)
  - `src/components/attendance-panel.tsx`
  - `src/components/member-picker.tsx`
- Create: `apps/portal/app/home/events/page.tsx` and `apps/portal/app/home/events/[id]/page.tsx`

**Interfaces:**
- Consumes (from Task 4): `EventsService`, the lib helpers, `signupAction`, `cancelSignupAction`, `addVolunteerAction`, `setAttendanceAction`, `searchMembersAction`, `cancelEventAction` and the types.
- Produces:
  - `MonthCalendar({ weeks, events, month })`
  - `EventsList({ events })`
  - `CalendarToolbar({ month, view, typeId, types, canManage })`
  - `ShiftList({ event })`
  - `AttendancePanel({ event })`
  - `MemberPicker({ eventId, onPick, placeholder, dataTest })`
- Test IDs:

  | Test ID | Element |
  | --- | --- |
  | `events-calendar` | the month grid |
  | `events-list` | the list view |
  | `calendar-event-<id>` | an event in the grid or list |
  | `event-new` | New event button |
  | `event-types-link` | Event types button |
  | `event-report-link` | Report link |
  | `shift-<id>` | a shift |
  | `shift-signup-<id>` | Sign up button |
  | `shift-cancel-<id>` | Cancel my sign-up button |
  | `shift-full-<id>` | the Full label |
  | `attendance-panel` | the Attendance panel |
  | `attendance-status-<signupId>` | status select |
  | `attendance-hours-<signupId>` | hours input |
  | `attendance-save-<signupId>` | Save button |
  | `add-volunteer-<shiftId>` | Add volunteer picker |
  | `event-edit` | Edit button |
  | `event-cancel` | Cancel event button |
  | `event-cancel-following` | Cancel this and later button |

- [ ] **Step 1: Write the failing component tests**

`src/components/month-calendar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { monthGrid } from '../lib/calendar';
import type { CalendarEvent } from '../types';
import { MonthCalendar } from './month-calendar';

const event = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1', title: 'Pantry', typeId: 't', typeName: 'Food Pantry', category: 'community',
  startsAt: '2040-10-14T04:30:00Z', endsAt: '2040-10-14T06:00:00Z', status: 'scheduled',
  isPublic: false, seriesId: null, capacity: 6, filled: 3, signedUp: false, ...o,
});

describe('MonthCalendar', () => {
  it('puts a late-evening event on its Chicago day with its fill count', () => {
    render(<MonthCalendar month="2040-10" weeks={monthGrid('2040-10', '2040-10-01')} events={[event({})]} />);

    const cell = screen.getByTestId('calendar-day-2040-10-13');
    expect(cell).toHaveTextContent('Pantry');
    expect(cell).toHaveTextContent('3 of 6');
  });

  it('strikes through a cancelled event', () => {
    render(<MonthCalendar month="2040-10" weeks={monthGrid('2040-10', '2040-10-01')} events={[event({ status: 'cancelled' })]} />);

    expect(screen.getByTestId('calendar-event-e1')).toHaveClass('line-through');
  });
});
```

`src/components/shift-list.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EventDetail } from '../types';
import { ShiftList } from './shift-list';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../server/events-actions', () => ({ signupAction: vi.fn(), cancelSignupAction: vi.fn() }));

const future = new Date(Date.now() + 86_400_000).toISOString();
const futureEnd = new Date(Date.now() + 90_000_000).toISOString();

function detail(o: Partial<EventDetail['shifts'][number]>, me: string | null = 'me'): EventDetail {
  return {
    id: 'e1', title: 'Pantry', description: null, location: null, startsAt: future, endsAt: futureEnd,
    status: 'scheduled', isPublic: false, seriesId: null, typeId: 't', typeName: 'Food Pantry', category: 'community',
    leadMemberId: null, leadName: null, canTakeAttendance: false, canManage: false, myMemberId: me,
    shifts: [{ id: 's1', startsAt: future, endsAt: futureEnd, capacity: 2, label: null, filled: 0, signups: [], ...o }],
  };
}

describe('ShiftList', () => {
  it('offers Sign up on an open future shift', () => {
    render(<ShiftList event={detail({})} />);
    expect(screen.getByTestId('shift-signup-s1')).toBeInTheDocument();
  });

  it('shows Full when every slot is taken', () => {
    render(<ShiftList event={detail({ filled: 2, signups: [] })} />);
    expect(screen.getByTestId('shift-full-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-signup-s1')).toBeNull();
  });

  it('offers Cancel on my own sign-up and lists names', () => {
    render(
      <ShiftList
        event={detail({ filled: 1, signups: [{ id: 'g1', memberId: 'me', name: 'Ada Lovelace', status: 'signed_up', hours: null }] })}
      />,
    );
    expect(screen.getByTestId('shift-cancel-s1')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('offers nothing to an unlinked sign-in', () => {
    render(<ShiftList event={detail({}, null)} />);
    expect(screen.queryByTestId('shift-signup-s1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @kit/events exec vitest run src/components`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Write the components**

`src/components/month-calendar.tsx`:

```tsx
import Link from 'next/link';

import { cn } from '@kit/ui/utils';

import type { CalendarDay } from '../lib/calendar';
import { chicagoDate, formatTime } from '../lib/format';
import { WEEKDAYS } from '../schemas';
import type { CalendarEvent } from '../types';

export function MonthCalendar({ weeks, events }: { month: string; weeks: CalendarDay[][]; events: CalendarEvent[] }) {
  const byDay = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const day = chicagoDate(event.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }

  return (
    <div className="overflow-x-auto rounded-lg border" data-test="events-calendar">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} className="text-muted-foreground border-b p-2 text-left font-medium">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.date}>
              {week.map((day) => (
                <td
                  key={day.date}
                  data-test={`calendar-day-${day.date}`}
                  className={cn('h-28 border-b border-r p-1 align-top', !day.inMonth && 'bg-muted/40 text-muted-foreground')}
                >
                  <div className={cn('mb-1 text-xs', day.isToday && 'bg-primary text-primary-foreground inline-block rounded px-1')}>
                    {Number(day.date.slice(8))}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {(byDay.get(day.date) ?? []).map((event) => (
                      <li key={event.id}>
                        <Link
                          href={`/home/events/${event.id}`}
                          data-test={`calendar-event-${event.id}`}
                          className={cn(
                            'block truncate rounded px-1 py-0.5 hover:bg-muted',
                            event.status === 'cancelled' && 'line-through opacity-60',
                            event.signedUp && 'font-semibold',
                          )}
                        >
                          {formatTime(event.startsAt)} {event.title}
                          <span className="text-muted-foreground block text-xs">
                            {event.filled} of {event.capacity}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/components/events-list.tsx`:

```tsx
import Link from 'next/link';

import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

import { formatDay, formatTimeRange } from '../lib/format';
import { CATEGORY_LABELS, type CalendarEvent } from '../types';

export function EventsList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return <p className="text-muted-foreground" data-test="events-list">No events in this period.</p>;
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border" data-test="events-list">
      {events.map((event) => (
        <li key={event.id}>
          <Link
            href={`/home/events/${event.id}`}
            data-test={`calendar-event-${event.id}`}
            className={cn('flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-muted', event.status === 'cancelled' && 'line-through opacity-60')}
          >
            <span className="flex flex-col">
              <span className="font-medium">{event.title}</span>
              <span className="text-muted-foreground text-sm">
                {formatDay(event.startsAt)} · {formatTimeRange(event.startsAt, event.endsAt)}
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{CATEGORY_LABELS[event.category]}</Badge>
              {event.filled} of {event.capacity}
              {event.signedUp ? <Badge>Signed up</Badge> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

`src/components/calendar-toolbar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { NativeSelect } from '@kit/ui/native-select';

import { shiftMonth, type CalendarView } from '../lib/calendar';
import type { EventType } from '../types';

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}

export function CalendarToolbar({
  month,
  view,
  typeId,
  types,
  canManage,
}: {
  month: string;
  view: CalendarView;
  typeId: string;
  types: EventType[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) (v ? query.set(k, v) : query.delete(k));
    return `${pathname}?${query.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href({ month: shiftMonth(month, -1) })} />}>
          ‹
        </Button>
        <span className="min-w-36 text-center font-medium" data-test="calendar-month">{monthLabel(month)}</span>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href({ month: shiftMonth(month, 1) })} />}>
          ›
        </Button>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={href({ view: view === 'list' ? 'month' : 'list' })} />}>
          {view === 'list' ? 'Month view' : 'List view'}
        </Button>
        <NativeSelect
          aria-label="Event type"
          data-test="calendar-type-filter"
          value={typeId}
          onChange={(e) => router.replace(href({ type: e.target.value }))}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </NativeSelect>
      </div>
      {canManage ? (
        <div className="flex gap-2">
          <Button nativeButton={false} render={<Link href="/home/events/new" data-test="event-new" />}>New event</Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/home/events/types" data-test="event-types-link" />}>
            Event types
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/home/events/report" data-test="event-report-link" />}>
            Report
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

(Read `packages/ui/src/shadcn/native-select.tsx` first. It forwards `<select>` props. If its markup differs, keep the same behaviour.)

`src/components/shift-list.tsx`:

```tsx
'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { formatTimeRange } from '../lib/format';
import { cancelSignupAction, signupAction } from '../server/events-actions';
import type { EventDetail } from '../types';

export function ShiftList({ event }: { event: EventDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const now = Date.now();

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, done: string) =>
    start(async () => {
      const result = await fn();
      if (result.success) {
        toast.success(done);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <ul className="flex flex-col gap-3">
      {event.shifts.map((shift) => {
        const mine = shift.signups.find((s) => s.memberId === event.myMemberId && s.status === 'signed_up');
        const started = new Date(shift.startsAt).getTime() <= now;
        const full = shift.filled >= shift.capacity;
        const open = event.status === 'scheduled' && !started;

        return (
          <li key={shift.id} className="rounded-lg border p-3" data-test={`shift-${shift.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {formatTimeRange(shift.startsAt, shift.endsAt)}
                  {shift.label ? <span className="text-muted-foreground"> · {shift.label}</span> : null}
                </div>
                <div className="text-muted-foreground text-sm">
                  {shift.filled} of {shift.capacity} volunteers
                </div>
              </div>
              {event.myMemberId && open ? (
                mine ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    data-test={`shift-cancel-${shift.id}`}
                    onClick={() => run(() => cancelSignupAction({ signupId: mine.id }), 'Your sign-up was cancelled.')}
                  >
                    Cancel my sign-up
                  </Button>
                ) : full ? (
                  <Badge variant="outline" data-test={`shift-full-${shift.id}`}>Full</Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={pending}
                    data-test={`shift-signup-${shift.id}`}
                    onClick={() => run(() => signupAction({ shiftId: shift.id }), 'You are signed up.')}
                  >
                    Sign up
                  </Button>
                )
              ) : null}
            </div>
            {shift.signups.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {shift.signups.map((s) => (
                  <li key={s.id}>
                    <Badge variant={s.memberId === event.myMemberId ? 'default' : 'secondary'}>{s.name}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
```

`src/components/member-picker.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

import { Input } from '@kit/ui/input';

import { searchMembersAction } from '../server/events-actions';
import type { MemberOption } from '../types';

/** Search box listing up to 20 members; `eventId` null means "choosing a lead" (events.manage). */
export function MemberPicker({
  eventId,
  onPick,
  placeholder = 'Search members by name or number',
  dataTest,
}: {
  eventId: string | null;
  onPick: (member: MemberOption) => void;
  placeholder?: string;
  dataTest?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberOption[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const result = await searchMembersAction({ eventId, query });
      setResults(result.success ? (result.data ?? []) : []);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, eventId]);

  return (
    <div className="relative flex flex-col gap-1">
      <Input value={query} placeholder={placeholder} data-test={dataTest} onChange={(e) => setQuery(e.target.value)} />
      {results.length > 0 ? (
        <ul className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow" role="listbox">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="hover:bg-muted w-full px-3 py-2 text-left text-sm"
                onClick={() => {
                  onPick(m);
                  setQuery('');
                  setResults([]);
                }}
              >
                {m.fullName} <span className="text-muted-foreground">#{m.membershipNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

`src/components/attendance-panel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { NativeSelect } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';

import { formatTimeRange } from '../lib/format';
import { addVolunteerAction, setAttendanceAction } from '../server/events-actions';
import type { EventDetail, ShiftSignup } from '../types';
import { MemberPicker } from './member-picker';

function Row({ signup, started }: { signup: ShiftSignup; started: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<'attended' | 'no_show'>(signup.status === 'no_show' ? 'no_show' : 'attended');
  const [hours, setHours] = useState(signup.hours === null ? '' : String(signup.hours));

  const save = () =>
    start(async () => {
      const result = await setAttendanceAction({
        signupId: signup.id,
        status,
        hours: status === 'attended' && hours !== '' ? Number(hours) : null,
      });
      if (result.success) {
        toast.success('Attendance saved.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="min-w-40">{signup.name}</span>
      <NativeSelect
        aria-label={`Attendance for ${signup.name}`}
        data-test={`attendance-status-${signup.id}`}
        value={status}
        disabled={!started}
        onChange={(e) => setStatus(e.target.value as 'attended' | 'no_show')}
      >
        <option value="attended">Attended</option>
        <option value="no_show">No-show</option>
      </NativeSelect>
      <Input
        className="w-24"
        type="number"
        step="0.25"
        min="0"
        max="24"
        placeholder="Hours"
        aria-label={`Hours for ${signup.name}`}
        data-test={`attendance-hours-${signup.id}`}
        value={hours}
        disabled={!started || status === 'no_show'}
        onChange={(e) => setHours(e.target.value)}
      />
      <Button size="sm" disabled={!started || pending} data-test={`attendance-save-${signup.id}`} onClick={save}>
        Save
      </Button>
      {signup.status === 'attended' ? <span className="text-muted-foreground text-sm">Confirmed</span> : null}
    </li>
  );
}

export function AttendancePanel({ event }: { event: EventDetail }) {
  const router = useRouter();
  const now = Date.now();

  return (
    <Card data-test="attendance-panel">
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {event.shifts.map((shift) => {
          const started = new Date(shift.startsAt).getTime() <= now;

          return (
            <section key={shift.id} className="flex flex-col gap-2">
              <h3 className="font-medium">{formatTimeRange(shift.startsAt, shift.endsAt)}</h3>
              {!started ? <p className="text-muted-foreground text-sm">Attendance opens when the shift starts.</p> : null}
              <ul className="flex flex-col gap-2">
                {shift.signups.map((s) => (
                  <Row key={s.id} signup={s} started={started} />
                ))}
              </ul>
              <MemberPicker
                eventId={event.id}
                placeholder="Add a walk-in volunteer"
                dataTest={`add-volunteer-${shift.id}`}
                onPick={async (m) => {
                  const result = await addVolunteerAction({ shiftId: shift.id, memberId: m.id });
                  if (result.success) {
                    toast.success(`${m.fullName} added.`);
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                }}
              />
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write the pages**

`apps/portal/app/home/events/page.tsx`:

```tsx
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { CalendarToolbar } from '@kit/events/components/calendar-toolbar';
import { EventsList } from '@kit/events/components/events-list';
import { MonthCalendar } from '@kit/events/components/month-calendar';
import { gridRange, monthGrid, parseMonthParam, parseViewParam } from '@kit/events/lib/calendar';
import { todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';

import { getCurrentPermissions, requirePermission } from '~/lib/server/require-permission';

export const instant = false;

export const generateMetadata = async () => ({ title: 'Events' });

type SearchParams = Record<string, string | string[] | undefined>;

async function EventsPage(props: { searchParams: Promise<SearchParams> }) {
  await requirePermission('events', 'view');

  const params = await props.searchParams;
  const today = todayInChicago();
  const month = parseMonthParam(params.month, today);
  const view = parseViewParam(params.view);
  const typeId = typeof params.type === 'string' ? params.type : '';
  const canManage = hasPermission(await getCurrentPermissions(), 'events', 'manage');

  const weeks = monthGrid(month, today);
  const range = view === 'list' ? { from: today, to: addDays(today, 60) } : gridRange(weeks);
  const service = new EventsService(getSupabaseServerClient());

  const read = await readDuesIfDeployed(() =>
    Promise.all([service.types(), service.inRange(range.from, range.to, typeId || null)]),
  );

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        {!read.deployed ? (
          <p className="text-muted-foreground" data-test="events-unavailable">Not available yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <CalendarToolbar month={month} view={view} typeId={typeId} types={read.value[0]} canManage={canManage} />
            {view === 'list' ? (
              <EventsList events={read.value[1]} />
            ) : (
              <>
                <div className="hidden md:block">
                  <MonthCalendar month={month} weeks={weeks} events={read.value[1]} />
                </div>
                <div className="md:hidden">
                  <EventsList events={read.value[1].filter((e) => e.startsAt.slice(0, 7) >= month)} />
                </div>
              </>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default EventsPage;
```

`apps/portal/app/home/events/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { AttendancePanel } from '@kit/events/components/attendance-panel';
import { CancelEventButtons } from '@kit/events/components/cancel-event-buttons';
import { ShiftList } from '@kit/events/components/shift-list';
import { formatDay, formatTimeRange } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { CATEGORY_LABELS } from '@kit/events/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;

export const generateMetadata = async () => ({ title: 'Event' });

async function EventPage(props: { params: Promise<{ id: string }> }) {
  await requirePermission('events', 'view');

  const { id } = await props.params;
  const read = await readDuesIfDeployed(() => new EventsService(getSupabaseServerClient()).detail(id));

  if (!read.deployed) {
    return <PageBody><p className="text-muted-foreground">Not available yet.</p></PageBody>;
  }

  const event = read.value;
  if (!event) notFound();

  return (
    <>
      <PageHeader title={event.title} description={`${formatDay(event.startsAt)} · ${formatTimeRange(event.startsAt, event.endsAt)}`}>
        {event.canManage && event.status === 'scheduled' ? (
          <>
            <Button variant="outline" nativeButton={false} render={<Link href={`/home/events/${event.id}/edit`} data-test="event-edit" />}>
              Edit
            </Button>
            <CancelEventButtons eventId={event.id} inSeries={event.seriesId !== null} />
          </>
        ) : null}
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{CATEGORY_LABELS[event.category]}</Badge>
            <span>{event.typeName}</span>
            {event.location ? <span>· {event.location}</span> : null}
            {event.leadName ? <span>· Lead: {event.leadName}</span> : null}
            {event.status === 'cancelled' ? <Badge variant="destructive">Cancelled</Badge> : null}
          </div>
          {event.description ? <p className="whitespace-pre-line">{event.description}</p> : null}
          {event.myMemberId === null ? (
            <p className="text-muted-foreground text-sm">
              Your sign-in is not linked to a council member record, so you cannot sign up yet.
            </p>
          ) : null}
          <ShiftList event={event} />
          {event.canTakeAttendance ? <AttendancePanel event={event} /> : null}
        </div>
      </PageBody>
    </>
  );
}

export default EventPage;
```

Also create `src/components/cancel-event-buttons.tsx`. Cancelling takes two clicks, so a single stray click can't cancel an event:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { cancelEventAction } from '../server/events-actions';

export function CancelEventButtons({ eventId, inSeries }: { eventId: string; inSeries: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  const cancel = (scope: 'this' | 'following') =>
    start(async () => {
      const result = await cancelEventAction({ eventId, scope });
      if (result.success) {
        toast.success('Event cancelled.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  if (!armed) {
    return (
      <Button variant="outline" data-test="event-cancel" onClick={() => setArmed(true)}>
        Cancel event
      </Button>
    );
  }

  return (
    <>
      <Button variant="destructive" disabled={pending} data-test="event-cancel-confirm" onClick={() => cancel('this')}>
        Cancel this event
      </Button>
      {inSeries ? (
        <Button variant="destructive" disabled={pending} data-test="event-cancel-following" onClick={() => cancel('following')}>
          Cancel this and all later
        </Button>
      ) : null}
      <Button variant="ghost" onClick={() => setArmed(false)}>Keep it</Button>
    </>
  );
}
```

- [ ] **Step 5: Run the tests, typecheck and commit**

Run:
```bash
pnpm --filter @kit/events exec vitest run
pnpm turbo run typecheck --filter=@kit/events --filter=portal
```
Expected: all pass.

```bash
git add packages/features/events/src/components apps/portal/app/home/events/page.tsx "apps/portal/app/home/events/[id]/page.tsx"
git commit -m "feat(events): calendar, event page, sign-up and attendance"
```

---

### Task 6: Event form (new, edit, repeat) and event types

**Files:**
- Create:
  - `packages/features/events/src/components/event-form.tsx` (+ test)
  - `src/components/event-types-manager.tsx`
- Create:
  - `apps/portal/app/home/events/new/page.tsx`
  - `apps/portal/app/home/events/[id]/edit/page.tsx`
  - `apps/portal/app/home/events/types/page.tsx`

**Interfaces:**
- Consumes: `EventFormSchema`, `defaultEventValues`, `toRepeatRule`, `WEEKDAYS`, `createEventAction`, `updateEventAction`, `previewSeriesAction`, `saveEventTypeAction`, `MemberPicker`, `chicagoDate` and `chicagoTime`.
- Produces:
  - `EventForm({ types, initial, eventId, inSeries })`: create mode when `eventId` is undefined.
  - `EventTypesManager({ types })`.
- Test IDs:

  | Test ID | Element |
  | --- | --- |
  | `event-form` | the form |
  | `event-type`, `event-title`, `event-location`, `event-date`, `event-start`, `event-end` | event fields |
  | `event-lead` | lead search |
  | `event-public` | Show on public calendar switch |
  | `shift-row-<i>-start`, `shift-row-<i>-end`, `shift-row-<i>-capacity`, `shift-row-<i>-label` | shift fields |
  | `shift-add` | Add shift button |
  | `repeat-freq` | repeat select |
  | `repeat-interval`, `repeat-weekday-<0..6>`, `repeat-nth`, `repeat-monthly-weekday`, `repeat-until` | repeat fields |
  | `repeat-preview` | the preview line |
  | `event-scope-this`, `event-scope-following` | series scope options |
  | `event-save` | Save button |
  | `event-types` | the types manager |
  | `event-type-name`, `event-type-category`, `event-type-save` | types manager fields |

- [ ] **Step 1: Write the failing test**

`src/components/event-form.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventForm } from './event-form';

const push = vi.fn();
const h = vi.hoisted(() => ({
  create: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('../server/events-actions', () => ({
  createEventAction: h.create,
  updateEventAction: vi.fn(),
  previewSeriesAction: h.preview,
  searchMembersAction: vi.fn(async () => ({ success: true, data: [] })),
}));

const types = [{ id: '11111111-1111-1111-1111-111111111111', name: 'Food Pantry', category: 'community' as const, description: null, active: true }];

describe('EventForm', () => {
  beforeEach(() => {
    h.create.mockResolvedValue({ success: true, data: { seriesId: null, eventIds: ['e1'] } });
    h.preview.mockResolvedValue({ success: true, data: { count: 3, first: '2040-10-30', last: '2040-11-13' } });
  });

  it('creates a one-off event and opens it', async () => {
    render(<EventForm types={types} today="2040-10-01" />);
    fireEvent.change(screen.getByTestId('event-title'), { target: { value: 'Pantry' } });
    fireEvent.click(screen.getByTestId('event-save'));

    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ title: 'Pantry', repeat: { freq: 'none' } });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home/events/e1'));
  });

  it('previews a weekly repeat', async () => {
    render(<EventForm types={types} today="2040-10-01" />);
    fireEvent.change(screen.getByTestId('repeat-freq'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByTestId('repeat-weekday-2'));
    fireEvent.change(screen.getByTestId('repeat-until'), { target: { value: '2040-11-13' } });

    await waitFor(() => expect(screen.getByTestId('repeat-preview')).toHaveTextContent('Creates 3 events'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kit/events exec vitest run src/components/event-form.test.tsx`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Write `src/components/event-form.tsx`**

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { NativeSelect } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

import { formatDay } from '../lib/format';
import {
  EventFormSchema,
  type EventFormValues,
  WEEKDAYS,
  defaultEventValues,
  toRepeatRule,
} from '../schemas';
import { createEventAction, previewSeriesAction, updateEventAction } from '../server/events-actions';
import type { EventType } from '../types';
import { MemberPicker } from './member-picker';

const NTH = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
];

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-destructive text-sm">{message}</p> : null;
}

export function EventForm({
  types,
  today,
  initial,
  eventId,
  inSeries = false,
}: {
  types: EventType[];
  today: string;
  initial?: EventFormValues;
  eventId?: string;
  inSeries?: boolean;
}) {
  const router = useRouter();
  const [saving, start] = useTransition();
  const [scope, setScope] = useState<'this' | 'following'>('this');
  const [preview, setPreview] = useState<string | null>(null);

  const form = useForm<EventFormValues>({
    resolver: zodResolver(EventFormSchema),
    defaultValues: initial ?? defaultEventValues(types[0]?.id ?? '', today),
  });
  const { register, control, handleSubmit, setValue, formState } = form;
  const shifts = useFieldArray({ control, name: 'shifts' });
  const values = useWatch({ control });
  const repeat = values.repeat;

  // A live "Creates N events" line, from the same function that creates them.
  useEffect(() => {
    if (eventId || !repeat || repeat.freq === 'none' || !repeat.until || !values.date) {
      setPreview(null);
      return;
    }
    const rule = toRepeatRule({ ...(values as EventFormValues) });
    if (!rule) return;

    const timer = setTimeout(async () => {
      const result = await previewSeriesAction({ ...rule, start_date: values.date });
      if (!result.success) return setPreview(result.error);
      const p = result.data!;
      setPreview(
        p.count === 0
          ? 'Creates no events'
          : `Creates ${p.count} event${p.count === 1 ? '' : 's'}, ${formatDay(`${p.first}T18:00:00Z`)} – ${formatDay(`${p.last}T18:00:00Z`)}`,
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [eventId, repeat?.freq, repeat?.interval, repeat?.weekdays, repeat?.weekday, repeat?.nth, repeat?.until, values.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (v: EventFormValues) =>
    start(async () => {
      if (eventId) {
        const result = await updateEventAction({ eventId, scope, values: v });
        if (!result.success) return void toast.error(result.error);
        toast.success('Event saved.');
        router.push(`/home/events/${eventId}`);
        return;
      }
      const result = await createEventAction(v);
      if (!result.success) return void toast.error(result.error);
      const created = result.data!;
      toast.success(created.eventIds.length > 1 ? `${created.eventIds.length} events created.` : 'Event created.');
      router.push(`/home/events/${created.eventIds[0]}`);
    });

  const errors = formState.errors;

  return (
    <form noValidate className="flex max-w-3xl flex-col gap-6" data-test="event-form" onSubmit={handleSubmit(onSubmit)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-type">Event type</Label>
          <NativeSelect id="event-type" data-test="event-type" {...register('type_id')}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </NativeSelect>
          <FieldError message={errors.type_id?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-title">Title</Label>
          <Input id="event-title" data-test="event-title" {...register('title')} />
          <FieldError message={errors.title?.message} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="event-description">Description</Label>
          <Textarea id="event-description" rows={3} {...register('description')} />
          <FieldError message={errors.description?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-location">Location</Label>
          <Input id="event-location" data-test="event-location" {...register('location')} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-date">Date</Label>
          <Input id="event-date" type="date" data-test="event-date" disabled={Boolean(eventId) && scope === 'following'} {...register('date')} />
          <FieldError message={errors.date?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-start">Starts</Label>
          <Input id="event-start" type="time" data-test="event-start" disabled={Boolean(eventId) && scope === 'following'} {...register('start_time')} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-end">Ends</Label>
          <Input id="event-end" type="time" data-test="event-end" disabled={Boolean(eventId) && scope === 'following'} {...register('end_time')} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Lead</Label>
          {values.lead_member_id ? (
            <div className="flex items-center gap-2 text-sm">
              <span data-test="event-lead-name">{values.lead_name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setValue('lead_member_id', '', { shouldDirty: true }); setValue('lead_name', ''); }}>
                Remove
              </Button>
            </div>
          ) : (
            <MemberPicker
              eventId={null}
              dataTest="event-lead"
              placeholder="Search for the event lead"
              onPick={(m) => {
                setValue('lead_member_id', m.id, { shouldDirty: true });
                setValue('lead_name', m.fullName);
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="event-public"
            data-test="event-public"
            checked={values.is_public ?? false}
            onCheckedChange={(checked) => setValue('is_public', checked === true, { shouldDirty: true })}
          />
          <Label htmlFor="event-public">Show on public calendar</Label>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-heading font-semibold">Shifts</legend>
        {eventId && inSeries ? <p className="text-muted-foreground text-xs">Shift changes apply to this event only.</p> : null}
        {shifts.fields.map((field, i) => (
          <div key={field.id} className="flex flex-wrap items-end gap-2">
            <Input type="time" aria-label="Shift start" data-test={`shift-row-${i}-start`} className="w-32" {...register(`shifts.${i}.start_time`)} />
            <Input type="time" aria-label="Shift end" data-test={`shift-row-${i}-end`} className="w-32" {...register(`shifts.${i}.end_time`)} />
            <Input
              type="number"
              min={1}
              max={200}
              aria-label="Volunteers needed"
              data-test={`shift-row-${i}-capacity`}
              className="w-24"
              {...register(`shifts.${i}.capacity`, { valueAsNumber: true })}
            />
            <Input aria-label="Shift label" placeholder="Label (optional)" data-test={`shift-row-${i}-label`} className="w-48" {...register(`shifts.${i}.label`)} />
            {shifts.fields.length > 1 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => shifts.remove(i)}>Remove</Button>
            ) : null}
            <FieldError message={errors.shifts?.[i]?.capacity?.message ?? errors.shifts?.[i]?.start_time?.message} />
          </div>
        ))}
        <FieldError message={errors.shifts?.message ?? errors.shifts?.root?.message} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          data-test="shift-add"
          onClick={() => shifts.append({ start_time: values.start_time ?? '09:00', end_time: values.end_time ?? '12:00', capacity: 4, label: '' })}
        >
          Add shift
        </Button>
      </fieldset>

      {!eventId ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-heading font-semibold">Repeat</legend>
          <NativeSelect aria-label="Repeat" data-test="repeat-freq" className="w-48" {...register('repeat.freq')}>
            <option value="none">Does not repeat</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </NativeSelect>
          {repeat?.freq === 'weekly' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Every</span>
              <NativeSelect aria-label="Every how many weeks" data-test="repeat-interval" {...register('repeat.interval', { valueAsNumber: true })}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n === 1 ? 'week' : `${n} weeks`}</option>
                ))}
              </NativeSelect>
              <span className="text-sm">on</span>
              {WEEKDAYS.map((label, day) => {
                const on = repeat.weekdays?.includes(day) ?? false;
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    aria-pressed={on}
                    data-test={`repeat-weekday-${day}`}
                    onClick={() =>
                      setValue(
                        'repeat.weekdays',
                        on ? (repeat.weekdays ?? []).filter((d) => d !== day) : [...(repeat.weekdays ?? []), day].sort(),
                        { shouldDirty: true, shouldValidate: formState.isSubmitted },
                      )
                    }
                  >
                    {label}
                  </Button>
                );
              })}
              <FieldError message={errors.repeat?.weekdays?.message} />
            </div>
          ) : null}
          {repeat?.freq === 'monthly' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">On the</span>
              <NativeSelect aria-label="Which week" data-test="repeat-nth" {...register('repeat.nth', { valueAsNumber: true })}>
                {NTH.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Weekday" data-test="repeat-monthly-weekday" {...register('repeat.weekday', { valueAsNumber: true })}>
                {WEEKDAYS.map((label, day) => (
                  <option key={label} value={day}>{label}</option>
                ))}
              </NativeSelect>
              <span className="text-sm">of each month</span>
            </div>
          ) : null}
          {repeat?.freq && repeat.freq !== 'none' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="repeat-until">Until</Label>
              <Input id="repeat-until" type="date" className="w-44" data-test="repeat-until" {...register('repeat.until')} />
              <FieldError message={errors.repeat?.until?.message} />
              {preview ? <p className="text-muted-foreground text-sm" data-test="repeat-preview">{preview}</p> : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {eventId && inSeries ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-heading font-semibold">Apply changes to</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === 'this'} data-test="event-scope-this" onChange={() => setScope('this')} />
            This event
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === 'following'} data-test="event-scope-following" onChange={() => setScope('following')} />
            This and all later events (times stay as they are)
          </label>
        </fieldset>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving} data-test="event-save">{saving ? 'Saving…' : eventId ? 'Save changes' : 'Create event'}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
```

Before wiring the Switch, read `packages/ui/src/shadcn/switch.tsx`, and adapt only the `onCheckedChange` callback if its signature differs.

- [ ] **Step 4: Write `src/components/event-types-manager.tsx`**

```tsx
'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { NativeSelect } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';

import { saveEventTypeAction } from '../server/events-actions';
import { CATEGORY_LABELS, type EventType, type ProgramCategory } from '../types';

const EMPTY = { id: undefined as string | undefined, name: '', category: 'community' as ProgramCategory, description: '', active: true };

export function EventTypesManager({ types }: { types: EventType[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(EMPTY);
  const [pending, start] = useTransition();

  const save = (values: typeof EMPTY) =>
    start(async () => {
      const result = await saveEventTypeAction(values);
      if (result.success) {
        toast.success('Event type saved.');
        setDraft(EMPTY);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="flex max-w-3xl flex-col gap-6" data-test="event-types">
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <Input className="w-64" placeholder="Type name" aria-label="Type name" data-test="event-type-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <NativeSelect aria-label="Category" data-test="event-type-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ProgramCategory })}>
          {(Object.keys(CATEGORY_LABELS) as ProgramCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </NativeSelect>
        <Button type="submit" disabled={pending} data-test="event-type-save">{draft.id ? 'Save type' : 'Add type'}</Button>
        {draft.id ? <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY)}>Cancel</Button> : null}
      </form>
      <ul className="flex flex-col divide-y rounded-lg border">
        {types.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 p-3">
            <span className="flex items-center gap-2">
              {t.name}
              <Badge variant="outline">{CATEGORY_LABELS[t.category]}</Badge>
              {!t.active ? <Badge variant="secondary">Inactive</Badge> : null}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft({ id: t.id, name: t.name, category: t.category, description: t.description ?? '', active: t.active })}>
                Edit
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => save({ id: t.id, name: t.name, category: t.category, description: t.description ?? '', active: !t.active })}>
                {t.active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Write the pages**

`apps/portal/app/home/events/new/page.tsx`:

```tsx
import { EventForm } from '@kit/events/components/event-form';
import { todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'New event' });

async function NewEventPage() {
  await requirePermission('events', 'manage');
  const types = await new EventsService(getSupabaseServerClient()).types();

  return (
    <>
      <PageHeader title="New event" />
      <PageBody>
        <EventForm types={types} today={todayInChicago()} />
      </PageBody>
    </>
  );
}

export default NewEventPage;
```

`apps/portal/app/home/events/[id]/edit/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { EventForm } from '@kit/events/components/event-form';
import { chicagoDate, chicagoTime, todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'Edit event' });

async function EditEventPage(props: { params: Promise<{ id: string }> }) {
  await requirePermission('events', 'manage');
  const { id } = await props.params;
  const service = new EventsService(getSupabaseServerClient());
  const [event, types] = await Promise.all([service.detail(id), service.types(true)]);

  if (!event) notFound();

  return (
    <>
      <PageHeader title={`Edit ${event.title}`} />
      <PageBody>
        <EventForm
          types={types.filter((t) => t.active || t.id === event.typeId)}
          today={todayInChicago()}
          eventId={event.id}
          inSeries={event.seriesId !== null}
          initial={{
            type_id: event.typeId,
            title: event.title,
            description: event.description ?? '',
            location: event.location ?? '',
            date: chicagoDate(event.startsAt),
            start_time: chicagoTime(event.startsAt),
            end_time: chicagoTime(event.endsAt),
            lead_member_id: event.leadMemberId ?? '',
            lead_name: event.leadName ?? '',
            is_public: event.isPublic,
            shifts: event.shifts.map((s) => ({
              id: s.id,
              start_time: chicagoTime(s.startsAt),
              end_time: chicagoTime(s.endsAt),
              capacity: s.capacity,
              label: s.label ?? '',
            })),
            repeat: { freq: 'none', interval: 1, weekdays: [], weekday: 6, nth: 1, until: '' },
          }}
        />
      </PageBody>
    </>
  );
}

export default EditEventPage;
```

`apps/portal/app/home/events/types/page.tsx`:

```tsx
import { EventTypesManager } from '@kit/events/components/event-types-manager';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'Event types' });

async function EventTypesPage() {
  await requirePermission('events', 'manage');
  const types = await new EventsService(getSupabaseServerClient()).types(true);

  return (
    <>
      <PageHeader title="Event types" description="Each type belongs to one Knights program category." />
      <PageBody>
        <EventTypesManager types={types} />
      </PageBody>
    </>
  );
}

export default EventTypesPage;
```

- [ ] **Step 6: Run the tests, typecheck and commit**

Run:
```bash
pnpm --filter @kit/events exec vitest run
pnpm turbo run typecheck --filter=@kit/events --filter=portal
```
Expected: all pass.

```bash
git add packages/features/events/src/components apps/portal/app/home/events
git commit -m "feat(events): event form with shifts and repeat, and event types"
```

---

### Task 7: My volunteering, member-home card and the hours report

**Files:**
- Create:
  - `packages/features/events/src/components/my-volunteering.tsx` (+ test)
  - `src/components/volunteer-home-card.tsx`
  - `src/components/volunteer-report.tsx`
  - `src/components/export-report-button.tsx`
- Create: `apps/portal/app/home/volunteering/page.tsx` and `apps/portal/app/home/events/report/page.tsx`
- Modify: `apps/portal/app/home/page.tsx`. Render `VolunteerHomeCard` directly after **each** `<MemberHome …/>` (the two spots are near lines 118 and 165).

**Interfaces:**
- Consumes:
  - `EventsService.myVolunteering()` and `.report(year)`, `reportCsv`, `CATEGORY_LABELS`;
  - `formatDay`, `formatTimeRange`;
  - `YearPicker` from `@kit/finance/components/year-picker`, and `parseYearParam` and `fraternalYearOf` from `@kit/finance/lib/fraternal-year`.
- Produces:
  - `MyVolunteeringView({ data })`
  - `VolunteerHomeCard({ data })`
  - `VolunteerReportView({ report })`
  - `ExportReportButton({ rows, year })`
- Test IDs:

  | Test ID | Element |
  | --- | --- |
  | `volunteering-year-hours` | this year's hours |
  | `volunteering-all-hours` | all-time hours |
  | `volunteering-upcoming` | upcoming shifts |
  | `volunteering-history` | history |
  | `volunteering-unlinked` | the not-linked message |
  | `volunteer-home-card` | the member-home card |
  | `report-total-hours` | report total hours |
  | `report-by-category` | category table |
  | `report-by-type` | type table |
  | `report-by-member` | member table |
  | `report-pending` | attendance-not-taken list |
  | `report-export` | Export CSV button |

- [ ] **Step 1: Write the failing test**

`src/components/my-volunteering.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MyVolunteeringView } from './my-volunteering';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../server/events-actions', () => ({ cancelSignupAction: vi.fn() }));

describe('MyVolunteeringView', () => {
  it('explains an unlinked sign-in', () => {
    render(<MyVolunteeringView data={{ linked: false }} />);
    expect(screen.getByTestId('volunteering-unlinked')).toBeInTheDocument();
  });

  it('shows hours, categories, upcoming and history', () => {
    render(
      <MyVolunteeringView
        data={{
          linked: true, year: 2026, yearHours: 12.5, allTimeHours: 40,
          byCategory: [
            { category: 'faith', hours: 0 }, { category: 'family', hours: 2.5 },
            { category: 'community', hours: 10 }, { category: 'life', hours: 0 },
          ],
          upcoming: [{ signupId: 's1', eventId: 'e1', title: 'Pantry', startsAt: '2040-10-13T14:00:00Z', endsAt: '2040-10-13T16:00:00Z', label: null }],
          history: [{ signupId: 's2', eventId: 'e2', title: 'Breakfast', typeName: 'Breakfast with Knights', startsAt: '2026-09-01T13:00:00Z', status: 'attended', hours: 2.5, eventCancelled: false }],
        }}
      />,
    );

    expect(screen.getByTestId('volunteering-year-hours')).toHaveTextContent('12.5');
    expect(screen.getByTestId('volunteering-all-hours')).toHaveTextContent('40');
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByTestId('volunteering-upcoming')).toHaveTextContent('Pantry');
    expect(screen.getByTestId('volunteering-history')).toHaveTextContent('Attended');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kit/events exec vitest run src/components/my-volunteering.test.tsx`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Write the components**

`src/components/my-volunteering.tsx`:

```tsx
'use client';

import { useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';

import { formatDay, formatTimeRange } from '../lib/format';
import { cancelSignupAction } from '../server/events-actions';
import { CATEGORY_LABELS, type MyVolunteering, type SignupStatus } from '../types';

const STATUS_LABELS: Record<SignupStatus, string> = {
  signed_up: 'Awaiting attendance',
  cancelled: 'Cancelled',
  attended: 'Attended',
  no_show: 'No-show',
};

export function MyVolunteeringView({ data }: { data: MyVolunteering }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!data.linked) {
    return (
      <p className="text-muted-foreground" data-test="volunteering-unlinked">
        Your sign-in is not linked to a council member record yet. Ask the Financial Secretary to link it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>This fraternal year</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold" data-test="volunteering-year-hours">{data.yearHours} hours</p>
            <ul className="text-muted-foreground mt-2 grid grid-cols-2 text-sm">
              {data.byCategory.map((c) => (
                <li key={c.category}>{CATEGORY_LABELS[c.category]}: {c.hours}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>All time</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold" data-test="volunteering-all-hours">{data.allTimeHours} hours</p>
          </CardContent>
        </Card>
      </div>

      <section data-test="volunteering-upcoming" className="flex flex-col gap-2">
        <h2 className="font-heading font-semibold">Upcoming</h2>
        {data.upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing scheduled. <Link className="underline" href="/home/events">Find an event</Link>.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.upcoming.map((u) => (
              <li key={u.signupId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <Link href={`/home/events/${u.eventId}`} className="flex flex-col">
                  <span className="font-medium">{u.title}</span>
                  <span className="text-muted-foreground text-sm">{formatDay(u.startsAt)} · {formatTimeRange(u.startsAt, u.endsAt)}</span>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await cancelSignupAction({ signupId: u.signupId });
                      if (result.success) {
                        toast.success('Your sign-up was cancelled.');
                        router.refresh();
                      } else {
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-test="volunteering-history" className="flex flex-col gap-2">
        <h2 className="font-heading font-semibold">History</h2>
        {data.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">No past events yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.history.map((h) => (
              <li key={h.signupId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span className="flex flex-col">
                  <Link href={`/home/events/${h.eventId}`} className="font-medium">{h.title}</Link>
                  <span className="text-muted-foreground">{h.typeName} · {formatDay(h.startsAt)}</span>
                </span>
                <span>
                  {h.eventCancelled ? 'Event cancelled' : STATUS_LABELS[h.status]}
                  {h.hours !== null && !h.eventCancelled ? ` · ${h.hours} h` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

`src/components/volunteer-home-card.tsx`:

```tsx
import Link from 'next/link';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { formatDay, formatTimeRange } from '../lib/format';
import type { MyVolunteering } from '../types';

export function VolunteerHomeCard({ data }: { data: MyVolunteering }) {
  if (!data.linked) return null;

  const next = data.upcoming[0];

  return (
    <Card data-test="volunteer-home-card">
      <CardHeader><CardTitle>Volunteering</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p>Volunteer hours this year: <strong>{data.yearHours}</strong></p>
        <p className="text-muted-foreground text-sm">
          {next ? `Next: ${next.title}, ${formatDay(next.startsAt)} · ${formatTimeRange(next.startsAt, next.endsAt)}` : 'No upcoming shifts.'}
        </p>
        <Button variant="outline" className="self-start" nativeButton={false} render={<Link href="/home/volunteering" />}>
          My volunteering
        </Button>
      </CardContent>
    </Card>
  );
}
```

`src/components/export-report-button.tsx`:

```tsx
'use client';

import { Button } from '@kit/ui/button';

import { reportCsv } from '../lib/report-csv';
import type { ReportMemberRow } from '../types';

export function ExportReportButton({ rows, year }: { rows: ReportMemberRow[]; year: number }) {
  return (
    <Button
      variant="outline"
      data-test="report-export"
      disabled={rows.length === 0}
      onClick={() => {
        const blob = new Blob([reportCsv(rows)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `volunteer-hours-${year}-${year + 1}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      Export CSV
    </Button>
  );
}
```

`src/components/volunteer-report.tsx`:

```tsx
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';

import { formatDay, formatTimeRange } from '../lib/format';
import { CATEGORY_LABELS, type VolunteerReport } from '../types';
import { ExportReportButton } from './export-report-button';

export function VolunteerReportView({ report }: { report: VolunteerReport }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle>Hours</CardTitle></CardHeader><CardContent data-test="report-total-hours" className="text-3xl font-semibold">{report.totals.hours}</CardContent></Card>
        <Card><CardHeader><CardTitle>Volunteers</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{report.totals.volunteers}</CardContent></Card>
        <Card><CardHeader><CardTitle>Events held</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{report.totals.events}</CardContent></Card>
      </div>

      <section className="flex flex-col gap-2" data-test="report-by-category">
        <h2 className="font-heading font-semibold">By program category</h2>
        <Table>
          <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Hours</TableHead><TableHead>Volunteers</TableHead><TableHead>Events</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.byCategory.map((c) => (
              <TableRow key={c.category}><TableCell>{CATEGORY_LABELS[c.category]}</TableCell><TableCell>{c.hours}</TableCell><TableCell>{c.volunteers}</TableCell><TableCell>{c.events}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" data-test="report-by-type">
        <h2 className="font-heading font-semibold">By event type</h2>
        <Table>
          <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Category</TableHead><TableHead>Hours</TableHead><TableHead>Volunteers</TableHead><TableHead>Events</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.byType.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">No confirmed hours this year.</TableCell></TableRow>
            ) : report.byType.map((t) => (
              <TableRow key={t.typeId}><TableCell>{t.name}</TableCell><TableCell>{CATEGORY_LABELS[t.category]}</TableCell><TableCell>{t.hours}</TableCell><TableCell>{t.volunteers}</TableCell><TableCell>{t.events}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" data-test="report-by-member">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold">By member</h2>
          <ExportReportButton rows={report.byMember} year={report.year} />
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Member #</TableHead><TableHead>Events</TableHead><TableHead>Hours</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.byMember.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground">No confirmed hours this year.</TableCell></TableRow>
            ) : report.byMember.map((m) => (
              <TableRow key={m.memberId}><TableCell>{m.name}</TableCell><TableCell>{m.membershipNumber}</TableCell><TableCell>{m.events}</TableCell><TableCell>{m.hours}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" data-test="report-pending">
        <h2 className="font-heading font-semibold">Attendance not taken</h2>
        {report.pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">Every past shift has its attendance.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {report.pending.map((p) => (
              <li key={p.shiftId} className="flex flex-wrap justify-between gap-2 p-3">
                <Link href={`/home/events/${p.eventId}`} className="font-medium">{p.title}</Link>
                <span className="text-muted-foreground">
                  {formatDay(p.startsAt)} · {formatTimeRange(p.startsAt, p.endsAt)} · {p.waiting} waiting · Lead: {p.leadName ?? 'none'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Write the pages and the home card**

`apps/portal/app/home/volunteering/page.tsx`:

```tsx
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { MyVolunteeringView } from '@kit/events/components/my-volunteering';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'My volunteering' });

async function VolunteeringPage() {
  await requirePermission('events', 'view');
  const read = await readDuesIfDeployed(() => new EventsService(getSupabaseServerClient()).myVolunteering());

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        {read.deployed ? <MyVolunteeringView data={read.value} /> : <p className="text-muted-foreground">Not available yet.</p>}
      </PageBody>
    </>
  );
}

export default VolunteeringPage;
```

`apps/portal/app/home/events/report/page.tsx`:

```tsx
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { VolunteerReportView } from '@kit/events/components/volunteer-report';
import { todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { YearPicker } from '@kit/finance/components/year-picker';
import { fraternalYearOf, parseYearParam } from '@kit/finance/lib/fraternal-year';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'Volunteer hours' });

async function ReportPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission('events', 'manage');
  const today = todayInChicago();
  const year = parseYearParam((await props.searchParams).year, today);
  const current = fraternalYearOf(today);
  const options = Array.from({ length: 6 }, (_, i) => current + 1 - i);
  const read = await readDuesIfDeployed(() => new EventsService(getSupabaseServerClient()).report(year));

  return (
    <>
      <PageHeader title="Volunteer hours" description={`Fraternal year ${year}–${year + 1}`}>
        <YearPicker year={year} options={options} />
      </PageHeader>
      <PageBody>
        {read.deployed ? <VolunteerReportView report={read.value} /> : <p className="text-muted-foreground">Not available yet.</p>}
      </PageBody>
    </>
  );
}

export default ReportPage;
```

Check `YearPicker`'s option labels. It may render raw years, or a label such as `2026–2027`; keep whatever it does.

In `apps/portal/app/home/page.tsx`, at both places that render `<MemberHome …/>`:
1. Load the member's volunteering next to `dues`:

   ```ts
   const volunteering = await readDuesIfDeployed(() => new EventsService(client).myVolunteering());
   ```

   Use whichever Supabase client variable the surrounding code uses for `DuesService`.
2. Render `{volunteering.deployed ? <VolunteerHomeCard data={volunteering.value} /> : null}` directly after `<MemberHome …/>`, inside a fragment or the existing wrapper.

Add the imports `EventsService` (from `@kit/events/server/events.service`) and `VolunteerHomeCard` (from `@kit/events/components/volunteer-home-card`).

- [ ] **Step 5: Run the tests, typecheck and commit**

Run:
```bash
pnpm --filter @kit/events exec vitest run
pnpm turbo run typecheck test:unit --filter=@kit/events --filter=portal
```
Expected: all pass.

```bash
git add packages/features/events/src/components apps/portal/app/home/volunteering apps/portal/app/home/events/report apps/portal/app/home/page.tsx
git commit -m "feat(events): my volunteering, member-home card and the hours report"
```

---

### Task 8: End-to-end and test-data cleanup

**Files:**
- Modify:
  - `apps/e2e/tests/dues/dues.po.ts`: export the existing `HEADER` constant, the `escapeCsv` function and the `SUPABASE_SERVICE_ROLE_KEY` constant. Only add `export`.
  - `apps/e2e/tests/utils/cleanup.ts`: remove events test data.
- Create: `apps/e2e/tests/events/events.po.ts` and `apps/e2e/tests/events/events.spec.ts`

**Interfaces:**
- Consumes:
  - `AuthPageObject.signUpFlow(path)`;
  - `RbacPageObject.promoteToAdministrator(email)`;
  - `DuesPageObject.goToImport()`, `uploadAndConfirmRoster(fixture)` and `linkMemberToUser(membershipNumber, email)`;
  - the test IDs from Tasks 5–7.
- Produces: a spec with 4 serial scenarios, and cleanup of events data made by test users.

- [ ] **Step 1: Extend the cleanup**

In `cleanUpE2EData` (`apps/e2e/tests/utils/cleanup.ts`), after the `dues_periods` block and before `delete from public.members`, add:

```ts
      await tx`
        delete from public.event_signups
        where member_id in (select id from e2e_members)`;

      await tx`
        delete from public.events
        where created_by in (select id from e2e_users)`;

      await tx`
        delete from public.event_series
        where created_by in (select id from e2e_users)`;
```

Deleting events cascades to their shifts and to any remaining sign-ups.

- [ ] **Step 2: Write the page object**

`apps/e2e/tests/events/events.po.ts`:

```ts
import { Page, expect } from '@playwright/test';

import { HEADER, escapeCsv } from '../dues/dues.po';

/**
 * A roster CSV of `count` members, all `dues.<n>@example.com` so the global
 * teardown removes them. Numbers 9_999_000-9_999_899 keep clear of the dues
 * (9_950_000-9_998_999) and members (up to 9_900_008) fixtures.
 */
export function buildVolunteerRoster(count: number) {
  const base = 9_999_000 + (Date.now() % 300) * 3;
  const people = Array.from({ length: count }, (_, i) => {
    const number = String(base + i);
    return { number, email: `dues.${number}@example.com`, firstName: 'Volunteer', lastName: `Tester${number}` };
  });

  const rows = people.map((p) =>
    HEADER.map((_, index) => {
      switch (index) {
        case 0: return p.number;
        case 2: return p.firstName;
        case 4: return p.lastName;
        case 7: return 'Member';
        case 24: return p.email;
        default: return '';
      }
    }),
  );

  const csv = [HEADER, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n');

  return {
    people,
    fixture: {
      filename: `volunteer-roster-${base}.csv`,
      buffer: Buffer.from(csv, 'utf8'),
      membershipNumber: people[0]!.number,
      fullName: `${people[0]!.firstName} ${people[0]!.lastName}`,
      email: people[0]!.email,
    },
  };
}

export class EventsPageObject {
  constructor(readonly page: Page) {}

  goToEvents(query = '') {
    return this.page.goto(`/home/events${query}`);
  }

  async createWeeklyEvent(params: { title: string; date: string; until: string; weekday: number; capacity: number; leadSearch: string }) {
    await this.page.goto('/home/events/new');
    await this.page.fill('[data-test="event-title"]', params.title);
    await this.page.fill('[data-test="event-date"]', params.date);
    await this.page.fill('[data-test="shift-row-0-capacity"]', String(params.capacity));
    await this.page.fill('[data-test="event-lead"]', params.leadSearch);
    await this.page.getByRole('option').first().click();
    await this.page.selectOption('[data-test="repeat-freq"]', 'weekly');
    await this.page.click(`[data-test="repeat-weekday-${params.weekday}"]`);
    await this.page.fill('[data-test="repeat-until"]', params.until);
    await expect(this.page.locator('[data-test="repeat-preview"]')).toContainText('Creates');
    await this.page.click('[data-test="event-save"]');
    await this.page.waitForURL(/\/home\/events\/[0-9a-f-]{36}$/);

    return this.page.url().split('/').pop()!;
  }
}
```

- [ ] **Step 3: Write the spec**

`apps/e2e/tests/events/events.spec.ts`:

```ts
/**
 * Volunteer events end to end: an officer creates a weekly event led by a
 * member; two members fill its two-person shift and a third is refused; once
 * the shift has started the lead takes attendance; the hours reach the
 * member's page and the officer's report. Run against `pnpm stack:up`.
 */
import { Browser, BrowserContext, Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { DuesPageObject, SUPABASE_SERVICE_ROLE_KEY } from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';
import { EventsPageObject, buildVolunteerRoster } from './events.po';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY = SUPABASE_SERVICE_ROLE_KEY;

function chicagoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

test.describe('Volunteer events', () => {
  test.describe.configure({ mode: 'serial' });

  const roster = buildVolunteerRoster(3);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  let officer: Page;
  let eventId: string;

  async function member(browser: Browser) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    return { page, email: await new AuthPageObject(page).signUpFlow('/home') };
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    officer = await browser.newPage();
    const officerEmail = await new AuthPageObject(officer).signUpFlow('/home');
    await new RbacPageObject(officer).promoteToAdministrator(officerEmail);
    await officer.reload();

    const dues = new DuesPageObject(officer);
    await dues.goToImport();
    await dues.uploadAndConfirmRoster(roster.fixture);

    for (const person of roster.people) {
      const { email } = await member(browser);
      await dues.linkMemberToUser(person.number, email);
    }
  });

  test.afterAll(async () => {
    await officer.close();
    await Promise.all(contexts.map((c) => c.close()));
  });

  test('1. an officer creates a weekly event with a two-person shift and a lead', async () => {
    const tomorrow = chicagoDate(1);
    const weekday = new Date(`${tomorrow}T12:00:00Z`).getUTCDay();

    eventId = await new EventsPageObject(officer).createWeeklyEvent({
      title: `Pantry ${roster.people[0]!.number}`,
      date: tomorrow,
      until: chicagoDate(15),
      weekday,
      capacity: 2,
      leadSearch: roster.people[0]!.lastName,
    });

    await expect(officer.getByText(`Lead: Volunteer ${roster.people[0]!.lastName}`)).toBeVisible();
  });

  test('2. two members fill the shift and a third is refused', async () => {
    const [lead, second, third] = pages;
    const shift = (page: Page) => page.locator('[data-test^="shift-signup-"]').first();

    for (const page of [lead!, second!]) {
      await page.goto(`/home/events/${eventId}`);
      await shift(page).click();
      await expect(page.getByText('You are signed up.')).toBeVisible();
    }

    await third!.goto(`/home/events/${eventId}`);
    await expect(third!.locator('[data-test^="shift-full-"]')).toBeVisible();
    await expect(third!.locator('[data-test="event-edit"]')).toHaveCount(0);
    await expect(third!.locator('[data-test="attendance-panel"]')).toHaveCount(0);
  });

  test('3. once the shift starts, the lead takes attendance', async ({ request }) => {
    // Simulate time passing: move this event's shift to have started 3 hours ago.
    const started = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const ended = new Date(Date.now() - 30 * 60_000).toISOString();
    const res = await request.patch(`${SUPABASE_URL}/rest/v1/event_shifts?event_id=eq.${eventId}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      data: { starts_at: started, ends_at: ended },
    });
    expect(res.ok()).toBeTruthy();

    const lead = pages[0]!;
    await lead.goto(`/home/events/${eventId}`);
    const panel = lead.locator('[data-test="attendance-panel"]');
    await expect(panel).toBeVisible();

    const rows = panel.locator('li').filter({ has: lead.locator('[data-test^="attendance-status-"]') });
    const leadRow = rows.filter({ hasText: roster.people[0]!.lastName });
    const secondRow = rows.filter({ hasText: roster.people[1]!.lastName });

    await leadRow.locator('[data-test^="attendance-hours-"]').fill('2.5');
    await leadRow.locator('[data-test^="attendance-save-"]').click();
    await expect(lead.getByText('Attendance saved.').first()).toBeVisible();

    await secondRow.locator('[data-test^="attendance-status-"]').selectOption('no_show');
    await secondRow.locator('[data-test^="attendance-save-"]').click();
    await expect(secondRow).not.toContainText('Confirmed');

    await lead.goto('/home/volunteering');
    await expect(lead.locator('[data-test="volunteering-year-hours"]')).toContainText('2.5');
  });

  test('4. the report shows the hours; a plain member has no report', async () => {
    await officer.goto('/home/events/report');
    await expect(officer.locator('[data-test="report-by-member"]')).toContainText(roster.people[0]!.lastName);
    await expect(officer.locator('[data-test="report-by-member"]')).toContainText('2.5');

    const plain = pages[2]!;
    await plain.goto('/home/events/report');
    await expect(plain).not.toHaveURL(/\/home\/events\/report/);
  });
});
```

- [ ] **Step 4: Run it against the rebuilt stack**

Run:
```bash
pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/events --reporter=line
```
Expected: 4 passed. Afterwards, the global teardown leaves no `dues.9999…@example.com` users and no events created by test users. Check with:

```bash
docker exec supabase_db_next-supabase-saas-kit-turbo-lite psql -U postgres -At -c "select count(*) from public.events"
```

The count should equal the number of events that existed before the run.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/tests/events apps/e2e/tests/utils/cleanup.ts apps/e2e/tests/dues/dues.po.ts
git commit -m "test(e2e): volunteer events sign-up, attendance and hours"
```
