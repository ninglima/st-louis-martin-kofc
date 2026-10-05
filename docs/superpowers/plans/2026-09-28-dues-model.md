# Dues Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the portal a per-member dues ledger with anniversary-based paid-through dates, Financial Secretary (FS) payment recording, a one-off paid-through CSV load, level-priced online checkout, and a `finance` RBAC section.

**Architecture:**
- All dues rules live in Postgres: a `dues_periods` ledger, `security definer` functions gated by `kit.has_permission('finance', …)`, and a trigger on `payments` that turns a succeeded online dues payment into a period.
- A new feature package, `@kit/dues`, holds typed service wrappers, Zod schemas, server actions and components.
- The portal adds a member detail page, a CSV load page, level-aware checkout, dues columns on the Members list, and the member's own dues view.

**Tech Stack:** Supabase Postgres 17 (plpgsql, `btree_gist`, pgTAP via `supabase test db`), Next.js 16 server components and server actions (`enhanceAction`), react-hook-form with Zod 4, `@kit/ui`, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-dues-model-design.md`

## Global Constraints

**Dues levels** (slug, name, amount_cents, self_service), exactly:
- `regular_contrib`, "Regular (with voluntary contribution)", 5800, true
- `regular`, "Regular", 5000, true
- `student`, "Student", 2500, false (offered only when `members.is_student`)
- `public_service`, "Public Service", 2000, false
- `honorary`, "Honorary", 1900, false

**Periods and dates:**
- A period covers `[period_start, period_end)` with `period_end = period_start + 365`. `period_end` is exclusive.
- A renewal starts at the member's latest active `period_end`; a first period starts at `accepted_on`. Callers never pass `period_start`.
- `dues_status`, evaluated in this order:
  - `no_record`: no active periods and no `accepted_on`
  - `due`: `accepted_on` set, no active periods yet
  - `lapsed`: `paid_through <= today`
  - `due_soon`: `paid_through <= today + 90`
  - `current`: otherwise
- `accepted_on` can change only while the member has no active periods.

**The ledger:**
- `dues_method` values are `online`, `check`, `cash`, `waived` and `opening_balance`. `waived` and `opening_balance` rows always carry `amount_cents = 0`.
- Dues amounts are always priced on the server from `dues_levels`; the UI picks a level from a dropdown. Only donations and event fees take a typed amount.
- `dues_periods` rows are never updated except to set the void columns once, and never deleted.

**Permissions and data flow:**
- RBAC section key: `finance`, verbs `view` and `manage`. The administrator role gets both; the member role gets neither.
- The roster import (`member_upsert_from_roster`) must stay unable to write any dues column.
- Migrations only add things; nothing existing is dropped or renamed.

**Environment:**
- Bash commands run sandboxed:
  - pnpm needs `allowed_domains: ["registry.npmjs.org"]`, or it hangs silently.
  - Docker, Supabase CLI, Playwright, and router tests (which bind ports) need `dangerouslyDisableSandbox: true`.
  - `/tmp` is not writable; use `$TMPDIR`.
- `oxfmt --check` already fails on 25 pre-existing files. Your bar is no new failures in the files you touch.

## Review Focus

1. **A dues payment from an account with no linked member row** (an auth user whose id is not any `members.user_id`). Checkout must refuse dues with a clear message, and the payments trigger must never make a webhook's status update fail. Tested in Tasks 3 and 7.
2. **The same payment recorded twice at once** (double-click Save, two tabs). The second write must chain after the first, or be rejected; it must never overlap silently. Tested in Task 2 with the member-row lock plus the exclusion constraint.
3. **Recording a payment for a member with no `accepted_on` and no periods.** This must give a clear "set the acceptance date first" error, not a period with a null start. Tested in Task 2.
4. **Messy CSV input:**
   - the same membership number twice
   - `paid_through` in `M/D/YYYY` form (as Excel exports it) or in `YYYY-MM-DD`
   - a blank line
   - a date more than 2 years out or more than 5 years back (flagged as suspicious)
   - a BOM on the header

   The preview must flag or normalise each, never apply garbage. Tested in Task 6.
5. **A rate change after payments exist.** Past ledger rows keep the amount charged, while the member summary's `amount_cents` (used for "owed") shows the new rate. Tested in Task 1.
6. **Voiding a period that isn't the latest.** `paid_through` becomes the latest remaining active `period_end`, and the next renewal chains from it. Tested in Task 2.

---

## File Structure

```
apps/portal/supabase/migrations/
  20260928120000_dues_model.sql          Task 1: finance section, levels, member columns, ledger, status, read fns
  20260928120100_dues_writes.sql         Task 2: record/void/accepted/level/student functions
  20260928120200_dues_online_and_load.sql Task 3: payments trigger, opening-balance apply
apps/portal/supabase/tests/
  00_dues_helpers.sql                    test fixtures (users, roles, members) as a pgTAP-free helper
  dues_model.test.sql                    Task 1
  dues_writes.test.sql                   Task 2
  dues_online_and_load.test.sql          Task 3
packages/features/rbac/src/types/sections.ts        Task 1: + finance
packages/supabase/src/database.types.ts             Tasks 1-3: regenerated
apps/portal/lib/database.types.ts                   Tasks 1-3: regenerated
packages/features/dues/                              Task 4: new package @kit/dues
  package.json, tsconfig.json, vitest.config.ts
  src/types.ts                 DuesLevel, DuesMethod, DuesStatus, MemberDuesSummary, DuesLedgerRow
  src/schemas.ts(+test)        RecordPaymentSchema, VoidPeriodSchema, AcceptedOnSchema, LevelSchema, StudentSchema
  src/server/dues.service.ts   typed RPC wrappers
  src/server/dues-actions.ts   server actions
  src/components/dues-status-badge.tsx(+test)
  src/components/member-dues-card.tsx
  src/components/record-payment-form.tsx
  src/csv/paid-through-csv.ts(+test)                Task 6
  src/components/paid-through-import.tsx            Task 6
apps/portal/app/home/members/[id]/page.tsx           Task 5
apps/portal/app/home/members/dues-import/page.tsx    Task 6
packages/features/payments/src/schemas/create-payment.schema.ts  Task 7
packages/features/payments/src/server/server-actions.ts          Task 7
packages/features/payments/src/components/checkout-form.tsx      Task 7
apps/portal/app/home/checkout/page.tsx                            Task 7
packages/features/members/src/components/members-list.tsx        Task 8
apps/portal/app/home/members/page.tsx                             Task 8
apps/portal/app/home/payments/page.tsx                            Task 8
apps/e2e/tests/dues/dues.spec.ts                                  Task 9
```

Ruling recorded in this plan: the spec says the Stripe and Square webhook handlers call `record_online_dues_period`. Payments reach `succeeded` from three places (both webhooks and `confirmSquarePaymentAction`), so the plan uses one `after update of status` trigger on `payments` instead. It covers every path, present and future. The spec also names `my_dues()`; the plan implements it as two functions, `my_dues_summary()` and `my_dues_ledger()`, matching the admin-side pair.

---

### Task 1: `finance` section, schema, ledger, status, read functions

**Files:**
- Create: `apps/portal/supabase/migrations/20260928120000_dues_model.sql`, `apps/portal/supabase/tests/00_dues_helpers.sql`, `apps/portal/supabase/tests/dues_model.test.sql`
- Modify: `packages/features/rbac/src/types/sections.ts`, `packages/supabase/src/database.types.ts`, `apps/portal/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces (SQL):
  - Tables: `public.dues_levels`, `public.dues_periods`.
  - Type: `public.dues_method`.
  - Member columns: `dues_level`, `accepted_on`, `is_student`.
  - Internal functions:
    - `kit.dues_next_period_start(p_member uuid) returns date`
    - `kit.dues_paid_through(p_member uuid) returns date`
    - `kit.dues_status(p_paid_through date, p_accepted_on date, p_today date default current_date) returns text`
  - Read functions:
    - `public.member_dues_summary(p_member_ids uuid[])`
    - `public.member_dues_ledger(p_member_id uuid)`
    - `public.my_dues_summary()`
    - `public.my_dues_ledger()`
- Produces (TS): `SECTIONS` includes `{ key: 'finance', verbs: ['view','manage'] }`.

- [ ] **Step 1: Add the `finance` section in code**

In `packages/features/rbac/src/types/sections.ts`, append after the `members` entry:

```ts
  {
    key: 'finance',
    label: 'Finance',
    description:
      'View: members’ dues status, paid-through dates and ledgers. Manage: record and void dues payments, set acceptance dates and levels, load paid-through dates',
    verbs: ['view', 'manage'],
  },
```

Run `pnpm --filter @kit/rbac test:unit`. Expected: PASS. If a test pins the section list, add `finance` to its expectation.

- [ ] **Step 2: Write the test helper and the failing pgTAP test**

`apps/portal/supabase/tests/00_dues_helpers.sql`:
- Runs first alphabetically.
- Defines fixture functions in a `tests` schema. They are recreated in every run and rolled back, because each test file wraps itself in a transaction, and `supabase test db` runs files in separate sessions. So each test file calls `\ir 00_dues_helpers.sql` at its top.

```sql
-- Fixtures for dues tests. Included by each *.test.sql via \ir; creates
-- objects inside the caller's transaction so everything rolls back.
create schema if not exists tests;

create or replace function tests.make_user(p_email text, p_role text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), '{}', '{}', now(), now());
  insert into public.user_roles (user_id, role_id)
  select v_id, id from public.roles where slug = p_role
  on conflict (user_id) do update set role_id = excluded.role_id;
  return v_id;
end $$;

create or replace function tests.make_member(p_number text, p_user uuid default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.members (membership_number, first_name, last_name, primary_email, user_id)
  values (p_number, 'Test', 'Knight ' || p_number, p_number || '@example.com', p_user)
  returning id into v_id;
  return v_id;
end $$;

-- Act as a signed-in user for RLS / auth.uid().
create or replace function tests.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
```

Before relying on it, check the `members` columns the helper inserts: `\d public.members` in the local DB, or read `20260922215412_members.sql`. If other not-null columns exist, add values for them to `tests.make_member`.

`apps/portal/supabase/tests/dues_model.test.sql`:

```sql
begin;
\ir 00_dues_helpers.sql
select plan(17);

-- schema
select has_table('public', 'dues_levels', 'dues_levels exists');
select has_table('public', 'dues_periods', 'dues_periods exists');
select has_column('public', 'members', 'accepted_on', 'members.accepted_on exists');
select results_eq(
  $$ select slug, amount_cents, self_service from public.dues_levels order by sort_order $$,
  $$ values ('regular_contrib', 5800, true), ('regular', 5000, true), ('student', 2500, false),
            ('public_service', 2000, false), ('honorary', 1900, false) $$,
  'seeded levels and amounts');
select has_column('public', 'members', 'dues_level', 'members.dues_level exists');
select is(
  (select can_view and can_manage from public.role_permissions rp join public.roles r on r.id = rp.role_id
   where r.slug = 'administrator' and rp.section = 'finance'),
  true, 'administrator has finance view+manage');

-- status function (pure)
select is(kit.dues_status(null, null, '2027-01-01'), 'no_record', 'no periods, no accepted_on');
select is(kit.dues_status(null, '2026-12-01', '2027-01-01'), 'due', 'accepted, never paid');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-10-01'), 'lapsed', 'lapsed on paid_through day');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-09-30'), 'due_soon', 'day before paid_through');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-07-03'), 'due_soon', 'exactly 90 days out');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-07-02'), 'current', '91 days out');

-- ledger constraints (as postgres, bypassing functions)
select tests.make_member('100001') as m1 \gset
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'m1', 'regular_contrib', 0, 'opening_balance', '2026-01-01', '2026-01-01', '2027-01-01');
select throws_ok(
  format($$ insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
            values (%L, 'regular', 5000, 'cash', '2026-06-01', '2026-06-01', '2027-06-01') $$, :'m1'),
  '23P01', null, 'overlapping active periods rejected');
select throws_ok(
  format($$ update public.dues_periods set amount_cents = 1 where member_id = %L $$, :'m1'),
  'P0001', null, 'periods are immutable');
select throws_ok(
  format($$ delete from public.dues_periods where member_id = %L $$, :'m1'),
  'P0001', null, 'periods cannot be deleted');

-- rate change keeps history (Review Focus 5)
update public.dues_levels set amount_cents = 6000 where slug = 'regular_contrib';
select is((select amount_cents from public.dues_periods where member_id = :'m1'), 0, 'history keeps charged amount');
select tests.make_user('fs@example.com', 'administrator') as fs \gset
select tests.act_as(:'fs');
select is(
  (select amount_cents from public.member_dues_summary(array[:'m1'::uuid])),
  6000, 'summary prices owed at the current rate');

select * from finish();
rollback;
```

Setup statements that return a row (like the bare `select public.record_dues_payment(...)` calls in later tests) print non-TAP lines. pg_prove ignores them. If your runner rejects them, wrap each in `lives_ok(...)` and raise the `plan(n)` count to match.

- [ ] **Step 3: Run the test to confirm it fails**

With local Supabase running (`pnpm supabase:web:start`, sandbox disabled):
Run: `cd apps/portal && pnpm exec supabase test db` (sandbox disabled).
Expected: FAIL. `has_table dues_levels` fails because the migration doesn't exist.

The package script `supabase:test` runs `supabase db test`. If your CLI rejects that, use `supabase test db` (the current CLI name) and update the script in `apps/portal/package.json` to match.

- [ ] **Step 4: Write the migration**

`apps/portal/supabase/migrations/20260928120000_dues_model.sql`:

```sql
-- Dues model, part 1: levels, member dues columns, the dues_periods ledger,
-- derived status, gated read functions, and the `finance` RBAC section.
-- Spec: docs/superpowers/specs/2026-09-28-dues-model-design.md

create extension if not exists btree_gist with schema extensions;

-- finance section: administrator gets view + manage; member gets nothing.
insert into public.role_permissions (role_id, section, can_view, can_manage)
select id, 'finance', true, true from public.roles where slug = 'administrator'
on conflict (role_id, section) do nothing;

create table public.dues_levels (
  slug          text primary key,
  name          text not null,
  amount_cents  integer not null check (amount_cents >= 0),
  self_service  boolean not null default false,
  sort_order    integer not null,
  active        boolean not null default true
);

insert into public.dues_levels (slug, name, amount_cents, self_service, sort_order) values
  ('regular_contrib', 'Regular (with voluntary contribution)', 5800, true,  1),
  ('regular',         'Regular',                               5000, true,  2),
  ('student',         'Student',                               2500, false, 3),
  ('public_service',  'Public Service',                        2000, false, 4),
  ('honorary',        'Honorary',                              1900, false, 5);

alter table public.dues_levels enable row level security;
create policy dues_levels_select on public.dues_levels for select to authenticated using (true);
grant select on public.dues_levels to authenticated;

alter table public.members
  add column dues_level  text not null default 'regular_contrib' references public.dues_levels(slug),
  add column accepted_on date,
  add column is_student  boolean not null default false;

create type public.dues_method as enum ('online', 'check', 'cash', 'waived', 'opening_balance');

create table public.dues_periods (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete restrict,
  level         text not null references public.dues_levels(slug),
  amount_cents  integer not null check (amount_cents >= 0),
  method        public.dues_method not null,
  check_number  text,
  received_on   date not null,
  period_start  date not null,
  period_end    date not null,
  payment_id    uuid unique references public.payments(id) on delete restrict,
  recorded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by     uuid references auth.users(id) on delete set null,
  void_reason   text,
  constraint dues_periods_length       check (period_end = period_start + 365),
  constraint dues_periods_check_number check (method <> 'check' or nullif(btrim(check_number), '') is not null),
  constraint dues_periods_zero_amount  check (method not in ('waived', 'opening_balance') or amount_cents = 0),
  constraint dues_periods_void_shape   check ((voided_at is null) = (void_reason is null)),
  constraint dues_periods_no_overlap
    exclude using gist (member_id with =, daterange(period_start, period_end) with &&)
    where (voided_at is null)
);

create index dues_periods_member_idx on public.dues_periods (member_id) where voided_at is null;

-- No direct access: every read and write goes through the functions below.
alter table public.dues_periods enable row level security;

create or replace function kit.dues_periods_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dues periods cannot be deleted; void them instead';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided dues period cannot change';
  end if;
  if (new.id, new.member_id, new.level, new.amount_cents, new.method, new.check_number,
      new.received_on, new.period_start, new.period_end, new.payment_id, new.recorded_by, new.created_at)
     is distinct from
     (old.id, old.member_id, old.level, old.amount_cents, old.method, old.check_number,
      old.received_on, old.period_start, old.period_end, old.payment_id, old.recorded_by, old.created_at)
     or new.voided_at is null then
    raise exception 'dues periods are immutable; only voiding is allowed';
  end if;
  return new;
end $$;

create trigger dues_periods_guard
  before update or delete on public.dues_periods
  for each row execute function kit.dues_periods_guard();

create or replace function kit.dues_paid_through(p_member uuid)
returns date language sql stable security definer set search_path = '' as $$
  select max(period_end) from public.dues_periods where member_id = p_member and voided_at is null;
$$;

create or replace function kit.dues_next_period_start(p_member uuid)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce(kit.dues_paid_through(p_member),
                  (select accepted_on from public.members where id = p_member));
$$;

create or replace function kit.dues_status(p_paid_through date, p_accepted_on date, p_today date default current_date)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_paid_through is null and p_accepted_on is null then 'no_record'
    when p_paid_through is null then 'due'
    when p_paid_through <= p_today then 'lapsed'
    when p_paid_through <= p_today + 90 then 'due_soon'
    else 'current'
  end;
$$;

revoke all on function kit.dues_paid_through(uuid) from public, anon, authenticated;
revoke all on function kit.dues_next_period_start(uuid) from public, anon, authenticated;
grant execute on function kit.dues_status(date, date, date) to authenticated;

create or replace function public.member_dues_summary(p_member_ids uuid[])
returns table (
  member_id uuid, dues_level text, level_name text, amount_cents integer,
  accepted_on date, is_student boolean, paid_through date, dues_status text
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.dues_level, l.name, l.amount_cents, m.accepted_on, m.is_student,
         kit.dues_paid_through(m.id),
         kit.dues_status(kit.dues_paid_through(m.id), m.accepted_on)
  from public.members m
  join public.dues_levels l on l.slug = m.dues_level
  where m.id = any(p_member_ids)
    and kit.has_permission('finance', 'view');
$$;

create or replace function public.member_dues_ledger(p_member_id uuid)
returns table (
  id uuid, level text, level_name text, amount_cents integer, method public.dues_method,
  check_number text, received_on date, period_start date, period_end date,
  recorded_by_email text, created_at timestamptz, voided_at timestamptz, void_reason text
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.level, l.name, p.amount_cents, p.method, p.check_number, p.received_on,
         p.period_start, p.period_end, u.email, p.created_at, p.voided_at, p.void_reason
  from public.dues_periods p
  join public.dues_levels l on l.slug = p.level
  left join auth.users u on u.id = p.recorded_by
  where p.member_id = p_member_id
    and kit.has_permission('finance', 'view')
  order by p.period_start desc, p.created_at desc;
$$;

create or replace function public.my_dues_summary()
returns table (
  member_id uuid, dues_level text, level_name text, amount_cents integer,
  accepted_on date, is_student boolean, paid_through date, dues_status text
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.dues_level, l.name, l.amount_cents, m.accepted_on, m.is_student,
         kit.dues_paid_through(m.id),
         kit.dues_status(kit.dues_paid_through(m.id), m.accepted_on)
  from public.members m
  join public.dues_levels l on l.slug = m.dues_level
  where m.user_id = (select auth.uid());
$$;

create or replace function public.my_dues_ledger()
returns table (
  id uuid, level_name text, amount_cents integer, method public.dues_method,
  received_on date, period_start date, period_end date, voided_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id, l.name, p.amount_cents, p.method, p.received_on, p.period_start, p.period_end, p.voided_at
  from public.dues_periods p
  join public.dues_levels l on l.slug = p.level
  join public.members m on m.id = p.member_id
  where m.user_id = (select auth.uid())
  order by p.period_start desc;
$$;

grant execute on function public.member_dues_summary(uuid[]) to authenticated;
grant execute on function public.member_dues_ledger(uuid)    to authenticated;
grant execute on function public.my_dues_summary()           to authenticated;
grant execute on function public.my_dues_ledger()            to authenticated;
```

- [ ] **Step 5: Apply the migration and run the tests**

Run (sandbox disabled): `cd apps/portal && pnpm exec supabase db reset && pnpm exec supabase test db`.
Expected: PASS, 17/17 in `dues_model.test.sql`.

`db reset` wipes local data, including the developer's own account, which must be re-created and re-promoted. Before resetting, tell the user in your report that a reset is needed. If the user's local data must be kept, use `pnpm exec supabase migration up` instead.

- [ ] **Step 6: Regenerate types, then verify and commit**

```bash
pnpm supabase:web:typegen
pnpm typecheck && pnpm lint
git add apps/portal/supabase packages/features/rbac packages/supabase/src/database.types.ts apps/portal/lib/database.types.ts
git commit -m "feat(dues): add the dues ledger, levels, status and finance section"
```

---

### Task 2: Write functions (record, void, accepted date, level, student)

**Files:**
- Create: `apps/portal/supabase/migrations/20260928120100_dues_writes.sql`, `apps/portal/supabase/tests/dues_writes.test.sql`
- Modify: the regenerated types (as in Task 1)

**Interfaces:**
- Consumes: Task 1 tables and `kit.*` functions.
- Produces:
  - `public.record_dues_payment(p_member_id uuid, p_level text, p_method public.dues_method, p_received_on date, p_check_number text default null) returns public.dues_periods`
  - `public.void_dues_period(p_period_id uuid, p_reason text) returns void`
  - `public.set_member_accepted_on(p_member_id uuid, p_accepted_on date) returns void`
  - `public.set_member_dues_level(p_member_id uuid, p_level text) returns void`
  - `public.set_member_student(p_member_id uuid, p_is_student boolean) returns void`
  - All of them raise SQLSTATE `42501` with message `forbidden` without `finance.manage`, and `P0001` with a readable message for rule violations.

- [ ] **Step 1: Write the failing test**

`apps/portal/supabase/tests/dues_writes.test.sql`:

```sql
begin;
\ir 00_dues_helpers.sql
select plan(16);

select tests.make_user('fs2@example.com', 'administrator') as fs \gset
select tests.make_user('knight@example.com', 'member')    as knight \gset
select tests.make_member('200001') as m \gset
select tests.make_member('200002') as noacc \gset

-- permission
select tests.act_as(:'knight');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date) $$, :'m'),
  '42501', 'forbidden', 'member cannot record dues');

select tests.act_as(:'fs');

-- Review Focus 3: no accepted_on, no periods
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date) $$, :'noacc'),
  'P0001', 'set the member''s acceptance date before recording dues', 'needs accepted_on first');

-- accepted_on, first payment chains from it
select lives_ok(format($$ select public.set_member_accepted_on(%L, '2026-03-15') $$, :'m'), 'set accepted_on');
select is((select period_start from public.record_dues_payment(:'m', 'regular_contrib', 'check', '2026-03-20', '1042')),
  '2026-03-15'::date, 'first period starts at accepted_on');
select is((select amount_cents from public.dues_periods where member_id = :'m' and voided_at is null order by period_start desc limit 1),
  5800, 'priced from the level');

-- late renewal chains from the old end, not the payment date
select is((select period_start from public.record_dues_payment(:'m', 'regular_contrib', 'cash', '2027-06-01')),
  '2027-03-15'::date, 'late renewal keeps the anniversary');
select is(kit.dues_paid_through(:'m'), '2028-03-14'::date, 'paid through two years (365+365 days)');

-- accepted_on locked once paid
select throws_ok(format($$ select public.set_member_accepted_on(%L, '2026-01-01') $$, :'m'),
  'P0001', null, 'accepted_on locked while periods exist');

-- waived is $0, check needs a number
select is((select amount_cents from public.record_dues_payment(:'m', 'regular_contrib', 'waived', '2028-03-01')), 0, 'waived is $0');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'check', current_date, null) $$, :'m'),
  '23514', null, 'check requires a check number');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'online', current_date) $$, :'m'),
  'P0001', null, 'online periods come only from payments');

-- level change on record updates the member
select public.record_dues_payment(:'m', 'honorary', 'cash', '2029-03-01');
select is((select dues_level from public.members where id = :'m'), 'honorary', 'recording at a new level updates the member');

-- Review Focus 6: void a middle period
select public.void_dues_period(
  (select id from public.dues_periods where member_id = :'m' and period_start = '2027-03-15'), 'entered twice');
select is(kit.dues_paid_through(:'m'), '2030-03-14'::date, 'paid_through is the latest remaining active end');
select throws_ok(format($$ select public.void_dues_period((select id from public.dues_periods where member_id = %L and voided_at is not null limit 1), 'again') $$, :'m'),
  'P0001', null, 'cannot void twice');
select throws_ok(format($$ select public.void_dues_period((select id from public.dues_periods where member_id = %L and voided_at is null limit 1), '  ') $$, :'m'),
  'P0001', null, 'void needs a reason');

-- Review Focus 2: two recordings in a row never overlap
select tests.make_member('200003') as m3 \gset
select public.set_member_accepted_on(:'m3', '2026-01-01');
select public.record_dues_payment(:'m3', 'regular', 'cash', '2026-01-02');
select public.record_dues_payment(:'m3', 'regular', 'cash', '2026-01-02');
select is((select count(*)::int from public.dues_periods p1 join public.dues_periods p2
           on p1.member_id = p2.member_id and p1.id < p2.id
           and daterange(p1.period_start, p1.period_end) && daterange(p2.period_start, p2.period_end)
           where p1.member_id = :'m3'), 0, 'double submission chains, never overlaps');

select * from finish();
rollback;
```

The expected dates in this test follow the constraint `period_end = period_start + 365`. Check each one with a date calculator before trusting it:
- 2026-03-15 + 365 = 2027-03-15
- + 365 = 2028-03-14 (2028 is a leap year)
- the waived period covers 2028-03-14 → 2029-03-14
- the honorary period covers 2029-03-14 → 2030-03-14

After the void, the latest remaining active end is still 2030-03-14. If your arithmetic differs, fix the expected literals, never the constraint.

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/portal && pnpm exec supabase test db` (sandbox disabled). Expected: FAIL, because `record_dues_payment` doesn't exist.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20260928120100_dues_writes.sql`:

```sql
-- Dues model, part 2: the FS write functions. All security definer, all gated
-- on finance.manage, all computing period_start and amount themselves.

create or replace function kit.assert_finance_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('finance', 'manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function kit.assert_finance_manage() from public, anon, authenticated;

create or replace function public.record_dues_payment(
  p_member_id uuid, p_level text, p_method public.dues_method,
  p_received_on date, p_check_number text default null)
returns public.dues_periods
language plpgsql security definer set search_path = '' as $$
declare
  v_level  public.dues_levels;
  v_start  date;
  v_row    public.dues_periods;
begin
  perform kit.assert_finance_manage();

  if p_method not in ('check', 'cash', 'waived') then
    raise exception 'the FS records only check, cash or waived dues';
  end if;

  select * into v_level from public.dues_levels where slug = p_level and active;
  if not found then
    raise exception 'unknown dues level: %', p_level;
  end if;

  -- Serialise writers for this member so a double submission chains.
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    raise exception 'unknown member';
  end if;

  v_start := kit.dues_next_period_start(p_member_id);
  if v_start is null then
    raise exception 'set the member''s acceptance date before recording dues';
  end if;

  insert into public.dues_periods
    (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end, recorded_by)
  values
    (p_member_id, p_level,
     case when p_method = 'waived' then 0 else v_level.amount_cents end,
     p_method, nullif(btrim(p_check_number), ''), p_received_on, v_start, v_start + 365, (select auth.uid()))
  returning * into v_row;

  update public.members set dues_level = p_level where id = p_member_id and dues_level <> p_level;

  return v_row;
end $$;

create or replace function public.void_dues_period(p_period_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'a reason is required to void a dues period';
  end if;
  update public.dues_periods
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where id = p_period_id and voided_at is null;
  if not found then
    raise exception 'dues period not found or already voided';
  end if;
end $$;

create or replace function public.set_member_accepted_on(p_member_id uuid, p_accepted_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  if exists (select 1 from public.dues_periods where member_id = p_member_id and voided_at is null) then
    raise exception 'the acceptance date cannot change once dues are recorded; void them first';
  end if;
  update public.members set accepted_on = p_accepted_on where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

create or replace function public.set_member_dues_level(p_member_id uuid, p_level text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  if not exists (select 1 from public.dues_levels where slug = p_level and active) then
    raise exception 'unknown dues level: %', p_level;
  end if;
  update public.members set dues_level = p_level where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

create or replace function public.set_member_student(p_member_id uuid, p_is_student boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  update public.members set is_student = p_is_student where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

grant execute on function public.record_dues_payment(uuid, text, public.dues_method, date, text) to authenticated;
grant execute on function public.void_dues_period(uuid, text)          to authenticated;
grant execute on function public.set_member_accepted_on(uuid, date)    to authenticated;
grant execute on function public.set_member_dues_level(uuid, text)     to authenticated;
grant execute on function public.set_member_student(uuid, boolean)     to authenticated;
```

- [ ] **Step 4: Apply and run**

Run (sandbox disabled): `cd apps/portal && pnpm exec supabase migration up && pnpm exec supabase test db`. Expected: all dues tests PASS.

- [ ] **Step 5: Regenerate types, verify and commit**

```bash
pnpm supabase:web:typegen && pnpm typecheck && pnpm lint
git add apps/portal/supabase packages/supabase/src/database.types.ts apps/portal/lib/database.types.ts
git commit -m "feat(dues): add the FS write functions for dues"
```

---

### Task 3: Online payments → periods, and the opening-balance apply function

**Files:**
- Create: `apps/portal/supabase/migrations/20260928120200_dues_online_and_load.sql`, `apps/portal/supabase/tests/dues_online_and_load.test.sql`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `kit.record_online_dues_period(p_payment_id uuid) returns void`: idempotent through `payment_id`. The dues level is read from `payments.metadata->>'dues_level'`.
  - An `after update of status` trigger on `public.payments`:
    - `succeeded` on a `dues` payment calls `kit.record_online_dues_period`;
    - `refunded` voids the linked period with the reason `payment refunded`.
    - The trigger never raises. A payment it can't link is written to the Postgres log with `raise warning`.
  - `public.dues_opening_balances_apply(p_rows jsonb) returns jsonb`. The input is an array of `{membership_number, paid_through, dues_level?}`. It returns `{ "applied": int, "skipped": [{ "membership_number": text, "reason": text }] }`.

- [ ] **Step 1: Write the failing test**

`apps/portal/supabase/tests/dues_online_and_load.test.sql`:

```sql
begin;
\ir 00_dues_helpers.sql
select plan(11);

select tests.make_user('fs3@example.com', 'administrator') as fs \gset
select tests.make_user('payer@example.com', 'member') as payer \gset
select tests.make_user('orphan@example.com', 'member') as orphan \gset
select tests.make_member('300001', :'payer') as m \gset
update public.members set accepted_on = '2026-05-01' where id = :'m';

-- a pending online dues payment, then succeeded (as the webhook would, service role)
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a001', :'payer', 'stripe', 'pi_1', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a001';
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 1, 'succeeded dues payment creates a period');
select is((select period_start from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), '2026-05-01'::date, 'online period chains from accepted_on');
select is((select amount_cents from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 5000, 'online period records the charged amount');

-- replay: flip away and back
update public.payments set status = 'processing' where id = '00000000-0000-0000-0000-00000000a001';
update public.payments set status = 'succeeded'  where id = '00000000-0000-0000-0000-00000000a001';
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 1, 'replay creates no second period');

-- refund voids
update public.payments set status = 'refunded' where id = '00000000-0000-0000-0000-00000000a001';
select isnt((select voided_at from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), null, 'refund voids the period');

-- donations never touch the ledger
insert into public.payments (id, user_id, provider, amount, status, payment_type)
values ('00000000-0000-0000-0000-00000000a002', :'payer', 'stripe', 1234, 'pending', 'donation');
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a002';
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a002'), 0, 'donation creates no period');

-- Review Focus 1: payer with no member row -> status update still succeeds
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a003', :'orphan', 'stripe', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
select lives_ok($$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a003' $$,
  'unlinked payer never breaks the webhook update');

-- opening balances: 300002 is eligible; 300003 already has an active period;
-- 999999 does not exist. (300001's only period was voided by the refund
-- above, so it would be eligible again and is left out on purpose.)
select tests.make_member('300002') as ob \gset
select tests.make_member('300003') as paid \gset
update public.members set accepted_on = '2026-01-01' where id = :'paid';
select tests.act_as(:'fs');
select lives_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', '2026-01-02') $$, :'paid'),
  'setup: 300003 has an active period');
select is(
  public.dues_opening_balances_apply(jsonb_build_array(
    jsonb_build_object('membership_number', '300002', 'paid_through', '2027-02-01', 'dues_level', 'student'),
    jsonb_build_object('membership_number', '300003', 'paid_through', '2027-02-01'),
    jsonb_build_object('membership_number', '999999', 'paid_through', '2027-02-01'))) -> 'applied',
  '1'::jsonb, 'applies only eligible rows');
select is(kit.dues_paid_through(:'ob'), '2027-02-01'::date, 'opening balance sets paid_through');
select tests.act_as(:'payer');
select throws_ok($$ select public.dues_opening_balances_apply('[]'::jsonb) $$, '42501', 'forbidden', 'load needs finance.manage');

select * from finish();
rollback;
```

Before inserting into `payments` in this test, check that table's required columns (`\d public.payments`), and add any not-null ones without defaults to the inserts.

- [ ] **Step 2: Run it to confirm it fails.** Expected: FAIL, because no period is created.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20260928120200_dues_online_and_load.sql`:

```sql
-- Dues model, part 3: online dues payments become ledger periods (from every
-- path that marks a payment succeeded), and the one-off paid-through load.

create or replace function kit.record_online_dues_period(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pay    public.payments;
  v_member public.members;
  v_level  text;
  v_start  date;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found or v_pay.payment_type <> 'dues' then return; end if;

  select * into v_member from public.members where user_id = v_pay.user_id for update;
  if not found then
    raise warning 'dues payment % has no linked member; no period recorded', p_payment_id;
    return;
  end if;

  v_level := coalesce(v_pay.metadata ->> 'dues_level', v_member.dues_level);
  if not exists (select 1 from public.dues_levels where slug = v_level) then
    v_level := v_member.dues_level;
  end if;

  v_start := coalesce(kit.dues_next_period_start(v_member.id), v_pay.created_at::date);

  insert into public.dues_periods
    (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
  values
    (v_member.id, v_level, v_pay.amount, 'online', v_pay.updated_at::date, v_start, v_start + 365, v_pay.id)
  on conflict (payment_id) do nothing;
end $$;
revoke all on function kit.record_online_dues_period(uuid) from public, anon, authenticated;

create or replace function kit.payments_dues_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_type <> 'dues' or new.status is not distinct from old.status then
    return new;
  end if;
  begin
    if new.status = 'succeeded' then
      perform kit.record_online_dues_period(new.id);
    elsif new.status = 'refunded' then
      update public.dues_periods
         set voided_at = now(), void_reason = 'payment refunded'
       where payment_id = new.id and voided_at is null;
    end if;
  exception when others then
    -- Never fail the payment status write (webhooks retry on error, and a
    -- stuck status is worse than a missing period the FS can record).
    raise warning 'dues sync failed for payment %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

create trigger payments_dues_sync
  after update of status on public.payments
  for each row execute function kit.payments_dues_sync();

create or replace function public.dues_opening_balances_apply(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r         jsonb;
  v_member  public.members;
  v_through date;
  v_level   text;
  v_applied int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform kit.assert_finance_manage();

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into v_member from public.members
     where membership_number = r ->> 'membership_number' for update;
    if not found then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'unknown membership number');
      continue;
    end if;
    if exists (select 1 from public.dues_periods where member_id = v_member.id and voided_at is null) then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'already has dues recorded');
      continue;
    end if;
    v_level := coalesce(nullif(r ->> 'dues_level', ''), v_member.dues_level);
    if not exists (select 1 from public.dues_levels where slug = v_level) then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'unknown dues level');
      continue;
    end if;
    v_through := (r ->> 'paid_through')::date;

    insert into public.dues_periods
      (member_id, level, amount_cents, method, received_on, period_start, period_end, recorded_by)
    values
      (v_member.id, v_level, 0, 'opening_balance', current_date, v_through - 365, v_through, (select auth.uid()));
    update public.members set dues_level = v_level where id = v_member.id and dues_level <> v_level;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end $$;

grant execute on function public.dues_opening_balances_apply(jsonb) to authenticated;
```

- [ ] **Step 4: Apply and run.** Run `cd apps/portal && pnpm exec supabase migration up && pnpm exec supabase test db`. Expected: all dues tests PASS.

- [ ] **Step 5: Regenerate types, verify and commit**

```bash
pnpm supabase:web:typegen && pnpm typecheck && pnpm lint
git add apps/portal/supabase packages/supabase/src/database.types.ts apps/portal/lib/database.types.ts
git commit -m "feat(dues): turn online dues payments into periods and load opening balances"
```

---

### Task 4: `@kit/dues` package: types, schemas, service, actions, status badge

**Files:**
- Create:
  - `packages/features/dues/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/types.ts`, `src/schemas.ts`, `src/schemas.test.ts`
  - `src/server/dues.service.ts`, `src/server/dues-actions.ts`
  - `src/components/dues-status-badge.tsx`, `src/components/dues-status-badge.test.tsx`
- Modify: `apps/portal/package.json` (add `"@kit/dues": "workspace:*"`), `apps/portal/next.config.mjs` (add `'@kit/dues'` to `INTERNAL_PACKAGES`)

**Interfaces:**
- Consumes: the Task 1–3 RPCs, through the regenerated `Database` type.
- Produces:
  - `DUES_METHODS_FS = ['check','cash','waived'] as const`
  - `type DuesStatus = 'no_record'|'due'|'lapsed'|'due_soon'|'current'`
  - `interface MemberDuesSummary { memberId: string; duesLevel: string; levelName: string; amountCents: number; acceptedOn: string|null; isStudent: boolean; paidThrough: string|null; duesStatus: DuesStatus }`
  - `interface DuesLedgerRow { id; level; levelName; amountCents; method; checkNumber|null; receivedOn; periodStart; periodEnd; recordedByEmail|null; createdAt; voidedAt|null; voidReason|null }`
  - Schemas: `RecordPaymentSchema`, `VoidPeriodSchema`, `AcceptedOnSchema`, `LevelSchema`, `StudentSchema`
  - `class DuesService(client)` with `levels()`, `summaries(memberIds)`, `ledger(memberId)`, `mySummary()`, `myLedger()`, `recordPayment()`, `voidPeriod()`, `setAcceptedOn()`, `setLevel()`, `setStudent()`, `applyOpeningBalances(rows)`
  - Actions, each returning `DuesActionResult = {success:true} | {success:false; error:string}`: `recordDuesPaymentAction`, `voidDuesPeriodAction`, `setAcceptedOnAction`, `setDuesLevelAction`, `setStudentAction`
  - `<DuesStatusBadge status={DuesStatus} />`

- [ ] **Step 1: Scaffold the package**

Copy the structure of `packages/features/members` (read its `package.json`, `tsconfig.json` and `vitest.config.ts` first):
- `name: "@kit/dues"`
- the same scripts (`typecheck`, `test:unit`)
- exports: `"./types": "./src/types.ts"`, `"./schemas": "./src/schemas.ts"`, `"./server/*": "./src/server/*.ts"`, `"./components/*": "./src/components/*.tsx"`
- dependencies mirroring members': `@kit/next`, `@kit/supabase`, `@kit/ui`, `@kit/rbac`, `zod`, `react-hook-form`, `@hookform/resolvers`, `next`, `react`

Then run `pnpm install` (with `allowed_domains: ["registry.npmjs.org"]`).

- [ ] **Step 2: Write the failing schema tests**

`packages/features/dues/src/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { RecordPaymentSchema, VoidPeriodSchema } from './schemas';

const base = {
  memberId: '6f1c1b1e-1111-4111-8111-111111111111',
  level: 'regular_contrib',
  receivedOn: '2026-10-01',
};

describe('RecordPaymentSchema', () => {
  it('accepts cash and waived without a check number', () => {
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'cash' }).success).toBe(true);
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'waived' }).success).toBe(true);
  });

  it('requires a check number for checks', () => {
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'check' }).success).toBe(false);
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'check', checkNumber: ' 1042 ' }).data?.checkNumber).toBe('1042');
  });

  it('never accepts an amount or online/opening_balance', () => {
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'online' }).success).toBe(false);
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'opening_balance' }).success).toBe(false);
    expect('amount' in (RecordPaymentSchema.parse({ ...base, method: 'cash', amount: 1 }) as object)).toBe(false);
  });

  it('rejects impossible dates', () => {
    expect(RecordPaymentSchema.safeParse({ ...base, method: 'cash', receivedOn: '2026-02-30' }).success).toBe(false);
  });
});

describe('VoidPeriodSchema', () => {
  it('requires a non-blank reason', () => {
    expect(VoidPeriodSchema.safeParse({ periodId: base.memberId, reason: '   ' }).success).toBe(false);
  });
});
```

Run: `pnpm --filter @kit/dues test:unit`. Expected: FAIL, because `./schemas` is missing.

- [ ] **Step 3: Implement types and schemas**

`packages/features/dues/src/types.ts`:

```ts
export const DUES_METHODS_FS = ['check', 'cash', 'waived'] as const;
export type DuesMethodFs = (typeof DUES_METHODS_FS)[number];
export type DuesMethod = DuesMethodFs | 'online' | 'opening_balance';
export type DuesStatus = 'no_record' | 'due' | 'lapsed' | 'due_soon' | 'current';

export interface DuesLevel {
  slug: string;
  name: string;
  amountCents: number;
  selfService: boolean;
}

export interface MemberDuesSummary {
  memberId: string;
  duesLevel: string;
  levelName: string;
  amountCents: number;
  acceptedOn: string | null;
  isStudent: boolean;
  paidThrough: string | null;
  duesStatus: DuesStatus;
}

export interface DuesLedgerRow {
  id: string;
  level: string;
  levelName: string;
  amountCents: number;
  method: DuesMethod;
  checkNumber: string | null;
  receivedOn: string;
  periodStart: string;
  periodEnd: string;
  recordedByEmail: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
```

`packages/features/dues/src/schemas.ts`:

```ts
import * as z from 'zod';

import { DUES_METHODS_FS } from './types';

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Not a real date');

export const RecordPaymentSchema = z
  .object({
    memberId: z.uuid(),
    level: z.string().min(1),
    method: z.enum(DUES_METHODS_FS),
    receivedOn: IsoDate,
    checkNumber: z.string().trim().optional(),
  })
  .strip()
  .refine((v) => v.method !== 'check' || !!v.checkNumber, {
    message: 'A check number is required for check payments',
    path: ['checkNumber'],
  });

export const VoidPeriodSchema = z.object({
  periodId: z.uuid(),
  reason: z.string().trim().min(1, 'A reason is required'),
});

export const AcceptedOnSchema = z.object({ memberId: z.uuid(), acceptedOn: IsoDate });
export const LevelSchema = z.object({ memberId: z.uuid(), level: z.string().min(1) });
export const StudentSchema = z.object({ memberId: z.uuid(), isStudent: z.boolean() });
```

Run: `pnpm --filter @kit/dues test:unit`. Expected: PASS.

- [ ] **Step 4: Implement the service**

`packages/features/dues/src/server/dues.service.ts`: typed wrappers over the RPCs, mapping snake_case rows to the camelCase types above. The pattern:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { DuesLedgerRow, DuesLevel, DuesMethodFs, DuesStatus, MemberDuesSummary } from '../types';

type Client = SupabaseClient<Database>;

type SummaryRow = Database['public']['Functions']['member_dues_summary']['Returns'][number];

function toSummary(row: SummaryRow): MemberDuesSummary {
  return {
    memberId: row.member_id,
    duesLevel: row.dues_level,
    levelName: row.level_name,
    amountCents: row.amount_cents,
    acceptedOn: row.accepted_on,
    isStudent: row.is_student,
    paidThrough: row.paid_through,
    duesStatus: row.dues_status as DuesStatus,
  };
}

export class DuesService {
  constructor(private readonly client: Client) {}

  async levels(): Promise<DuesLevel[]> {
    const { data, error } = await this.client
      .from('dues_levels')
      .select('slug, name, amount_cents, self_service')
      .eq('active', true)
      .order('sort_order');
    if (error) throw new Error(error.message);
    return data.map((l) => ({ slug: l.slug, name: l.name, amountCents: l.amount_cents, selfService: l.self_service }));
  }

  async summaries(memberIds: string[]): Promise<Map<string, MemberDuesSummary>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await this.client.rpc('member_dues_summary', { p_member_ids: memberIds });
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((row) => [row.member_id, toSummary(row)]));
  }

  async ledger(memberId: string): Promise<DuesLedgerRow[]> {
    const { data, error } = await this.client.rpc('member_dues_ledger', { p_member_id: memberId });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id, level: r.level, levelName: r.level_name, amountCents: r.amount_cents, method: r.method,
      checkNumber: r.check_number, receivedOn: r.received_on, periodStart: r.period_start,
      periodEnd: r.period_end, recordedByEmail: r.recorded_by_email, createdAt: r.created_at,
      voidedAt: r.voided_at, voidReason: r.void_reason,
    }));
  }

  async mySummary(): Promise<MemberDuesSummary | null> {
    const { data, error } = await this.client.rpc('my_dues_summary');
    if (error) throw new Error(error.message);
    return data?.[0] ? toSummary(data[0]) : null;
  }

  async myLedger() {
    const { data, error } = await this.client.rpc('my_dues_ledger');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async recordPayment(input: { memberId: string; level: string; method: DuesMethodFs; receivedOn: string; checkNumber?: string }) {
    const { error } = await this.client.rpc('record_dues_payment', {
      p_member_id: input.memberId, p_level: input.level, p_method: input.method,
      p_received_on: input.receivedOn, p_check_number: input.checkNumber ?? undefined,
    });
    if (error) throw error;
  }

  async voidPeriod(periodId: string, reason: string) {
    const { error } = await this.client.rpc('void_dues_period', { p_period_id: periodId, p_reason: reason });
    if (error) throw error;
  }

  async setAcceptedOn(memberId: string, acceptedOn: string) {
    const { error } = await this.client.rpc('set_member_accepted_on', { p_member_id: memberId, p_accepted_on: acceptedOn });
    if (error) throw error;
  }

  async setLevel(memberId: string, level: string) {
    const { error } = await this.client.rpc('set_member_dues_level', { p_member_id: memberId, p_level: level });
    if (error) throw error;
  }

  async setStudent(memberId: string, isStudent: boolean) {
    const { error } = await this.client.rpc('set_member_student', { p_member_id: memberId, p_is_student: isStudent });
    if (error) throw error;
  }

  async applyOpeningBalances(rows: { membership_number: string; paid_through: string; dues_level?: string }[]) {
    const { data, error } = await this.client.rpc('dues_opening_balances_apply', { p_rows: rows });
    if (error) throw error;
    return data as { applied: number; skipped: { membership_number: string; reason: string }[] };
  }
}
```

The RPCs run **as the signed-in officer**: use `getSupabaseServerClient()`, never the admin client, so that `kit.has_permission` sees the caller. That's the same reasoning as the members list page.

- [ ] **Step 5: Implement the actions**

`packages/features/dues/src/server/dues-actions.ts`. Each action:
1. parses with its schema;
2. calls the service with `getSupabaseServerClient()`;
3. maps a Postgres error to a readable message (`42501` → "You do not have permission to manage dues.", `P0001` → the exception message, `23P01` → "That would overlap an existing dues period.", `23514` → "A check number is required.");
4. calls `revalidatePath('/home/members')` and `revalidatePath('/home/members/[id]', 'page')`;
5. returns a `DuesActionResult`. It never throws; see the comment in `payments/server-actions.ts` on why production server actions must return errors rather than throw them.

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { AcceptedOnSchema, LevelSchema, RecordPaymentSchema, StudentSchema, VoidPeriodSchema } from '../schemas';
import { DuesService } from './dues.service';

export type DuesActionResult = { success: true } | { success: false; error: string };

function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string };
  switch (e?.code) {
    case '42501': return 'You do not have permission to manage dues.';
    case '23P01': return 'That would overlap an existing dues period.';
    case '23514': return 'A check number is required.';
    case 'P0001': return e.message ?? 'The dues change was refused.';
    default: return 'Something went wrong saving the dues change.';
  }
}

async function run(fn: (service: DuesService) => Promise<void>): Promise<DuesActionResult> {
  try {
    await fn(new DuesService(getSupabaseServerClient()));
    revalidatePath('/home/members');
    revalidatePath('/home/members/[id]', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

export const recordDuesPaymentAction = enhanceAction(
  async (data: unknown) => {
    const parsed = RecordPaymentSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' } as DuesActionResult;
    return run((s) => s.recordPayment(parsed.data));
  },
  {},
);

export const voidDuesPeriodAction = enhanceAction(
  async (data: unknown) => {
    const parsed = VoidPeriodSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' } as DuesActionResult;
    return run((s) => s.voidPeriod(parsed.data.periodId, parsed.data.reason));
  },
  {},
);

export const setAcceptedOnAction = enhanceAction(
  async (data: unknown) => {
    const parsed = AcceptedOnSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Enter a valid date' } as DuesActionResult;
    return run((s) => s.setAcceptedOn(parsed.data.memberId, parsed.data.acceptedOn));
  },
  {},
);

export const setDuesLevelAction = enhanceAction(
  async (data: unknown) => {
    const parsed = LevelSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Choose a dues level' } as DuesActionResult;
    return run((s) => s.setLevel(parsed.data.memberId, parsed.data.level));
  },
  {},
);

export const setStudentAction = enhanceAction(
  async (data: unknown) => {
    const parsed = StudentSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Invalid input' } as DuesActionResult;
    return run((s) => s.setStudent(parsed.data.memberId, parsed.data.isStudent));
  },
  {},
);
```

Confirm the `enhanceAction` import path and signature against `packages/features/members/src/server/members-actions.ts` before relying on it.

- [ ] **Step 6: The status badge, test first**

`src/components/dues-status-badge.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DuesStatusBadge } from './dues-status-badge';

describe('DuesStatusBadge', () => {
  it.each([
    ['current', 'Current'], ['due_soon', 'Due soon'], ['due', 'Due'],
    ['lapsed', 'Lapsed'], ['no_record', 'No record'],
  ] as const)('labels %s as %s', (status, label) => {
    const html = renderToStaticMarkup(<DuesStatusBadge status={status} />);
    expect(html).toContain(label);
    expect(html).toContain(`data-status="${status}"`);
  });
});
```

Run it and confirm it FAILS. Then implement `dues-status-badge.tsx` with `Badge` from `@kit/ui/badge`:
- current: default variant
- due_soon: secondary
- due and lapsed: destructive
- no_record: outline

Put `data-status` on the element. Run it again. Expected: PASS. If JSX doesn't transform under Vitest, copy `apps/site/vitest.config.ts`'s `oxc: { jsx: { runtime: 'automatic' } }`.

- [ ] **Step 7: Verify and commit**

```bash
pnpm install && pnpm typecheck && pnpm lint && pnpm --filter @kit/dues test:unit
git add packages/features/dues apps/portal/package.json apps/portal/next.config.mjs pnpm-lock.yaml
git commit -m "feat(dues): add the @kit/dues package with schemas, service and actions"
```

---

### Task 5: Member detail page with the dues card

**Files:**
- Create: `apps/portal/app/home/members/[id]/page.tsx`, `packages/features/dues/src/components/member-dues-card.tsx`, `packages/features/dues/src/components/record-payment-form.tsx`, `packages/features/dues/src/components/void-period-button.tsx`
- Modify: `packages/features/members/src/components/members-list.tsx` (the member's name links to `/home/members/<id>`)

**Interfaces:**
- Consumes: `DuesService`, the actions, `DuesStatusBadge` (Task 4), and `MembersService`. Add a `getMember(id)` method to `MembersService` that calls `members_list` with no filters, or reads `members` directly with RLS. `members_select_own` allows `members.view` holders to read every row.
- Produces: the route `/home/members/[id]`. The Task 9 e2e test relies on these `data-test` hooks:
  - `dues-card`, `dues-status`, `dues-paid-through`, `record-payment-open`
  - `record-payment-level`, `record-payment-method`, `record-payment-check-number`, `record-payment-received-on`, `record-payment-submit`
  - `set-accepted-on-input`, `set-accepted-on-submit`
  - `ledger-row`, `void-period`

- [ ] **Step 1: Page**

`apps/portal/app/home/members/[id]/page.tsx` follows `apps/portal/app/home/members/page.tsx`:
- `export const instant = false`;
- `await requirePermission('members', 'view')`;
- read the member;
- `notFound()` if the member is missing.

Then, if `hasPermission(perms, 'finance', 'view')`, load `DuesService.summaries([id])`, `ledger(id)` and `levels()` with `getSupabaseServerClient()`, and render `<MemberDuesCard summary ledger levels canManage={hasPermission(perms,'finance','manage')} memberId={id} />`. Without `finance.view`, render the member's roster details only; the dues card is absent.

- [ ] **Step 2: `MemberDuesCard`** (client component; uses `@kit/ui/card`, `@kit/ui/table`, `@kit/ui/button`, `@kit/ui/select`, `@kit/ui/input`, `@kit/ui/dialog`, `sonner` for toasts)

- **Header:** `DuesStatusBadge` (`data-test="dues-status"`), then "Paid through {paidThrough ?? '—'}" (`data-test="dues-paid-through"`), the level name and its price (formatted `$58.00`), and "Accepted on".
- **When `canManage`:**
  - An "Accepted on" date input with a Save button, shown only when the ledger has no active rows. It calls `setAcceptedOnAction`.
  - A level `Select` of all levels. On change, confirm with "Change {name}'s dues level to {level}?", then call `setDuesLevelAction`.
  - A "Student" switch that calls `setStudentAction`.
  - A "Record payment" button that opens `RecordPaymentForm` in a dialog.
- **Ledger table:** received on, level, method (with the check number), amount, the covered period, and recorded by.
  - Voided rows are struck through, with the void reason.
  - Each active row gets a `VoidPeriodButton` when `canManage`.

- [ ] **Step 3: `RecordPaymentForm`** (react-hook-form + `RecordPaymentSchema`)
- **Fields:**
  - a level `Select`, preset to the member's level; each option reads "{name} — ${amount}";
  - a method `Select` (check, cash, waived);
  - the check number, shown only for checks;
  - date received (defaults to today, in the browser's local date as `YYYY-MM-DD`).
- **No amount input.**
- **Read-only line above Save:**
  - with a paid-through date: "Covers {start} → {start+365}", where start = `paidThrough`;
  - with none: "Covers {acceptedOn} → …";
  - with neither: "Set the acceptance date first", and Save is disabled.
- **On submit:** call `recordDuesPaymentAction`. Show `result.error` in the form, or toast "Payment recorded" and close.

- [ ] **Step 4: `VoidPeriodButton`**: a dialog with a required reason field, calling `voidDuesPeriodAction`.

- [ ] **Step 5: Link names on the Members list** to `/home/members/<id>` (`next/link`). Keep the existing `data-test` attributes intact, and update `members-list.test.tsx` if it snapshots the name cell.

- [ ] **Step 6: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @kit/dues test:unit && pnpm --filter @kit/members test:unit
```

Then run it by hand. Start the site and portal in dev (`pnpm dev`, sandbox disabled) against local Supabase, as an administrator:
1. open a member;
2. set an acceptance date;
3. record a check;
4. see status "Current" and the ledger row;
5. void it with a reason;
6. see status "Due".

Put a screenshot or the observed values in your report.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/app/home/members packages/features/dues packages/features/members
git commit -m "feat(dues): member page with the FS dues card"
```

---

### Task 6: Paid-through CSV load

**Files:**
- Create: `packages/features/dues/src/csv/paid-through-csv.ts`, `packages/features/dues/src/csv/paid-through-csv.test.ts`, `packages/features/dues/src/components/paid-through-import.tsx`, `packages/features/dues/src/server/paid-through-actions.ts`, `apps/portal/app/home/members/dues-import/page.tsx`
- Modify: `apps/portal/app/home/members/page.tsx`. Add a "Load paid-through dates" button beside "Import roster", visible with `finance.manage`.

**Interfaces:**
- Produces:
  - `parsePaidThroughCsv(text: string, today: string): { rows: PaidThroughRow[]; issues: CsvIssue[] }`, where:
    - `PaidThroughRow = { line: number; membershipNumber: string; paidThrough: string; duesLevel?: string }`
    - `CsvIssue = { line: number; membershipNumber?: string; kind: 'missing_column'|'bad_date'|'duplicate'|'suspicious_date'|'blank'; message: string }`
  - `previewPaidThroughAction(text)` returns `{ rows, issues, unknownNumbers: string[], alreadyRecorded: string[] }`
  - `applyPaidThroughAction(rows)` returns `{ applied, skipped }`

- [ ] **Step 1: Failing parser tests (Review Focus 4)**

`paid-through-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parsePaidThroughCsv } from './paid-through-csv';

const TODAY = '2026-09-28';

describe('parsePaidThroughCsv', () => {
  it('reads ISO and US dates, strips a BOM, ignores blank lines', () => {
    const csv = '﻿membership_number,paid_through,dues_level\n1001,2027-03-01,student\n\n1002,3/1/2027,\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, membershipNumber: '1001', paidThrough: '2027-03-01', duesLevel: 'student' },
      { line: 4, membershipNumber: '1002', paidThrough: '2027-03-01' },
    ]);
  });

  it('flags a missing required column', () => {
    const { issues } = parsePaidThroughCsv('membership_number\n1001\n', TODAY);
    expect(issues[0]?.kind).toBe('missing_column');
  });

  it('flags impossible dates and keeps them out of rows', () => {
    const { rows, issues } = parsePaidThroughCsv('membership_number,paid_through\n1001,2027-02-30\n', TODAY);
    expect(rows).toEqual([]);
    expect(issues[0]).toMatchObject({ line: 2, kind: 'bad_date' });
  });

  it('flags duplicates and keeps only the first', () => {
    const { rows, issues } = parsePaidThroughCsv('membership_number,paid_through\n1001,2027-01-01\n1001,2027-06-01\n', TODAY);
    expect(rows).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, kind: 'duplicate' });
  });

  it('flags suspicious dates (>2y ahead, >5y back) but keeps them for review', () => {
    const { rows, issues } = parsePaidThroughCsv('membership_number,paid_through\n1001,2030-01-01\n1002,2019-01-01\n', TODAY);
    expect(rows).toHaveLength(2);
    expect(issues.map((i) => i.kind)).toEqual(['suspicious_date', 'suspicious_date']);
  });
});
```

Run it and confirm it FAILS.

- [ ] **Step 2: Implement the parser**

Use a small hand-written CSV splitter. It must handle quoted fields, doubled quotes and CRLF, which the roster import found were real in exports; read `packages/features/members/src/server/roster-reader.ts` for the lessons. Headers match case-insensitively after trimming. Dates may be `YYYY-MM-DD` or `M/D/YYYY`; normalise to ISO and validate with `IsoDate` from `../schemas`. A suspicious date (`paidThrough > today + 730` or `< today - 1826`) produces an issue but stays in `rows`. Run the tests again. Expected: PASS.

- [ ] **Step 3: Actions**

`paid-through-actions.ts`: `'use server'`, `enhanceAction`.

- **Preview:**
  1. Parse the CSV.
  2. As the officer, look up which membership numbers exist and which already have active periods. Use `member_dues_summary` on the member ids found by `membership_number`; `paidThrough != null` means already recorded.
  3. Return everything. Nothing is written.
- **Apply:**
  1. Re-validate the rows with Zod.
  2. Call `DuesService.applyOpeningBalances` with snake_case rows.
  3. Return `{ applied, skipped }`.

Map Postgres errors the same way as in Task 4.

- [ ] **Step 4: Page and component**

`/home/members/dues-import`: `requirePermission('finance','manage')`. `PaidThroughImport` follows the roster import's preview-then-apply flow (read `roster-import-form.tsx` and `roster-import-preview.tsx`):
1. A file input reads the text.
2. Preview shows a table of the rows to load, with sections for problems, unknown numbers, already-recorded members (these will be skipped), and suspicious dates (highlighted).
3. The Apply button shows "Load {n} paid-through dates".
4. The outcome shows the applied count and the skipped list.

`data-test` hooks: `paid-through-file`, `paid-through-preview`, `paid-through-apply`, `paid-through-outcome`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @kit/dues test:unit
git add packages/features/dues apps/portal/app/home/members
git commit -m "feat(dues): one-off paid-through CSV load"
```

---

### Task 7: Checkout priced from the dues level

**Files:**
- Modify:
  - `packages/features/payments/src/schemas/create-payment.schema.ts`
  - `packages/features/payments/src/server/server-actions.ts` (`createPaymentAction`)
  - `packages/features/payments/src/components/checkout-form.tsx`
  - `apps/portal/app/home/checkout/page.tsx`
  - `packages/features/payments/package.json` (add `@kit/dues`)
- Test: `packages/features/payments/src/schemas/create-payment.schema.test.ts` (create; add a vitest config and `test:unit` script to the payments package if it has none, copying `@kit/dues`')

**Interfaces:**
- Consumes: `DuesService.levels()` and `mySummary()` (Task 4), and the Task 3 trigger. The trigger reads `metadata.dues_level`.
- Produces:
  - `CreatePaymentSchema` becomes a discriminated union on `payment_type`:
    - `{ payment_type: 'dues'; level: string; description?; metadata? }`, with no amount;
    - `{ payment_type: 'donation' | 'event_fee'; amount: int > 0; currency; description?; metadata?; items? }`.
  - A `dues` payment row is created with `amount = dues_levels.amount_cents` and `metadata.dues_level = level`.

- [ ] **Step 1: Failing schema tests**

```ts
import { describe, expect, it } from 'vitest';

import { CreatePaymentSchema } from './create-payment.schema';

describe('CreatePaymentSchema', () => {
  it('dues need a level and drop any amount', () => {
    const parsed = CreatePaymentSchema.parse({ payment_type: 'dues', level: 'regular', amount: 1, currency: 'usd' });
    expect(parsed).toMatchObject({ payment_type: 'dues', level: 'regular' });
    expect('amount' in parsed).toBe(false);
    expect(CreatePaymentSchema.safeParse({ payment_type: 'dues' }).success).toBe(false);
  });

  it('donations need a positive amount', () => {
    expect(CreatePaymentSchema.safeParse({ payment_type: 'donation', amount: 2500, currency: 'usd' }).success).toBe(true);
    expect(CreatePaymentSchema.safeParse({ payment_type: 'donation', amount: 0, currency: 'usd' }).success).toBe(false);
  });
});
```

Run it and confirm it FAILS.

- [ ] **Step 2: The schema**

```ts
import * as z from 'zod';

const common = {
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const DuesPaymentSchema = z.object({
  payment_type: z.literal('dues'),
  level: z.string().min(1),
  ...common,
}).strip();

export const OpenPaymentSchema = z.object({
  payment_type: z.enum(['donation', 'event_fee']),
  amount: z.number().int().positive(),
  currency: z.string(),
  items: z.array(z.object({
    item_type: z.string().min(1),
    description: z.string().min(1),
    amount: z.number().int().positive(),
  })).optional(),
  ...common,
});

export const CreatePaymentSchema = z.discriminatedUnion('payment_type', [DuesPaymentSchema, OpenPaymentSchema]);

export type CreatePaymentFormValues = z.infer<typeof CreatePaymentSchema>;
```

Run the tests again. Expected: PASS. Fix every type error this causes: `CreatePaymentParams` in `payment.types.ts` and the provider calls. Providers must receive the resolved `amount` and `currency`.

- [ ] **Step 3: Server-side pricing in `createPaymentAction`**

After the permission check and `CreatePaymentSchema.parse(data)`, when `parsed.payment_type === 'dues'`:

```ts
    // Dues are priced here, never by the client: the level decides the amount.
    const dues = new DuesService(getSupabaseServerClient());
    const [levels, mine] = await Promise.all([dues.levels(), dues.mySummary()]);
    if (!mine) {
      throw new Error('Your sign-in is not linked to a council member record yet. Please contact the Financial Secretary to pay dues.');
    }
    const level = levels.find((l) => l.slug === parsed.level);
    const allowed =
      level &&
      (level.selfService || (level.slug === 'student' && mine.isStudent) || level.slug === mine.duesLevel);
    if (!level || !allowed) {
      throw new Error('That dues level is not available for your membership.');
    }
    const payment = { payment_type: 'dues' as const, amount: level.amountCents, currency: 'usd',
      description: `Annual dues — ${level.name}`, metadata: { ...(parsed.metadata ?? {}), dues_level: level.slug } };
```

Use `payment` in place of `parsed` for the provider call and `paymentService.createPayment`. Donations and event fees keep using `parsed` as today.

Keep the existing throw-not-return convention of this action; see its comment. Import `getSupabaseServerClient` from `@kit/supabase/server-client`, since `mySummary` needs the member's own session.

- [ ] **Step 4: The checkout form and page**

`checkout/page.tsx`: load `dues.levels()` and `dues.mySummary()` with `getSupabaseServerClient()` after `requirePermission('checkout','view')`, and pass them to `CheckoutForm` as `duesLevels` and `myDues`.

`checkout-form.tsx`:
- **Dues:** when `payment_type === 'dues'`, render a level `Select` instead of the amount input. The options are:
  - `self_service` levels;
  - plus `student` when `myDues.isStudent`;
  - plus the member's own level when it isn't self-service.
  - Each option reads "{name} — ${amount}". The default is the member's level if offered, else the first option.
  - If `myDues` is null, show the not-linked message, and the dues submit is disabled.
- **Donations and event fees:** keep the amount input as today.
- **Submit:** dues send `{ payment_type: 'dues', level }`; the others send `{ payment_type, amount: cents, currency, description }`.
- **Hooks:** `data-test="checkout-dues-level"` on the Select, `data-test="checkout-amount"` on the amount input.

- [ ] **Step 5: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @kit/payments test:unit
```

Then by hand in dev with Stripe test mode, if configured locally; otherwise leave it to Task 9:
- the dues dropdown shows the prices;
- the amount field appears only for donations;
- a forged POST with `{payment_type:'dues', level:'regular', amount:1}` is priced at $50.

- [ ] **Step 6: Commit**

```bash
git add packages/features/payments apps/portal/app/home/checkout pnpm-lock.yaml
git commit -m "feat(payments): price dues from the member's level at checkout"
```

---

### Task 8: Dues on the Members list, and the member's own dues

**Files:**
- Modify: `packages/features/members/src/components/members-list.tsx` (+ its test), `apps/portal/app/home/members/page.tsx`, `apps/portal/app/home/payments/page.tsx`
- Create: `packages/features/dues/src/components/my-dues-card.tsx`

**Interfaces:**
- Consumes: `DuesService.summaries`, `mySummary` and `myLedger`, and `DuesStatusBadge`.
- Produces:
  - `MembersList` gains an optional prop `dues?: Map<string, MemberDuesSummary>`. When present it renders three columns: Level, Paid through and Status (`data-test="member-dues-status"`).
  - A `?dues=<status>` filter, applied to the current page's rows. Label the filter "on this page" so its limit is clear.
  - `<MyDuesCard summary ledger />` with `data-test="my-dues"`.

- [ ] **Step 1: Failing component test.** In `members-list.test.tsx`, add two cases:
  - without `dues`, no "Paid through" header renders;
  - with `dues` for one member, the status badge renders for that row.

  Run it and confirm it FAILS.

- [ ] **Step 2: Implement the columns and filter.** `members/page.tsx`:
  - computes `canSeeDues = hasPermission(perms,'finance','view')`;
  - when true, fetches `summaries(rows.map(r => r.id))` and passes `dues`;
  - adds the status filter to the existing filter bar only when `canSeeDues`.

  Run the tests again. Expected: PASS.

- [ ] **Step 3: The member's own dues.** In `/home/payments`, above the history table, render `MyDuesCard` for the signed-in member when `mySummary()` returns a row. It shows:
  - "Paid through {date}", or "No dues recorded yet";
  - the level;
  - the ledger (period, method, amount);
  - a "Pay dues" button linking to `/home/checkout` when the status is `due`, `lapsed` or `due_soon`.

  Users without a member row see nothing new.

- [ ] **Step 4: Verify and commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @kit/members test:unit && pnpm --filter @kit/dues test:unit
git add packages/features/members packages/features/dues apps/portal/app/home
git commit -m "feat(dues): show dues on the members list and the member's own page"
```

---

### Task 9: End-to-end tests

**Files:**
- Create: `apps/e2e/tests/dues/dues.spec.ts`, `apps/e2e/tests/dues/dues.po.ts`

**Interfaces:**
- Consumes: the Task 5–8 `data-test` hooks. Reuse the helpers in `apps/e2e/tests/authentication/auth.po.ts` (sign-up and sign-in via Mailpit) and `apps/e2e/tests/rbac/rbac.po.ts` (promoting to administrator); read both first.

- [ ] **Step 1: Write the specs**

1. **The FS records a check.**
   1. An administrator opens a roster member created by the test. Seed a member through the roster import page with a one-row CSV fixture, as `members.spec.ts` does.
   2. Sets accepted-on to today.
   3. The status shows `Due`.
   4. Records a check #1042 at Regular ($50).
   5. The status shows `Current`, paid-through shows today + 365 days, and one `ledger-row` exists.
2. **Voiding.** Void that row with the reason "e2e". The status is `Due` again.
3. **No finance access.** A plain member (the default role) with `members.view` granted through a test role, but no `finance`, opens `/home/members`. There is no `member-dues-status` column, and `/home/members/<id>` has no `dues-card`.
4. **Online dues (runs only when Stripe test keys exist).** Gate it with `test.skip(!process.env.E2E_STRIPE, ...)`. A linked member pays dues through checkout with card 4242, and `/home/payments` shows `my-dues` "Paid through".

- [ ] **Step 2: Run them against the stack**

Sandbox disabled:

```bash
pnpm supabase:web:start && pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/dues
pnpm stack:down
```

Expected: specs 1–3 pass, and spec 4 passes or is skipped (say which). Then run the full e2e suite once. The only failures allowed are the four pre-existing ones listed in `docs/runbook/hosting.md`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/dues
git commit -m "test(e2e): cover recording, voiding and viewing dues"
```
