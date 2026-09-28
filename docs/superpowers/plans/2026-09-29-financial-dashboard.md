# Financial Dashboard and Hosting Costs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Financial Secretary enter hosting bills and see a finance dashboard on `/home`. The dashboard shows dues collected, dues outstanding, the collection rate, hosting cost so far and projected, four charts, a follow-up list and payments that need checking. Members without `finance.view` see a simple member home instead.

**Architecture:** Two additive Postgres migrations hold every calculation:
- `hosting_costs` plus its write and read functions;
- the dashboard functions, where each `kit.*_at(p_today)` core is wrapped by a `public.*` function gated on `finance.view`.

A new `@kit/finance` package (types, pure helpers, zod schemas, `FinanceService`, server actions, components) follows the `@kit/dues` pattern. The portal gets a rewritten `/home`, a new `/home/hosting-costs` page, and a sidebar item.

**Tech Stack:**
- Supabase Postgres 17: pgTAP via `supabase test db`, `security definer` functions, `kit.has_permission`.
- Next.js 16 App Router, with server actions via `enhanceAction`.
- zod, react-hook-form, `@kit/ui` (shadcn, including `@kit/ui/chart` over Recharts), Vitest and Playwright.
- pnpm 11 workspaces with catalogs.

**Spec:** `docs/superpowers/specs/2026-09-28-financial-dashboard-design.md`

## Global Constraints

- **Local database:**
  - Never run `supabase db reset`. It wipes the user's local data.
  - Apply migrations with `pnpm exec supabase migration up`, run from `apps/portal`.
  - Run database tests with `pnpm exec supabase test db`, also from `apps/portal`.
  - docker, supabase and stack commands need the sandbox disabled.
- **pgTAP tests:**
  - Include the fixtures with `\ir helpers/dues_fixtures.inc`. It provides `tests.make_user(email, role_slug)`, `tests.make_member(number, user)`, `tests.act_as(uid)` and `tests.act_as_service()`.
  - Each test runs inside `begin; … rollback;`.
- **Regenerating types:**
  1. Run `pnpm exec supabase gen types typescript --local --schema public` and write the output to BOTH `apps/portal/lib/database.types.ts` and `packages/supabase/src/database.types.ts`.
  2. Re-add the `__InternalSupabase` block.
  3. Re-apply every block marked `HAND-CORRECTED` verbatim.
  4. Keep both files byte-identical.

  The diff must contain only the task's additions.
- **Data conventions:**
  - Money is integer cents in USD.
  - "Today" is the America/Chicago date: `kit.council_today()` in SQL, `chicagoToday()` from `@kit/dues/schemas` in TypeScript.
  - Fraternal year `Y` is `[Y-07-01, (Y+1)-07-01)`.
  - Every stored `period_end` is **exclusive**.
- **Permissions:**
  - Reads need `finance.view`; the check raises `42501` with the message `forbidden`.
  - Writes need `finance.manage`, via `kit.assert_finance_manage()`, and raise the same error.
  - Validation errors raise `P0001` with a readable message.
- **Functions and privileges:**
  - Every new function is `security definer set search_path = ''`.
  - `kit.*` helpers: `revoke all … from public, anon, authenticated`, except `kit.council_today()` and `kit.fraternal_year_of(date)`, which are granted to `authenticated`.
  - `public.*` functions: `revoke all … from public, anon;` then `grant execute … to authenticated`.
  - Tables: `revoke all … from anon, authenticated`. Only `hosting_providers` gets `select` back for `authenticated`.
- **Server actions** return `{ success: true } | { success: false; error: string }` and never throw expected failures. This matches `packages/features/dues/src/server/dues-actions.ts`.
- **Deploy tolerance:** pages that read finance data wrap the reads in `readDuesIfDeployed` from `@kit/dues/lib/dues-schema`. A missing schema must never crash a page.
- **Dependencies:** no new external dependencies. Charts use `@kit/ui/chart`.
- **Formatting:** `pnpm exec oxfmt --check` already fails on 24 files. Add none.
- **Files to leave alone:** `.mcp.json`, `.claude/` and `apps/portal/supabase/snippets/` stay untouched and unstaged.

## Review Focus

1. **Dollar entry:** the Financial Secretary types amounts like `$1,200.50`, `25`, `25.5` or `0.10`. These must become exact cents (120050, 2500, 2550, 10). `1e3`, `-5`, `12.345` and `1,2,00` must be rejected. Tested in Task 3 (`money.test.ts`).
2. **Default year late on June 30:** after 7 pm Central on June 30, UTC is already July 1. The default year must still be the fraternal year that is ending. Tested in Task 3 (`fraternal-year.test.ts`, today `2027-06-30` → 2026).
3. **Bills crossing July 1:** a bill that spans July 1 appears in both years' hosting lists, and its amount splits between the years. Tested in Task 1 (list for both years) and Task 2 (split amounts).
4. **A new council with no data:** with no dues and no bills, the dashboard shows $0, a collection rate of "—" and empty-chart messages, and never crashes. Tested in Task 3 (`chart-data.test.ts`) and Task 5 (component test).
5. **Edits reach the dashboard:** after an edit, delete or repeat, the dashboard reflects the change on the next visit and is not served from cache. Tested in Task 3: the actions test asserts that `revalidatePath('/home')` and `revalidatePath('/home/hosting-costs')` both run on success.

---

### Task 1: Hosting costs schema and functions

**Files:**
- Create: `apps/portal/supabase/migrations/20260929120000_hosting_costs.sql`
- Create: `apps/portal/supabase/tests/hosting_costs.test.sql`
- Modify: `apps/portal/lib/database.types.ts`, `packages/supabase/src/database.types.ts` (regenerated)
- Modify: `docs/superpowers/specs/2026-09-28-financial-dashboard-design.md`. Amend the repeat-last and signature details to match this task; see Step 6.

**Interfaces:**
- Consumes: `kit.has_permission(section, verb)`, `kit.assert_finance_manage()`, `public.roles` (`slug`, `name`), `public.role_permissions` (`role_id`, `section`, `can_view`, `can_manage`).
- Produces:
  - `kit.council_today() returns date`
  - `kit.assert_finance_view() returns void`
  - `kit.hosting_next_period(p_start date, p_end date) returns table (period_start date, period_end date)`
  - `public.hosting_cost_upsert(p_provider text, p_amount_cents integer, p_paid_on date, p_period_start date, p_period_end date, p_note text default null, p_id uuid default null) returns public.hosting_costs`
  - `public.hosting_cost_delete(p_id uuid) returns void`
  - `public.hosting_cost_repeat_last(p_provider text) returns public.hosting_costs`
  - `public.hosting_costs_list(p_year integer) returns table (id uuid, provider text, provider_name text, amount_cents integer, paid_on date, period_start date, period_end date, note text, recorded_by_email text, updated_at timestamptz)`
  - `public.hosting_cost_latest() returns table (provider text, amount_cents integer, period_start date, period_end date)`
  - `public.hosting_cost_overlaps(p_provider text, p_period_start date, p_period_end date, p_exclude_id uuid default null) returns setof uuid`
  - tables `public.hosting_providers` and `public.hosting_costs`

- [ ] **Step 1: Write the failing pgTAP test**

`apps/portal/supabase/tests/hosting_costs.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select plan(32);

select tests.make_user('fin-admin@example.com', 'administrator') as admin \gset
select tests.make_user('fin-knight@example.com', 'member') as knight \gset
insert into public.roles (slug, name) values ('fin_viewer', 'Finance viewer') returning id as viewer_role \gset
insert into public.role_permissions (role_id, section, can_view, can_manage)
values (:'viewer_role', 'finance', true, false);
select tests.make_user('fin-viewer@example.com', 'fin_viewer') as viewer \gset
insert into public.hosting_providers (slug, name, sort_order) values ('test_none', 'Test none', 99);

-- 1-2 schema
select has_table('public', 'hosting_costs', 'hosting_costs exists');
select results_eq(
  $$select slug from public.hosting_providers where slug <> 'test_none' order by sort_order$$,
  $$values ('supabase'), ('cloudflare'), ('google_cloud'), ('domain'), ('other')$$,
  'providers are seeded in order');

-- 3-5 a member without finance
select tests.act_as(:'knight');
select throws_ok($$select public.hosting_cost_upsert('supabase', 2500, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  '42501', 'forbidden', 'member cannot add a bill');
select throws_ok($$select * from public.hosting_costs_list(2034)$$, '42501', 'forbidden', 'member cannot list bills');
select throws_ok($$select public.hosting_cost_repeat_last('supabase')$$, '42501', 'forbidden', 'member cannot repeat a bill');

-- 6-8 finance.view without manage
select tests.act_as(:'viewer');
select lives_ok($$select * from public.hosting_costs_list(2034)$$, 'viewer can list bills');
select throws_ok($$select public.hosting_cost_upsert('supabase', 2500, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  '42501', 'forbidden', 'viewer cannot add a bill');
select throws_ok($$select public.hosting_cost_delete(gen_random_uuid())$$, '42501', 'forbidden', 'viewer cannot delete a bill');

-- administrator
select tests.act_as(:'admin');
select id as bill from public.hosting_cost_upsert('supabase', 2500, '2034-10-01', '2034-10-01', '2034-11-01', '  Pro plan  ') \gset

-- 9-11 insert and update
select is((select note from public.hosting_costs_list(2034) where id = :'bill'), 'Pro plan', 'note is trimmed');
select is((select recorded_by_email from public.hosting_costs_list(2034) where id = :'bill'), 'fin-admin@example.com', 'recorder email is returned');
select is((select amount_cents from public.hosting_cost_upsert('supabase', 2600, '2034-10-01', '2034-10-01', '2034-11-01', null, :'bill')),
  2600, 'upsert with an id updates the bill');

-- 12-16 validation
select throws_ok($$select public.hosting_cost_upsert('aws', 100, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  'P0001', 'unknown hosting provider: aws', 'unknown provider is refused');
select throws_ok($$select public.hosting_cost_upsert('supabase', 100, '2034-10-01', '2034-11-01', '2034-11-01')$$,
  'P0001', 'the covered period must end after it starts', 'empty period is refused');
select throws_ok($$select public.hosting_cost_upsert('supabase', 100, '2034-10-01', '2034-10-01', '2037-10-05')$$,
  'P0001', 'a bill can cover at most 3 years', 'over-long period is refused');
select throws_ok($$select public.hosting_cost_upsert('supabase', -1, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  'P0001', 'the amount must be zero or more', 'negative amount is refused');
select throws_ok(format($$select public.hosting_cost_upsert('supabase', 100, '2034-10-01', '2034-10-01', '2034-11-01', %L)$$, repeat('x', 501)),
  'P0001', 'the note can be at most 500 characters', 'long note is refused');

-- 17-20 repeat last bill
select results_eq(
  $$select period_start, period_end, paid_on from public.hosting_cost_repeat_last('supabase')$$,
  $$values ('2034-11-01'::date, '2034-12-01'::date, kit.council_today())$$,
  'a whole-month bill repeats by calendar months, paid today');
select public.hosting_cost_upsert('domain', 1200, '2034-09-20', '2034-10-01', '2035-10-01');
select results_eq(
  $$select period_start, period_end from public.hosting_cost_repeat_last('domain')$$,
  $$values ('2035-10-01'::date, '2036-10-01'::date)$$,
  'an annual bill repeats a year later');
select public.hosting_cost_upsert('other', 3000, '2034-10-16', '2034-10-16', '2034-11-15');
select results_eq(
  $$select period_start, period_end from public.hosting_cost_repeat_last('other')$$,
  $$values ('2034-11-15'::date, '2034-12-15'::date)$$,
  'a bill that is not whole months repeats by the same number of days');
select throws_ok($$select public.hosting_cost_repeat_last('test_none')$$,
  'P0001', 'no earlier bill for this provider', 'repeat needs an earlier bill');

-- 21-22 overlaps
select ok(:'bill'::uuid in (select * from public.hosting_cost_overlaps('supabase', '2034-10-15', '2034-10-20')),
  'an overlapping bill is reported');
select is((select count(*)::int from public.hosting_cost_overlaps('supabase', '2034-10-15', '2034-10-20', :'bill')),
  0, 'the bill being edited is excluded');

-- 23-26 listing by fraternal year
select ok(exists (select 1 from public.hosting_costs_list(2034) where id = :'bill'), 'FY2034 lists an October 2034 bill');
select ok(not exists (select 1 from public.hosting_costs_list(2033) where id = :'bill'), 'FY2033 does not');
select id as cf from public.hosting_cost_upsert('cloudflare', 1200, '2034-12-20', '2035-01-01', '2036-01-01') \gset
select ok(exists (select 1 from public.hosting_costs_list(2034) where id = :'cf'), 'a bill crossing July 1 is listed in the first year');
select ok(exists (select 1 from public.hosting_costs_list(2035) where id = :'cf'), 'and in the second year');

-- 27-29 latest and delete
select is((select period_end from public.hosting_cost_latest() where provider = 'supabase'), '2034-12-01'::date,
  'latest returns the bill with the latest end');
select lives_ok(format($$select public.hosting_cost_delete(%L)$$, :'bill'), 'admin can delete a bill');
select throws_ok(format($$select public.hosting_cost_delete(%L)$$, :'bill'), 'P0001', 'hosting cost not found', 'a deleted bill is gone');

-- 30-32 privileges
select tests.act_as_service();
select is(has_table_privilege('authenticated', 'public.hosting_costs', 'select'), false, 'no direct select on hosting_costs');
select is(has_table_privilege('authenticated', 'public.hosting_costs', 'truncate'), false, 'no truncate on hosting_costs');
select is(has_table_privilege('authenticated', 'public.hosting_providers', 'select'), true, 'providers are readable');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run (from `apps/portal`, with the sandbox disabled): `pnpm exec supabase test db`

Expected: `hosting_costs.test.sql` FAILS with `relation "public.hosting_costs" does not exist` or `function … does not exist`. The existing 159 tests still pass.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20260929120000_hosting_costs.sql`:

```sql
-- Hosting costs: bills entered by hand by the Financial Secretary, one row per
-- bill with the period it covers ([period_start, period_end), end exclusive).
-- No direct table access; every read and write goes through the functions below.

create or replace function kit.council_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Chicago')::date;
$$;
revoke all on function kit.council_today() from public, anon;
grant execute on function kit.council_today() to authenticated;

create or replace function kit.assert_finance_view()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('finance', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function kit.assert_finance_view() from public, anon, authenticated;

create table public.hosting_providers (
  slug       text primary key,
  name       text not null,
  sort_order integer not null,
  active     boolean not null default true
);

insert into public.hosting_providers (slug, name, sort_order) values
  ('supabase', 'Supabase', 1),
  ('cloudflare', 'Cloudflare', 2),
  ('google_cloud', 'Google Cloud', 3),
  ('domain', 'Domain', 4),
  ('other', 'Other', 5);

alter table public.hosting_providers enable row level security;
create policy hosting_providers_select on public.hosting_providers
  for select to authenticated using (true);

create table public.hosting_costs (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null references public.hosting_providers (slug),
  amount_cents integer not null check (amount_cents >= 0),
  paid_on      date not null,
  period_start date not null,
  period_end   date not null,
  note         text check (note is null or char_length(note) <= 500),
  created_by   uuid references auth.users (id) on delete restrict,
  updated_by   uuid references auth.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hosting_costs_period check (period_end > period_start),
  constraint hosting_costs_span   check (period_end - period_start <= 1096)
);

create index hosting_costs_provider_end_idx on public.hosting_costs (provider, period_end desc);

alter table public.hosting_costs enable row level security;
-- No policies on purpose: reads and writes go through security definer functions.

revoke all on public.hosting_costs     from anon, authenticated;
revoke all on public.hosting_providers from anon, authenticated;
grant select on public.hosting_providers to authenticated;

create or replace function kit.hosting_costs_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function kit.hosting_costs_touch() from public, anon, authenticated;

create trigger hosting_costs_touch
  before update on public.hosting_costs
  for each row execute function kit.hosting_costs_touch();

create or replace function kit.hosting_cost_validate(
  p_provider text, p_amount_cents integer, p_paid_on date,
  p_period_start date, p_period_end date, p_note text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_provider is null
     or not exists (select 1 from public.hosting_providers where slug = p_provider and active) then
    raise exception 'unknown hosting provider: %', coalesce(p_provider, '(none)');
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'the amount must be zero or more';
  end if;
  if p_paid_on is null or p_period_start is null or p_period_end is null then
    raise exception 'the paid date and the covered dates are required';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'the covered period must end after it starts';
  end if;
  if p_period_end - p_period_start > 1096 then
    raise exception 'a bill can cover at most 3 years';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'the note can be at most 500 characters';
  end if;
end $$;
revoke all on function kit.hosting_cost_validate(text, integer, date, date, date, text) from public, anon, authenticated;

-- The period after [p_start, p_end). A bill whose start and end fall on the same
-- day of the month (Oct 1 -> Nov 1, Oct 1 -> Oct 1 next year) repeats by whole
-- calendar months; anything else repeats by the same number of days.
create or replace function kit.hosting_next_period(p_start date, p_end date)
returns table (period_start date, period_end date)
language plpgsql immutable set search_path = '' as $$
declare
  v_months integer;
begin
  if extract(day from p_start) = extract(day from p_end) then
    v_months := (extract(year from p_end)::integer * 12 + extract(month from p_end)::integer)
              - (extract(year from p_start)::integer * 12 + extract(month from p_start)::integer);
    return query select p_end, (p_end + make_interval(months => v_months))::date;
  else
    return query select p_end, p_end + (p_end - p_start);
  end if;
end $$;
revoke all on function kit.hosting_next_period(date, date) from public, anon, authenticated;

create or replace function public.hosting_cost_upsert(
  p_provider text, p_amount_cents integer, p_paid_on date,
  p_period_start date, p_period_end date,
  p_note text default null, p_id uuid default null)
returns public.hosting_costs
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_row  public.hosting_costs;
begin
  perform kit.assert_finance_manage();
  perform kit.hosting_cost_validate(p_provider, p_amount_cents, p_paid_on, p_period_start, p_period_end, v_note);

  if p_id is null then
    insert into public.hosting_costs
      (provider, amount_cents, paid_on, period_start, period_end, note, created_by, updated_by)
    values
      (p_provider, p_amount_cents, p_paid_on, p_period_start, p_period_end, v_note, auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.hosting_costs
       set provider = p_provider, amount_cents = p_amount_cents, paid_on = p_paid_on,
           period_start = p_period_start, period_end = p_period_end, note = v_note,
           updated_by = auth.uid()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'hosting cost not found';
    end if;
  end if;

  return v_row;
end $$;

create or replace function public.hosting_cost_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  delete from public.hosting_costs where id = p_id;
  if not found then
    raise exception 'hosting cost not found';
  end if;
end $$;

create or replace function public.hosting_cost_repeat_last(p_provider text)
returns public.hosting_costs
language plpgsql security definer set search_path = '' as $$
declare
  v_last public.hosting_costs;
  v_next record;
  v_row  public.hosting_costs;
begin
  perform kit.assert_finance_manage();

  select * into v_last from public.hosting_costs
   where provider = p_provider
   order by period_end desc, created_at desc
   limit 1;
  if not found then
    raise exception 'no earlier bill for this provider';
  end if;

  select * into v_next from kit.hosting_next_period(v_last.period_start, v_last.period_end);

  insert into public.hosting_costs
    (provider, amount_cents, paid_on, period_start, period_end, note, created_by, updated_by)
  values
    (v_last.provider, v_last.amount_cents, kit.council_today(), v_next.period_start, v_next.period_end,
     v_last.note, auth.uid(), auth.uid())
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.hosting_costs_list(p_year integer)
returns table (
  id uuid, provider text, provider_name text, amount_cents integer, paid_on date,
  period_start date, period_end date, note text, recorded_by_email text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select c.id, c.provider, p.name, c.amount_cents, c.paid_on, c.period_start, c.period_end,
           c.note, u.email::text, c.updated_at
      from public.hosting_costs c
      join public.hosting_providers p on p.slug = c.provider
      left join auth.users u on u.id = coalesce(c.updated_by, c.created_by)
     where c.period_start < make_date(p_year + 1, 7, 1)
       and c.period_end   > make_date(p_year, 7, 1)
     order by c.period_start desc, c.paid_on desc, c.created_at desc;
end $$;

create or replace function public.hosting_cost_latest()
returns table (provider text, amount_cents integer, period_start date, period_end date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select distinct on (c.provider) c.provider, c.amount_cents, c.period_start, c.period_end
      from public.hosting_costs c
     order by c.provider, c.period_end desc, c.created_at desc;
end $$;

create or replace function public.hosting_cost_overlaps(
  p_provider text, p_period_start date, p_period_end date, p_exclude_id uuid default null)
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query
    select c.id from public.hosting_costs c
     where c.provider = p_provider
       and c.period_start < p_period_end
       and c.period_end > p_period_start
       and (p_exclude_id is null or c.id <> p_exclude_id);
end $$;

revoke all on function public.hosting_cost_upsert(text, integer, date, date, date, text, uuid) from public, anon;
revoke all on function public.hosting_cost_delete(uuid) from public, anon;
revoke all on function public.hosting_cost_repeat_last(text) from public, anon;
revoke all on function public.hosting_costs_list(integer) from public, anon;
revoke all on function public.hosting_cost_latest() from public, anon;
revoke all on function public.hosting_cost_overlaps(text, date, date, uuid) from public, anon;

grant execute on function public.hosting_cost_upsert(text, integer, date, date, date, text, uuid) to authenticated;
grant execute on function public.hosting_cost_delete(uuid) to authenticated;
grant execute on function public.hosting_cost_repeat_last(text) to authenticated;
grant execute on function public.hosting_costs_list(integer) to authenticated;
grant execute on function public.hosting_cost_latest() to authenticated;
grant execute on function public.hosting_cost_overlaps(text, date, date, uuid) to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

Run (from `apps/portal`, with the sandbox disabled):
```bash
pnpm exec supabase migration up
pnpm exec supabase test db
```
Expected: `hosting_costs.test.sql` passes all 32 tests, and every earlier test still passes. If a count or message differs, fix the migration, not the test. The one exception is a test value this plan got wrong; if you change one, record the arithmetic in your report.

To re-apply an edited migration without a reset, run:
```bash
docker exec -i supabase_db_next-supabase-saas-kit-turbo-lite psql -U postgres -v ON_ERROR_STOP=1 < apps/portal/supabase/migrations/20260929120000_hosting_costs.sql
```
Every statement is `create or replace` except the `create table`, `create index`, `create policy` and `create trigger` statements. So if you need to re-apply, drop those four objects first, inside the same psql session.

- [ ] **Step 5: Regenerate types**

Follow the type-regeneration rules in Global Constraints. Then add one `HAND-CORRECTED` block, in both files, marking these fields as `string | null`:
- the `note` and `recorded_by_email` fields in `hosting_costs_list` Returns;
- `note` in the `hosting_cost_upsert` and `hosting_cost_repeat_last` Returns, if the generator left them non-null.

Use the same comment style as the existing blocks. Confirm that `p_note` and `p_id` in `hosting_cost_upsert`, and `p_exclude_id` in `hosting_cost_overlaps`, are optional (`?:`) in Args. They are optional because the SQL gives them defaults.

Run `cmp apps/portal/lib/database.types.ts packages/supabase/src/database.types.ts`. Expected: no output.

- [ ] **Step 6: Amend the spec**

In `docs/superpowers/specs/2026-09-28-financial-dashboard-design.md`, under "Write functions", replace the three bullet lines for `hosting_cost_upsert`, `hosting_cost_delete` and `hosting_cost_repeat_last` with the signatures in this task's **Produces** list. Then add this sentence to the repeat-last bullet:

"A bill whose start and end fall on the same day of the month repeats by the same number of calendar months (Oct 1 → Nov 1 becomes Nov 1 → Dec 1); any other bill repeats by the same number of days."

Under "Read functions", add a bullet for `hosting_cost_latest()`: "Each provider's bill with the latest end, used to preview Repeat last bill."

- [ ] **Step 7: Commit**

```bash
git add apps/portal/supabase/migrations/20260929120000_hosting_costs.sql \
  apps/portal/supabase/tests/hosting_costs.test.sql \
  apps/portal/lib/database.types.ts packages/supabase/src/database.types.ts \
  docs/superpowers/specs/2026-09-28-financial-dashboard-design.md
git commit -m "feat(finance): add hosting costs and their functions"
```

---

### Task 2: Dashboard functions

**Files:**
- Create: `apps/portal/supabase/migrations/20260929120100_finance_dashboard.sql`
- Create: `apps/portal/supabase/tests/finance_dashboard.test.sql`
- Modify: both `database.types.ts` files (regenerated)

**Interfaces:**
- Consumes:
  - `kit.council_today()`, `kit.assert_finance_view()` and `public.hosting_costs` (Task 1)
  - `kit.dues_paid_through(uuid)`, `kit.dues_status(date, date, date)`, `public.dues_periods`, `public.dues_levels` and `public.members` (dues model)
- Produces:
  - `kit.fraternal_year_of(p_date date) returns integer`, granted to `authenticated`
  - `kit.hosting_spread(p_from date, p_to date) returns table (provider text, cents numeric)`
  - `kit.hosting_monthly(p_year integer) returns table (month date, provider text, cents integer)`
  - `kit.hosting_projection_at(p_year integer, p_today date) returns table (provider text, cents numeric)`
  - `kit.dues_collected(p_year integer) returns bigint`
  - `kit.dues_monthly(p_year integer) returns table (month date, online_cents bigint, check_cents bigint, cash_cents bigint)`
  - `kit.member_dues_snapshot(p_today date) returns table (member_id uuid, first_name text, last_name text, membership_number text, dues_level text, level_name text, amount_cents integer, paid_through date, dues_status text)`
  - `kit.finance_dashboard_at(p_year integer, p_today date) returns jsonb`
  - `kit.finance_net_by_year_at(p_today date) returns table (year integer, dues_cents bigint, hosting_cents bigint)`
  - `kit.finance_follow_up_at(p_today date) returns table (member_id uuid, first_name text, last_name text, membership_number text, dues_status text, paid_through date, level_name text, amount_cents integer)`
  - `public.finance_dashboard(p_year integer) returns jsonb`
  - `public.finance_net_by_year() returns table (year integer, dues_cents bigint, hosting_cents bigint)`
  - `public.finance_follow_up() returns table` (same columns as `kit.finance_follow_up_at`)
  - `public.finance_payments_to_check() returns table (payment_id uuid, created_at timestamptz, member_id uuid, member_name text, dues_level text, amount_cents integer, provider text)`
- The `finance_dashboard` jsonb shape. `@kit/finance` types it by hand in Task 3:
  ```
  { year, yearStart, yearEnd, isCurrentYear, today,
    duesCollectedCents, outstandingCents,
    collection: { numerator, denominator },
    statusCounts: { current, due_soon, due, lapsed, no_record },
    hostingToDateCents, hostingProjectionCents (null unless current year),
    duesByMonth: [{ month, onlineCents, checkCents, cashCents }] (12 entries),
    hostingByMonth: [{ month, provider, cents }] }
  ```

- [ ] **Step 1: Write the failing pgTAP test**

The test pins exact figures in years 2029–2037, which the user's real data does not reach. Snapshot figures (`statusCounts`, `outstanding`, `collection`, follow-up) are measured as a change from a baseline, taken just before their fixtures are added, because the local database already has members.

Spreading arithmetic the assertions rely on (`amount × overlap days ÷ covered days`, rounded half away from zero):
- The domain bill is 1200 cents over 2034-10-01→2035-10-01 (365 days).
  - October: 1200×31/365 = 101.92 → **102**.
  - FY2034: 1200×273/365 = 897.53 → **898**.
  - FY2035: 1200×92/365 = 302.47.
- The Supabase bill is 2500 cents over 2034-10-01→2034-11-01 (31 days), so all 2500 falls in October. To 2034-10-16: 2500×16/31 = 1290.32.
- The other bill is 3000 cents over 2034-10-16→2034-11-16 (31 days).
  - October: 3000×16/31 = 1548.39 → **1548**.
  - November: 3000×15/31 = 1451.61 → **1452**.
  - To 2034-10-16: 3000×1/31 = 96.77.
- The Cloudflare bill is 1200 cents over 2035-01-01→2036-01-01 (365 days).
  - FY2034: 1200×181/365 = 595.07 → **595**.
  - FY2035: 1200×184/365 = 604.93 → **605**.
- The Google Cloud bill is 2900 cents over 2036-02-01→2036-03-01 (29 days, a leap year), so February 2036 is **2900**.
- Hosting to 2034-10-16: domain 1200×16/365 = 52.60, plus 1290.32, plus 96.77, which is 1439.70 → **1440**.
- Projection for FY2034 as of 2034-10-16:
  - Domain: 897.53, with no extra because the bill ends after the fiscal year does.
  - Supabase: 2500 + 2500/31×242 = 22016.13 → **22016**.
  - Other: 3000 + 3000/31×227 = 24967.74 → **24968**.
  - Cloudflare: 595.07.
  - Total: 48476.47 → **48476**.
- Net per year:
  - FY2034 hosting: 897.53 + 2500 + 3000 + 595.07 = 6992.60 → **6993**.
  - FY2035 hosting: 302.47 + 604.93 + 2900 = 3807.40 → **3807**.

`apps/portal/supabase/tests/finance_dashboard.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select plan(43);

select tests.make_user('fd-admin@example.com', 'administrator') as admin \gset
select tests.make_user('fd-knight@example.com', 'member') as knight \gset

-- hosting fixtures (inserted directly, as the superuser)
insert into public.hosting_costs (provider, amount_cents, paid_on, period_start, period_end) values
  ('domain',       1200, '2034-09-20', '2034-10-01', '2035-10-01'),
  ('supabase',     2500, '2034-10-01', '2034-10-01', '2034-11-01'),
  ('other',        3000, '2034-10-16', '2034-10-16', '2034-11-16'),
  ('cloudflare',   1200, '2034-12-20', '2035-01-01', '2036-01-01'),
  ('google_cloud', 2900, '2036-02-01', '2036-02-01', '2036-03-01');

-- 1-8 spreading
select is((select round(cents)::int from kit.hosting_spread('2034-10-01', '2034-11-01') where provider = 'domain'), 102, 'annual bill: October share');
select is((select round(cents)::int from kit.hosting_spread('2034-10-01', '2034-11-01') where provider = 'supabase'), 2500, 'monthly bill: whole month');
select is((select round(cents)::int from kit.hosting_spread('2034-10-01', '2034-11-01') where provider = 'other'), 1548, 'mid-month bill: October share');
select is((select cents from kit.hosting_monthly(2034) where month = '2034-11-01' and provider = 'other'), 1452, 'mid-month bill: November share');
select is((select round(cents)::int from kit.hosting_spread('2034-07-01', '2035-07-01') where provider = 'domain'), 898, 'annual bill: FY2034 total');
select is((select round(cents)::int from kit.hosting_spread('2034-07-01', '2035-07-01') where provider = 'cloudflare'), 595, 'bill crossing July 1: first year');
select is((select round(cents)::int from kit.hosting_spread('2035-07-01', '2036-07-01') where provider = 'cloudflare'), 605, 'bill crossing July 1: second year');
select is((select cents from kit.hosting_monthly(2035) where month = '2036-02-01' and provider = 'google_cloud'), 2900, 'leap-year February');

-- 9-17 hosting to date and projection
select is((kit.finance_dashboard_at(2034, '2034-10-16') ->> 'hostingToDateCents')::int, 1440, 'hosting so far counts days through today');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'domain'), 898, 'projection: bill already covers the year');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'supabase'), 22016, 'projection: monthly bill runs on at its rate');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'other'), 24968, 'projection: partial-month bill runs on at its rate');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'cloudflare'), 595, 'projection: future bill counts its share only');
select is((kit.finance_dashboard_at(2034, '2034-10-16') ->> 'hostingProjectionCents')::int, 48476, 'projection total');
select is((kit.finance_dashboard_at(2037, '2037-10-16') ->> 'hostingProjectionCents')::int, 0, 'no bill in the last 13 months: nothing projected');
select is(kit.finance_dashboard_at(2034, '2037-10-16') ->> 'hostingProjectionCents', null::text, 'past years have no projection');
select is((kit.finance_dashboard_at(2034, '2037-10-16') ->> 'hostingToDateCents')::int, 6993, 'past year: hosting so far is the whole year');

-- dues fixtures
select tests.make_member('FD-001') as d1 \gset
select tests.make_member('FD-002') as d2 \gset
select tests.make_member('FD-003') as d3 \gset
select tests.make_member('FD-004') as d4 \gset
insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end) values
  (:'d1', 'regular',         5000, 'check',  '101', '2036-06-30', '2035-06-30', '2035-06-30'::date + 365),
  (:'d2', 'regular_contrib', 5800, 'online', null,  '2036-07-01', '2036-07-01', '2036-07-01'::date + 365),
  (:'d3', 'student',         2500, 'cash',   null,  '2035-09-10', '2035-09-10', '2035-09-10'::date + 365),
  (:'d4', 'regular',         9999, 'cash',   null,  '2035-09-11', '2035-09-11', '2035-09-11'::date + 365);
update public.dues_periods set voided_at = now(), void_reason = 'test' where member_id = :'d4';

-- 18-22 dues
select is(kit.dues_collected(2035), 7500::bigint, 'FY2035: June 30 and September count, the voided row does not');
select is(kit.dues_collected(2036), 5800::bigint, 'FY2036: July 1 belongs to the new year');
select is((select cash_cents from kit.dues_monthly(2035) where month = '2035-09-01'), 2500::bigint, 'September cash');
select is((select check_cents from kit.dues_monthly(2035) where month = '2036-06-01'), 5000::bigint, 'June check');
select is((select count(*)::int from kit.dues_monthly(2035)), 12, 'twelve months, even when empty');

-- 23-25 net by year
select is((select hosting_cents from kit.finance_net_by_year_at('2037-10-16') where year = 2034), 6993::bigint, 'net: FY2034 hosting');
select results_eq(
  $$select dues_cents, hosting_cents from kit.finance_net_by_year_at('2037-10-16') where year = 2035$$,
  $$values (7500::bigint, 3807::bigint)$$, 'net: FY2035 dues and hosting');
select is((select dues_cents from kit.finance_net_by_year_at('2037-10-16') where year = 2036), 5800::bigint, 'net: FY2036 dues');

-- snapshot baseline, then fixtures (as of 2030-01-15)
select kit.finance_dashboard_at(2029, '2030-01-15') as base \gset
select tests.make_member('FS-CUR')    as s_cur \gset
select tests.make_member('FS-SOON')   as s_soon \gset
select tests.make_member('FS-SOON2')  as s_soon2 \gset
select tests.make_member('FS-DUE')    as s_due \gset
select tests.make_member('FS-LAPSED') as s_lapsed \gset
select tests.make_member('FS-HON')    as s_hon \gset
select tests.make_member('FS-NONE')   as s_none \gset
select tests.act_as(:'admin');
select public.set_member_accepted_on(:'s_due', '2029-12-01');
select public.set_member_dues_level(:'s_hon', 'honorary');
select tests.act_as_service();
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end) values
  (:'s_cur',    'regular_contrib', 0, 'waived', '2029-06-01', '2029-06-01', '2029-06-01'::date + 365),
  (:'s_soon',   'regular_contrib', 0, 'waived', '2029-02-10', '2029-02-10', '2029-02-10'::date + 365),
  (:'s_soon2',  'regular_contrib', 0, 'waived', '2029-03-30', '2029-03-30', '2029-03-30'::date + 365),
  (:'s_lapsed', 'regular_contrib', 0, 'waived', '2028-06-01', '2028-06-01', '2028-06-01'::date + 365),
  (:'s_hon',    'honorary',        0, 'waived', '2028-01-01', '2028-01-01', '2028-01-01'::date + 365);

-- 26-33 snapshot deltas
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'current')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'current')::int, 1, 'one more current');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'due_soon')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'due_soon')::int, 2, 'two more due soon');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'due')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'due')::int, 1, 'one more due');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'lapsed')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'lapsed')::int, 2, 'two more lapsed');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'no_record')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'no_record')::int, 1, 'one more with no record');
select is((kit.finance_dashboard_at(2029, '2030-01-15') ->> 'outstandingCents')::int
          - (:'base'::jsonb ->> 'outstandingCents')::int, 13500, 'outstanding: due + lapsed at level price, honorary included');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'collection' ->> 'numerator')::int
          - (:'base'::jsonb -> 'collection' ->> 'numerator')::int, 3, 'collection numerator: current + due soon');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'collection' ->> 'denominator')::int
          - (:'base'::jsonb -> 'collection' ->> 'denominator')::int, 5, 'collection denominator excludes honorary and no record');

-- 34 follow-up
select is(
  (select array_agg(f.membership_number order by f.ord)
     from kit.finance_follow_up_at('2030-01-15') with ordinality
          as f(member_id, first_name, last_name, membership_number, dues_status, paid_through, level_name, amount_cents, ord)
    where f.membership_number like 'FS-%'),
  array['FS-HON', 'FS-LAPSED', 'FS-DUE', 'FS-SOON'],
  'follow-up: lapsed by paid-through, then due, then due within 30 days');

-- payments to check
select tests.make_user('fd-payer@example.com', 'member') as payer \gset
select tests.make_member('FP-001', :'payer') as fp \gset
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata) values
  ('00000000-0000-0000-0000-0000000fd0a1', :'payer', 'stripe', 5800, 'succeeded', 'dues',     '{"dues_level":"regular_contrib"}'),
  ('00000000-0000-0000-0000-0000000fd0a2', :'payer', 'stripe', 5800, 'succeeded', 'dues',     '{"dues_level":"regular_contrib"}'),
  ('00000000-0000-0000-0000-0000000fd0a3', :'payer', 'stripe', 2500, 'succeeded', 'donation', '{}'),
  ('00000000-0000-0000-0000-0000000fd0a4', :'payer', 'stripe', 5800, 'pending',   'dues',     '{"dues_level":"regular_contrib"}');
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
values (:'fp', 'regular_contrib', 5800, 'online', '2031-01-01', '2031-01-01', '2031-01-01'::date + 365, '00000000-0000-0000-0000-0000000fd0a2');

select tests.act_as(:'admin');
-- 35-36
select is(
  (select array_agg(payment_id) from public.finance_payments_to_check()
    where payment_id::text like '00000000-0000-0000-0000-0000000fd0a%'),
  array['00000000-0000-0000-0000-0000000fd0a1'::uuid],
  'only the succeeded dues payment with no period needs checking');
select results_eq(
  $$select member_name, dues_level, amount_cents from public.finance_payments_to_check()
     where payment_id = '00000000-0000-0000-0000-0000000fd0a1'$$,
  $$values ('Test Knight FP-001'::text, 'regular_contrib'::text, 5800)$$,
  'payments to check name the member and level');

-- 37-40 refused without finance.view
select tests.act_as(:'knight');
select throws_ok($$select public.finance_dashboard(2026)$$, '42501', 'forbidden', 'member cannot read the dashboard');
select throws_ok($$select * from public.finance_follow_up()$$, '42501', 'forbidden', 'member cannot read the follow-up list');
select throws_ok($$select * from public.finance_net_by_year()$$, '42501', 'forbidden', 'member cannot read net by year');
select throws_ok($$select * from public.finance_payments_to_check()$$, '42501', 'forbidden', 'member cannot read payments to check');

-- 41-42 year validation
select tests.act_as(:'admin');
select throws_ok($$select public.finance_dashboard(1999)$$, 'P0001', 'unknown fraternal year: 1999', 'years before 2000 are refused');
select lives_ok($$select public.finance_dashboard(kit.fraternal_year_of(kit.council_today()))$$, 'the current fraternal year works');

-- 43 kit internals are not callable directly
select tests.act_as_service();
select is(has_function_privilege('authenticated', 'kit.finance_dashboard_at(integer, date)', 'execute'), false,
  'kit.finance_dashboard_at is not executable by authenticated');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run (from `apps/portal`, with the sandbox disabled): `pnpm exec supabase test db`

Expected: `finance_dashboard.test.sql` FAILS with `function kit.hosting_spread(unknown, unknown) does not exist`.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20260929120100_finance_dashboard.sql`:

```sql
-- Financial dashboard: every figure is computed here. Each kit.*_at(p_today)
-- function holds the logic with an explicit "today" so tests can pin dates;
-- the public wrappers check finance.view and pass kit.council_today().

create or replace function kit.fraternal_year_of(p_date date)
returns integer language sql immutable set search_path = '' as $$
  select extract(year from p_date)::integer
         - case when extract(month from p_date) < 7 then 1 else 0 end;
$$;
revoke all on function kit.fraternal_year_of(date) from public, anon;
grant execute on function kit.fraternal_year_of(date) to authenticated;

create or replace function kit.assert_fraternal_year(p_year integer)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_year is null or p_year < 2000
     or p_year > kit.fraternal_year_of(kit.council_today()) + 1 then
    raise exception 'unknown fraternal year: %', coalesce(p_year::text, '(none)');
  end if;
end $$;

-- Unrounded cents of every bill that falls inside [p_from, p_to), per provider.
create or replace function kit.hosting_spread(p_from date, p_to date)
returns table (provider text, cents numeric)
language sql stable security definer set search_path = '' as $$
  select c.provider,
         sum(c.amount_cents::numeric
             * (least(c.period_end, p_to) - greatest(c.period_start, p_from))
             / (c.period_end - c.period_start))
    from public.hosting_costs c
   where p_to > p_from
     and c.period_start < p_to
     and c.period_end > p_from
   group by c.provider;
$$;

create or replace function kit.hosting_monthly(p_year integer)
returns table (month date, provider text, cents integer)
language sql stable security definer set search_path = '' as $$
  select m.month, s.provider, round(s.cents)::integer
    from (select (make_date(p_year, 7, 1) + make_interval(months => i))::date as month
            from generate_series(0, 11) as i) m
    cross join lateral kit.hosting_spread(m.month, (m.month + interval '1 month')::date) s
   order by m.month, s.provider;
$$;

-- Bills entered for the year, plus each provider's latest bill carried forward
-- at its daily rate to the year's end, when that bill ended within the last
-- 13 months and before the year ends.
create or replace function kit.hosting_projection_at(p_year integer, p_today date)
returns table (provider text, cents numeric)
language sql stable security definer set search_path = '' as $$
  with bounds as (
    select make_date(p_year, 7, 1) as y_start, make_date(p_year + 1, 7, 1) as y_end
  ),
  entered as (
    select s.provider, s.cents
      from bounds b cross join lateral kit.hosting_spread(b.y_start, b.y_end) s
  ),
  latest as (
    select distinct on (c.provider) c.provider, c.amount_cents, c.period_start, c.period_end
      from public.hosting_costs c
     order by c.provider, c.period_end desc, c.created_at desc
  ),
  extra as (
    select l.provider,
           l.amount_cents::numeric / (l.period_end - l.period_start)
             * (b.y_end - greatest(l.period_end, b.y_start)) as cents
      from latest l cross join bounds b
     where l.period_end > (p_today - interval '13 months')::date
       and l.period_end < b.y_end
  )
  select t.provider, sum(t.cents)
    from (select * from entered union all select * from extra) t
   group by t.provider;
$$;

create or replace function kit.dues_collected(p_year integer)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount_cents), 0)::bigint
    from public.dues_periods p
   where p.voided_at is null
     and p.received_on >= make_date(p_year, 7, 1)
     and p.received_on <  make_date(p_year + 1, 7, 1);
$$;

create or replace function kit.dues_monthly(p_year integer)
returns table (month date, online_cents bigint, check_cents bigint, cash_cents bigint)
language sql stable security definer set search_path = '' as $$
  select m.month,
         coalesce(sum(p.amount_cents) filter (where p.method = 'online'), 0)::bigint,
         coalesce(sum(p.amount_cents) filter (where p.method = 'check'), 0)::bigint,
         coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0)::bigint
    from (select (make_date(p_year, 7, 1) + make_interval(months => i))::date as month
            from generate_series(0, 11) as i) m
    left join public.dues_periods p
      on p.voided_at is null
     and p.received_on >= m.month
     and p.received_on <  (m.month + interval '1 month')::date
   group by m.month
   order by m.month;
$$;

create or replace function kit.member_dues_snapshot(p_today date)
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_level text, level_name text, amount_cents integer, paid_through date, dues_status text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.first_name, m.last_name, m.membership_number, m.dues_level, l.name, l.amount_cents,
         pt.paid_through, kit.dues_status(pt.paid_through, m.accepted_on, p_today)
    from public.members m
    join public.dues_levels l on l.slug = m.dues_level
    cross join lateral (select kit.dues_paid_through(m.id) as paid_through) pt;
$$;

create or replace function kit.finance_dashboard_at(p_year integer, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start   date    := make_date(p_year, 7, 1);
  v_end     date    := make_date(p_year + 1, 7, 1);
  v_current boolean := kit.fraternal_year_of(p_today) = p_year;
  v_result  jsonb;
begin
  with snap as (
    select * from kit.member_dues_snapshot(p_today)
  ),
  counts as (
    select s.dues_status, count(*)::integer as n from snap s group by s.dues_status
  )
  select jsonb_build_object(
    'year', p_year,
    'yearStart', v_start,
    'yearEnd', v_end,
    'isCurrentYear', v_current,
    'today', p_today,
    'duesCollectedCents', kit.dues_collected(p_year),
    'outstandingCents',
      (select coalesce(sum(s.amount_cents), 0)::bigint from snap s where s.dues_status in ('due', 'lapsed')),
    'collection', (
      select jsonb_build_object(
        'numerator',   count(*) filter (where s.dues_status in ('current', 'due_soon')),
        'denominator', count(*) filter (where s.dues_status in ('current', 'due_soon', 'due', 'lapsed')))
        from snap s where s.dues_level <> 'honorary'),
    'statusCounts', (
      select jsonb_object_agg(k.status, coalesce((select c.n from counts c where c.dues_status = k.status), 0))
        from unnest(array['current', 'due_soon', 'due', 'lapsed', 'no_record']) as k(status)),
    'hostingToDateCents',
      (select coalesce(round(sum(h.cents)), 0)::bigint
         from kit.hosting_spread(v_start, least(p_today + 1, v_end)) h),
    'hostingProjectionCents',
      case when v_current then
        (select coalesce(round(sum(h.cents)), 0)::bigint from kit.hosting_projection_at(p_year, p_today) h)
      end,
    'duesByMonth', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', d.month, 'onlineCents', d.online_cents,
               'checkCents', d.check_cents, 'cashCents', d.cash_cents) order by d.month), '[]'::jsonb)
        from kit.dues_monthly(p_year) d),
    'hostingByMonth', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', h.month, 'provider', h.provider, 'cents', h.cents) order by h.month, h.provider), '[]'::jsonb)
        from kit.hosting_monthly(p_year) h)
  ) into v_result;

  return v_result;
end $$;

create or replace function kit.finance_net_by_year_at(p_today date)
returns table (year integer, dues_cents bigint, hosting_cents bigint)
language sql stable security definer set search_path = '' as $$
  with first_year as (
    select least(
      (select min(kit.fraternal_year_of(p.received_on)) from public.dues_periods p
        where p.voided_at is null and p.amount_cents > 0),
      (select min(kit.fraternal_year_of(c.period_start)) from public.hosting_costs c),
      kit.fraternal_year_of(p_today)) as y
  )
  select g.y,
         kit.dues_collected(g.y),
         coalesce((select round(sum(s.cents))::bigint
                     from kit.hosting_spread(make_date(g.y, 7, 1), make_date(g.y + 1, 7, 1)) s), 0)
    from first_year f
    cross join lateral generate_series(f.y, kit.fraternal_year_of(p_today)) as g(y)
   order by g.y;
$$;

create or replace function kit.finance_follow_up_at(p_today date)
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number,
         s.dues_status, s.paid_through, s.level_name, s.amount_cents
    from kit.member_dues_snapshot(p_today) s
   where s.dues_status in ('lapsed', 'due')
      or (s.dues_status = 'due_soon' and s.paid_through <= p_today + 30)
   order by case s.dues_status when 'lapsed' then 0 when 'due' then 1 else 2 end,
            s.paid_through nulls last, s.last_name, s.first_name;
$$;

revoke all on function kit.assert_fraternal_year(integer) from public, anon, authenticated;
revoke all on function kit.hosting_spread(date, date) from public, anon, authenticated;
revoke all on function kit.hosting_monthly(integer) from public, anon, authenticated;
revoke all on function kit.hosting_projection_at(integer, date) from public, anon, authenticated;
revoke all on function kit.dues_collected(integer) from public, anon, authenticated;
revoke all on function kit.dues_monthly(integer) from public, anon, authenticated;
revoke all on function kit.member_dues_snapshot(date) from public, anon, authenticated;
revoke all on function kit.finance_dashboard_at(integer, date) from public, anon, authenticated;
revoke all on function kit.finance_net_by_year_at(date) from public, anon, authenticated;
revoke all on function kit.finance_follow_up_at(date) from public, anon, authenticated;

create or replace function public.finance_dashboard(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  perform kit.assert_fraternal_year(p_year);
  return kit.finance_dashboard_at(p_year, kit.council_today());
end $$;

create or replace function public.finance_net_by_year()
returns table (year integer, dues_cents bigint, hosting_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.finance_net_by_year_at(kit.council_today());
end $$;

create or replace function public.finance_follow_up()
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.finance_follow_up_at(kit.council_today());
end $$;

create or replace function public.finance_payments_to_check()
returns table (
  payment_id uuid, created_at timestamptz, member_id uuid, member_name text,
  dues_level text, amount_cents integer, provider text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select p.id, p.created_at, m.id,
           case when m.id is null then null else m.first_name || ' ' || m.last_name end,
           p.metadata ->> 'dues_level', p.amount, p.provider
      from public.payments p
      left join public.members m on m.user_id = p.user_id
     where p.payment_type = 'dues'
       and p.status = 'succeeded'
       and not exists (select 1 from public.dues_periods d where d.payment_id = p.id)
     order by p.created_at desc;
end $$;

revoke all on function public.finance_dashboard(integer) from public, anon;
revoke all on function public.finance_net_by_year() from public, anon;
revoke all on function public.finance_follow_up() from public, anon;
revoke all on function public.finance_payments_to_check() from public, anon;
grant execute on function public.finance_dashboard(integer) to authenticated;
grant execute on function public.finance_net_by_year() to authenticated;
grant execute on function public.finance_follow_up() to authenticated;
grant execute on function public.finance_payments_to_check() to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

Run (from `apps/portal`, with the sandbox disabled): `pnpm exec supabase migration up && pnpm exec supabase test db`

Expected: all 43 tests in `finance_dashboard.test.sql` pass, `hosting_costs.test.sql` passes, and every earlier test passes.

If `members.first_name` or `members.last_name` is not `text` (for example, it is encrypted), stop. Report `NEEDS_CONTEXT` with the column's type; do not decrypt anything here.

- [ ] **Step 5: Regenerate the types**

Follow the Global Constraints rules. Then add a `HAND-CORRECTED` block, in both files, that makes the following fields `string | null`:
- `finance_follow_up` Returns: `paid_through`.
- `finance_payments_to_check` Returns: `member_id`, `member_name` and `dues_level`.

The `finance_dashboard` Returns field stays `Json`. Run `cmp` on the two files; expect no output.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/supabase/migrations/20260929120100_finance_dashboard.sql \
  apps/portal/supabase/tests/finance_dashboard.test.sql \
  apps/portal/lib/database.types.ts packages/supabase/src/database.types.ts
git commit -m "feat(finance): compute the dashboard figures in Postgres"
```

---

### Task 3: `@kit/finance` package — types, helpers, schemas, service, actions

**Files:**
- Create:
  - `packages/features/finance/package.json`, `tsconfig.json`, `vitest.config.ts`, copied from `packages/features/dues` and adjusted. Read those three files first.
  - `packages/features/finance/src/types.ts`
  - `packages/features/finance/src/lib/fraternal-year.ts` and `fraternal-year.test.ts`
  - `packages/features/finance/src/lib/money.ts` and `money.test.ts`
  - `packages/features/finance/src/lib/dates.ts` and `dates.test.ts`
  - `packages/features/finance/src/lib/chart-data.ts` and `chart-data.test.ts`
  - `packages/features/finance/src/schemas.ts` and `schemas.test.ts`
  - `packages/features/finance/src/server/finance.service.ts`
  - `packages/features/finance/src/server/hosting-actions.ts` and `hosting-actions.test.ts`
- Modify:
  - `apps/portal/package.json`: add `"@kit/finance": "workspace:*"`.
  - `apps/portal/next.config.mjs`: add `'@kit/finance'` to `INTERNAL_PACKAGES`.

**Interfaces:**
- Consumes: the Task 1–2 RPCs through `Database`; `chicagoToday` from `@kit/dues/schemas`; `formatAmountCents` from `@kit/dues/lib/format-amount`; `DuesStatus` from `@kit/dues/types`.
- Produces:
  - Types: `HostingProvider`, `HostingCost`, `LatestBill`, `HostingCostInput`, `FinanceDashboard`, `NetYear`, `FollowUpRow`, `PaymentToCheck` and `FinanceActionResult`, as written in Step 3.
  - `fraternalYearOf(iso)`, `parseYearParam(raw, today)`, `fraternalYearLabel(year)` and `yearOptions(current, firstYear)`.
  - `parseDollarsToCents(input): number | null` and `centsToDollarsInput(cents): string`.
  - `addDaysIso(iso, days)`, `daysBetween(a, b)`, `nextPeriod(start, end)` and `monthlyEquivalentCents(amountCents, start, endExclusive)`.
  - `collectionRateLabel(numerator, denominator)`, `monthLabel(iso)`, `toDuesChartData(rows)`, `toHostingChartData(rows, providers)`, `toStatusChartData(counts)` and `toNetChartData(rows)`.
  - `HostingCostFormSchema`, `toHostingCostInput(form)`, `DeleteHostingCostSchema`, `RepeatLastBillSchema` and `OverlapCheckSchema`.
  - `class FinanceService(client)` with `providers()`, `listCosts(year)`, `latestBills()`, `overlaps(input)`, `saveCost(input)`, `deleteCost(id)`, `repeatLast(provider)`, `dashboard(year)`, `netByYear()`, `followUp()` and `paymentsToCheck()`.
  - Actions:
    - `saveHostingCostAction`, `deleteHostingCostAction` and `repeatLastHostingCostAction` return `FinanceActionResult`.
    - `hostingOverlapsAction` returns `{ success: true; overlaps: string[] } | { success: false; error: string }`.

- [ ] **Step 1: Scaffold the package**

Copy `packages/features/dues/package.json`, `tsconfig.json` and `vitest.config.ts` into `packages/features/finance/`, then change the following:
- `package.json`: `"name": "@kit/finance"`. Keep the same `exports` map (`./types`, `./schemas`, `./server/*`, `./components/*`, `./lib/*`), the same scripts and the same devDependencies, and add `"@kit/dues": "workspace:*"`.
- Portal: add `"@kit/finance": "workspace:*"` to `apps/portal/package.json` dependencies, next to `@kit/dues`. Add `'@kit/finance'` to `INTERNAL_PACKAGES` in `apps/portal/next.config.mjs`, after `'@kit/dues'`.

Then run `pnpm install` from the repo root, with `allowed_domains: ["registry.npmjs.org"]`. Expected: the lockfile gains the new workspace package only.

- [ ] **Step 2: Write the failing unit tests**

`packages/features/finance/src/lib/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { centsToDollarsInput, parseDollarsToCents } from './money';

describe('parseDollarsToCents', () => {
  it.each([
    ['25', 2500],
    ['25.5', 2550],
    ['25.50', 2550],
    ['0.10', 10],
    ['$1,200.50', 120050],
    [' 12 ', 1200],
    ['0', 0],
  ])('%s -> %i cents', (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '1e3', '-5', '12.345', '1,2,00', '$', '10000000'])(
    'rejects %s',
    (input) => {
      expect(parseDollarsToCents(input)).toBeNull();
    },
  );
});

describe('centsToDollarsInput', () => {
  it('formats cents for an input box', () => {
    expect(centsToDollarsInput(2550)).toBe('25.50');
    expect(centsToDollarsInput(5)).toBe('0.05');
  });
});
```

`packages/features/finance/src/lib/fraternal-year.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  fraternalYearLabel,
  fraternalYearOf,
  parseYearParam,
  yearOptions,
} from './fraternal-year';

describe('fraternalYearOf', () => {
  it('starts the year on July 1', () => {
    expect(fraternalYearOf('2027-06-30')).toBe(2026);
    expect(fraternalYearOf('2027-07-01')).toBe(2027);
    expect(fraternalYearOf('2027-01-15')).toBe(2026);
  });
});

describe('parseYearParam', () => {
  const today = '2027-06-30'; // Chicago date late on June 30: still FY2026

  it('defaults to the current fraternal year', () => {
    expect(parseYearParam(undefined, today)).toBe(2026);
    expect(parseYearParam('', today)).toBe(2026);
  });

  it('accepts a year from 2000 to next year', () => {
    expect(parseYearParam('2025', today)).toBe(2025);
    expect(parseYearParam('2027', today)).toBe(2027);
    expect(parseYearParam(['2024', '2025'], today)).toBe(2024);
  });

  it('falls back on anything else', () => {
    expect(parseYearParam('1999', today)).toBe(2026);
    expect(parseYearParam('2028', today)).toBe(2026);
    expect(parseYearParam('20x6', today)).toBe(2026);
  });
});

describe('labels and options', () => {
  it('labels a year as 2026–27', () => {
    expect(fraternalYearLabel(2026)).toBe('2026–27');
    expect(fraternalYearLabel(2099)).toBe('2099–00');
  });

  it('lists years newest first', () => {
    expect(yearOptions(2026, 2024)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(2026, 2030)).toEqual([2026]);
  });
});
```

`packages/features/finance/src/lib/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { addDaysIso, daysBetween, monthlyEquivalentCents, nextPeriod } from './dates';

describe('dates', () => {
  it('adds days in UTC without DST drift', () => {
    expect(addDaysIso('2027-03-13', 1)).toBe('2027-03-14');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
  });

  it('matches the database rule for the next period', () => {
    expect(nextPeriod('2034-10-01', '2034-11-01')).toEqual({ start: '2034-11-01', end: '2034-12-01' });
    expect(nextPeriod('2034-10-01', '2035-10-01')).toEqual({ start: '2035-10-01', end: '2036-10-01' });
    expect(nextPeriod('2034-10-16', '2034-11-15')).toEqual({ start: '2034-11-15', end: '2034-12-15' });
    expect(nextPeriod('2027-01-31', '2027-02-28')).toEqual({ start: '2027-02-28', end: '2027-03-28' });
  });

  it('gives a monthly equivalent', () => {
    expect(monthlyEquivalentCents(2500, '2026-10-01', '2026-11-01')).toBe(2500);
    expect(monthlyEquivalentCents(1200, '2026-10-01', '2027-10-01')).toBe(100);
    expect(monthlyEquivalentCents(3000, '2026-10-16', '2026-11-15')).toBe(3044);
  });
});
```

For the last case: 3000 × 30.4375 ÷ 30 days = 3043.75, which rounds to 3044.

`packages/features/finance/src/lib/chart-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  collectionRateLabel,
  monthLabel,
  toDuesChartData,
  toHostingChartData,
  toNetChartData,
  toStatusChartData,
} from './chart-data';

describe('chart data', () => {
  it('labels the collection rate', () => {
    expect(collectionRateLabel(0, 0)).toBe('—');
    expect(collectionRateLabel(2, 3)).toBe('67%');
    expect(collectionRateLabel(3, 3)).toBe('100%');
  });

  it('labels months', () => {
    expect(monthLabel('2026-07-01')).toBe('Jul');
    expect(monthLabel('2027-01-01')).toBe('Jan');
  });

  it('turns dues rows into dollars', () => {
    expect(
      toDuesChartData([{ month: '2026-07-01', onlineCents: 5800, checkCents: 5000, cashCents: 0 }]),
    ).toEqual([{ month: 'Jul', online: 58, check: 50, cash: 0 }]);
    expect(toDuesChartData([])).toEqual([]);
  });

  it('pivots hosting by provider over twelve months', () => {
    const data = toHostingChartData(
      [
        { month: '2026-10-01', provider: 'supabase', cents: 2500 },
        { month: '2026-10-01', provider: 'domain', cents: 102 },
      ],
      [
        { slug: 'supabase', name: 'Supabase' },
        { slug: 'domain', name: 'Domain' },
      ],
      2026,
    );
    expect(data).toHaveLength(12);
    expect(data[3]).toEqual({ month: 'Oct', supabase: 25, domain: 1.02 });
    expect(data[0]).toEqual({ month: 'Jul', supabase: 0, domain: 0 });
  });

  it('orders status counts for the chart', () => {
    expect(
      toStatusChartData({ current: 3, due_soon: 1, due: 2, lapsed: 4, no_record: 0 }).map((r) => r.status),
    ).toEqual(['current', 'due_soon', 'due', 'lapsed', 'no_record']);
  });

  it('computes net per year in dollars', () => {
    expect(toNetChartData([{ year: 2026, duesCents: 10000, hostingCents: 2500 }])).toEqual([
      { year: '2026–27', dues: 100, hosting: 25, net: 75 },
    ]);
  });
});
```

`packages/features/finance/src/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { HostingCostFormSchema, toHostingCostInput } from './schemas';

const base = {
  provider: 'supabase',
  amount: '25.00',
  paidOn: '2026-10-01',
  coversFrom: '2026-10-01',
  coversTo: '2026-10-31',
  note: '',
};

describe('HostingCostFormSchema', () => {
  it('accepts a monthly bill and stores an exclusive end', () => {
    const parsed = HostingCostFormSchema.parse(base);
    expect(toHostingCostInput(parsed)).toEqual({
      id: null,
      provider: 'supabase',
      amountCents: 2500,
      paidOn: '2026-10-01',
      periodStart: '2026-10-01',
      periodEnd: '2026-11-01',
      note: null,
    });
  });

  it('accepts a single-day bill', () => {
    expect(HostingCostFormSchema.safeParse({ ...base, coversTo: '2026-10-01' }).success).toBe(true);
  });

  it('rejects a bad amount', () => {
    expect(HostingCostFormSchema.safeParse({ ...base, amount: '12.345' }).success).toBe(false);
  });

  it('rejects an end before the start', () => {
    expect(HostingCostFormSchema.safeParse({ ...base, coversTo: '2026-09-30' }).success).toBe(false);
  });

  it('rejects more than three years', () => {
    expect(HostingCostFormSchema.safeParse({ ...base, coversTo: '2029-10-05' }).success).toBe(false);
  });

  it('rejects an impossible date', () => {
    expect(HostingCostFormSchema.safeParse({ ...base, paidOn: '2026-02-30' }).success).toBe(false);
  });

  it('rejects a long note and trims a short one', () => {
    expect(HostingCostFormSchema.safeParse({ ...base, note: 'x'.repeat(501) }).success).toBe(false);
    expect(toHostingCostInput(HostingCostFormSchema.parse({ ...base, note: '  Pro plan ' })).note).toBe('Pro plan');
  });

  it('keeps the id on edit', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(toHostingCostInput(HostingCostFormSchema.parse({ ...base, id })).id).toBe(id);
  });
});
```

`packages/features/finance/src/server/hosting-actions.test.ts`. Before writing it, read `packages/features/dues/src/server/dues-actions.test.ts` and copy its mocking of `@kit/next/actions`, `@kit/supabase/server-client` and `next/cache`.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@kit/next/actions', () => ({ enhanceAction: (fn: unknown) => fn }));
vi.mock('@kit/supabase/server-client', () => ({ getSupabaseServerClient: () => ({ rpc }) }));

import {
  deleteHostingCostAction,
  hostingOverlapsAction,
  repeatLastHostingCostAction,
  saveHostingCostAction,
} from './hosting-actions';

const bill = {
  provider: 'supabase',
  amount: '25',
  paidOn: '2026-10-01',
  coversFrom: '2026-10-01',
  coversTo: '2026-10-31',
};

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe('hosting actions', () => {
  it('saves a bill with cents and an exclusive end, then revalidates both pages', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(saveHostingCostAction(bill)).resolves.toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith('hosting_cost_upsert', {
      p_provider: 'supabase',
      p_amount_cents: 2500,
      p_paid_on: '2026-10-01',
      p_period_start: '2026-10-01',
      p_period_end: '2026-11-01',
      p_note: undefined,
      p_id: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/home/hosting-costs');
    expect(revalidatePath).toHaveBeenCalledWith('/home');
  });

  it('rejects bad input without calling the database', async () => {
    const result = await saveHostingCostAction({ ...bill, amount: 'abc' });
    expect(result.success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: '42501', message: 'forbidden' }, 'You do not have permission to manage hosting costs.'],
    [{ code: 'P0001', message: 'unknown hosting provider: aws' }, 'unknown hosting provider: aws'],
    [{ code: 'XX000', message: 'boom' }, 'Something went wrong saving the hosting cost.'],
  ])('maps %o to a message', async (error, message) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(saveHostingCostAction(bill)).resolves.toEqual({ success: false, error: message });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('deletes and repeats', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      deleteHostingCostAction({ id: '11111111-1111-4111-8111-111111111111' }),
    ).resolves.toEqual({ success: true });
    await expect(repeatLastHostingCostAction({ provider: 'supabase' })).resolves.toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith('hosting_cost_repeat_last', { p_provider: 'supabase' });
  });

  it('returns overlapping ids', async () => {
    rpc.mockResolvedValue({ data: ['a', 'b'], error: null });
    await expect(
      hostingOverlapsAction({ provider: 'supabase', periodStart: '2026-10-01', periodEnd: '2026-11-01' }),
    ).resolves.toEqual({ success: true, overlaps: ['a', 'b'] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
```

If `dues-actions.test.ts` mocks these modules differently, follow its approach. Keep every assertion above.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter @kit/finance test:unit`
Expected: FAIL, with the modules not found.

- [ ] **Step 4: Implement**

`packages/features/finance/src/types.ts`:

```ts
import type { DuesStatus } from '@kit/dues/types';

export interface HostingProvider {
  slug: string;
  name: string;
}

export interface HostingCost {
  id: string;
  provider: string;
  providerName: string;
  amountCents: number;
  paidOn: string;
  periodStart: string;
  /** Exclusive. */
  periodEnd: string;
  note: string | null;
  recordedByEmail: string | null;
  updatedAt: string;
}

export interface LatestBill {
  provider: string;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
}

export interface HostingCostInput {
  id: string | null;
  provider: string;
  amountCents: number;
  paidOn: string;
  periodStart: string;
  /** Exclusive. */
  periodEnd: string;
  note: string | null;
}

export type StatusCounts = Record<DuesStatus, number>;

export interface FinanceDashboard {
  year: number;
  yearStart: string;
  yearEnd: string;
  isCurrentYear: boolean;
  today: string;
  duesCollectedCents: number;
  outstandingCents: number;
  collection: { numerator: number; denominator: number };
  statusCounts: StatusCounts;
  hostingToDateCents: number;
  hostingProjectionCents: number | null;
  duesByMonth: { month: string; onlineCents: number; checkCents: number; cashCents: number }[];
  hostingByMonth: { month: string; provider: string; cents: number }[];
}

export interface NetYear {
  year: number;
  duesCents: number;
  hostingCents: number;
}

export interface FollowUpRow {
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  duesStatus: DuesStatus;
  paidThrough: string | null;
  levelName: string;
  amountCents: number;
}

export interface PaymentToCheck {
  paymentId: string;
  createdAt: string;
  memberId: string | null;
  memberName: string | null;
  duesLevel: string | null;
  amountCents: number;
  provider: string;
}

export type FinanceActionResult = { success: true } | { success: false; error: string };
```

`packages/features/finance/src/lib/money.ts`:

```ts
const PLAIN = /^\d{1,7}(\.\d{1,2})?$/;
const GROUPED = /^\d{1,3}(,\d{3}){1,2}(\.\d{1,2})?$/;

/** "$1,200.50" -> 120050. No floating point: whole and fractional parts are
 * read as integers. Returns null for anything that is not a plain dollar
 * amount under $10,000,000. */
export function parseDollarsToCents(input: string): number | null {
  const raw = input.trim().replace(/^\$/, '');

  if (!PLAIN.test(raw) && !GROUPED.test(raw)) {
    return null;
  }

  const [whole, fraction = ''] = raw.replace(/,/g, '').split('.');

  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 2550 -> "25.50", for pre-filling an amount input. */
export function centsToDollarsInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');

  return `${whole}.${fraction}`;
}
```

`packages/features/finance/src/lib/fraternal-year.ts`:

```ts
/** Fraternal year Y runs July 1 of Y to June 30 of Y+1. */
export function fraternalYearOf(isoDate: string): number {
  const [year, month] = isoDate.split('-').map(Number) as [number, number];

  return month < 7 ? year - 1 : year;
}

/** `?year=` -> a fraternal year between 2000 and next year; anything else is
 * the current year. `today` is the America/Chicago date. */
export function parseYearParam(raw: string | string[] | undefined, today: string): number {
  const current = fraternalYearOf(today);
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value || !/^\d{4}$/.test(value)) {
    return current;
  }

  const year = Number(value);

  return year >= 2000 && year <= current + 1 ? year : current;
}

export function fraternalYearLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

/** Newest first, from the current year back to the first year with data. */
export function yearOptions(current: number, firstYear: number): number[] {
  const years: number[] = [];

  for (let y = current; y >= Math.min(firstYear, current); y--) {
    years.push(y);
  }

  return years;
}
```

`packages/features/finance/src/lib/dates.ts`:

```ts
const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(toUtc(iso));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));

  return d.toISOString().slice(0, 10);
}

function wholeMonths(start: string, end: string): number | null {
  if (start.slice(8) !== end.slice(8)) {
    return null;
  }

  const [sy, sm] = start.split('-').map(Number) as [number, number];
  const [ey, em] = end.split('-').map(Number) as [number, number];

  return ey * 12 + em - (sy * 12 + sm);
}

/** Mirrors kit.hosting_next_period: same day of month -> whole months,
 * otherwise the same number of days. */
export function nextPeriod(start: string, end: string): { start: string; end: string } {
  const months = wholeMonths(start, end);

  return months === null
    ? { start: end, end: addDaysIso(end, daysBetween(start, end)) }
    : { start: end, end: addMonthsIso(end, months) };
}

/** What a bill costs per month: a whole-month bill divided by its months,
 * anything else by days (30.4375 days a month). */
export function monthlyEquivalentCents(amountCents: number, start: string, endExclusive: string): number {
  const months = wholeMonths(start, endExclusive);

  if (months !== null && months > 0) {
    return Math.round(amountCents / months);
  }

  const days = daysBetween(start, endExclusive);

  return days > 0 ? Math.round((amountCents * 30.4375) / days) : 0;
}
```

Postgres `date + interval '1 month'` clamps to the last day of the month (Jan 31 → Feb 28), and `addMonthsIso` does the same. So `nextPeriod('2027-01-31', '2027-02-28')` goes down the days path, because 31 ≠ 28, and returns `2027-02-28 → 2027-03-28`, matching the SQL.

`packages/features/finance/src/lib/chart-data.ts`:

```ts
import type { DuesStatus } from '@kit/dues/types';

import { fraternalYearLabel } from './fraternal-year';
import type { FinanceDashboard, HostingProvider, NetYear, StatusCounts } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_ORDER: DuesStatus[] = ['current', 'due_soon', 'due', 'lapsed', 'no_record'];

const dollars = (cents: number) => cents / 100;

export function collectionRateLabel(numerator: number, denominator: number): string {
  return denominator === 0 ? '—' : `${Math.round((numerator / denominator) * 100)}%`;
}

export function monthLabel(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso;
}

export function toDuesChartData(rows: FinanceDashboard['duesByMonth']) {
  return rows.map((r) => ({
    month: monthLabel(r.month),
    online: dollars(r.onlineCents),
    check: dollars(r.checkCents),
    cash: dollars(r.cashCents),
  }));
}

export function toHostingChartData(
  rows: FinanceDashboard['hostingByMonth'],
  providers: HostingProvider[],
  year: number,
) {
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(year, 6 + i, 1)).toISOString().slice(0, 10);
    const entry: Record<string, string | number> = { month: monthLabel(date) };

    for (const p of providers) {
      const row = rows.find((r) => r.month === date && r.provider === p.slug);
      entry[p.slug] = row ? dollars(row.cents) : 0;
    }

    return entry;
  });
}

export function toStatusChartData(counts: StatusCounts) {
  return STATUS_ORDER.map((status) => ({ status, members: counts[status] ?? 0 }));
}

export function toNetChartData(rows: NetYear[]) {
  return rows.map((r) => ({
    year: fraternalYearLabel(r.year),
    dues: dollars(r.duesCents),
    hosting: dollars(r.hostingCents),
    net: dollars(r.duesCents - r.hostingCents),
  }));
}
```

`packages/features/finance/src/schemas.ts`:

```ts
import * as z from 'zod';

import { addDaysIso, daysBetween } from './lib/dates';
import { parseDollarsToCents } from './lib/money';
import type { HostingCostInput } from './types';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Enter a real date');

export const HostingCostFormSchema = z
  .object({
    id: z.string().uuid().optional(),
    provider: z.string().min(1, 'Choose a provider'),
    amount: z.string().refine((v) => parseDollarsToCents(v) !== null, 'Enter an amount like 25 or 25.00'),
    paidOn: isoDate,
    coversFrom: isoDate,
    /** Inclusive: the last day the bill covers. */
    coversTo: isoDate,
    note: z.string().max(500, 'The note can be at most 500 characters').optional(),
  })
  .refine((v) => v.coversTo >= v.coversFrom, {
    message: 'The last covered day must be on or after the first',
    path: ['coversTo'],
  })
  .refine((v) => daysBetween(v.coversFrom, addDaysIso(v.coversTo, 1)) <= 1096, {
    message: 'A bill can cover at most 3 years',
    path: ['coversTo'],
  });

export type HostingCostForm = z.infer<typeof HostingCostFormSchema>;

export function toHostingCostInput(form: HostingCostForm): HostingCostInput {
  return {
    id: form.id ?? null,
    provider: form.provider,
    amountCents: parseDollarsToCents(form.amount) as number,
    paidOn: form.paidOn,
    periodStart: form.coversFrom,
    periodEnd: addDaysIso(form.coversTo, 1),
    note: form.note?.trim() ? form.note.trim() : null,
  };
}

export const DeleteHostingCostSchema = z.object({ id: z.string().uuid() });

export const RepeatLastBillSchema = z.object({ provider: z.string().min(1) });

export const OverlapCheckSchema = z.object({
  provider: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  excludeId: z.string().uuid().optional(),
});
```

`packages/features/finance/src/server/finance.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type {
  FinanceDashboard,
  FollowUpRow,
  HostingCost,
  HostingCostInput,
  HostingProvider,
  LatestBill,
  NetYear,
  PaymentToCheck,
} from '../types';
import type { DuesStatus } from '@kit/dues/types';

type Client = SupabaseClient<Database>;

/**
 * Typed wrapper over the finance RPCs. Pass the SIGNED-IN user's client
 * (getSupabaseServerClient), never the admin client: every function checks
 * finance.view / finance.manage against auth.uid(). Errors are thrown as-is so
 * callers keep the Postgres/PostgREST `code` (readDuesIfDeployed and the
 * actions' message mapping both rely on it).
 */
export class FinanceService {
  constructor(private readonly client: Client) {}

  async providers(): Promise<HostingProvider[]> {
    const { data, error } = await this.client
      .from('hosting_providers')
      .select('slug, name')
      .eq('active', true)
      .order('sort_order');
    if (error) throw error;
    return data ?? [];
  }

  async listCosts(year: number): Promise<HostingCost[]> {
    const { data, error } = await this.client.rpc('hosting_costs_list', { p_year: year });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      provider: r.provider,
      providerName: r.provider_name,
      amountCents: r.amount_cents,
      paidOn: r.paid_on,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      note: r.note,
      recordedByEmail: r.recorded_by_email,
      updatedAt: r.updated_at,
    }));
  }

  async latestBills(): Promise<LatestBill[]> {
    const { data, error } = await this.client.rpc('hosting_cost_latest');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      provider: r.provider,
      amountCents: r.amount_cents,
      periodStart: r.period_start,
      periodEnd: r.period_end,
    }));
  }

  async overlaps(input: { provider: string; periodStart: string; periodEnd: string; excludeId?: string }): Promise<string[]> {
    const { data, error } = await this.client.rpc('hosting_cost_overlaps', {
      p_provider: input.provider,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_exclude_id: input.excludeId,
    });
    if (error) throw error;
    return (data ?? []) as string[];
  }

  async saveCost(input: HostingCostInput): Promise<void> {
    const { error } = await this.client.rpc('hosting_cost_upsert', {
      p_provider: input.provider,
      p_amount_cents: input.amountCents,
      p_paid_on: input.paidOn,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_note: input.note ?? undefined,
      p_id: input.id ?? undefined,
    });
    if (error) throw error;
  }

  async deleteCost(id: string): Promise<void> {
    const { error } = await this.client.rpc('hosting_cost_delete', { p_id: id });
    if (error) throw error;
  }

  async repeatLast(provider: string): Promise<void> {
    const { error } = await this.client.rpc('hosting_cost_repeat_last', { p_provider: provider });
    if (error) throw error;
  }

  async dashboard(year: number): Promise<FinanceDashboard> {
    const { data, error } = await this.client.rpc('finance_dashboard', { p_year: year });
    if (error) throw error;
    return data as unknown as FinanceDashboard;
  }

  async netByYear(): Promise<NetYear[]> {
    const { data, error } = await this.client.rpc('finance_net_by_year');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      year: r.year,
      duesCents: Number(r.dues_cents),
      hostingCents: Number(r.hosting_cents),
    }));
  }

  async followUp(): Promise<FollowUpRow[]> {
    const { data, error } = await this.client.rpc('finance_follow_up');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      duesStatus: r.dues_status as DuesStatus,
      paidThrough: r.paid_through,
      levelName: r.level_name,
      amountCents: r.amount_cents,
    }));
  }

  async paymentsToCheck(): Promise<PaymentToCheck[]> {
    const { data, error } = await this.client.rpc('finance_payments_to_check');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      paymentId: r.payment_id,
      createdAt: r.created_at,
      memberId: r.member_id,
      memberName: r.member_name,
      duesLevel: r.dues_level,
      amountCents: r.amount_cents,
      provider: r.provider,
    }));
  }
}
```

`packages/features/finance/src/server/hosting-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  DeleteHostingCostSchema,
  HostingCostFormSchema,
  OverlapCheckSchema,
  RepeatLastBillSchema,
  toHostingCostInput,
} from '../schemas';
import type { FinanceActionResult } from '../types';
import { FinanceService } from './finance.service';

/** Expected failures are returned, never thrown: Next.js redacts thrown
 * Server Action messages in production. Same convention as dues-actions.ts. */
function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to manage hosting costs.';
    case 'P0001':
      return e.message ?? 'The hosting cost was refused.';
    default:
      return 'Something went wrong saving the hosting cost.';
  }
}

function invalid(issues: { message: string }[]): FinanceActionResult {
  return { success: false, error: issues[0]?.message ?? 'Check the bill details.' };
}

async function run(fn: (service: FinanceService) => Promise<void>): Promise<FinanceActionResult> {
  try {
    await fn(new FinanceService(getSupabaseServerClient()));

    revalidatePath('/home/hosting-costs');
    revalidatePath('/home');

    return { success: true };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

export const saveHostingCostAction = enhanceAction(async (data: unknown) => {
  const parsed = HostingCostFormSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error.issues);

  return run((service) => service.saveCost(toHostingCostInput(parsed.data)));
}, {});

export const deleteHostingCostAction = enhanceAction(async (data: unknown) => {
  const parsed = DeleteHostingCostSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error.issues);

  return run((service) => service.deleteCost(parsed.data.id));
}, {});

export const repeatLastHostingCostAction = enhanceAction(async (data: unknown) => {
  const parsed = RepeatLastBillSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error.issues);

  return run((service) => service.repeatLast(parsed.data.provider));
}, {});

export const hostingOverlapsAction = enhanceAction(
  async (
    data: unknown,
  ): Promise<{ success: true; overlaps: string[] } | { success: false; error: string }> => {
    const parsed = OverlapCheckSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Check the covered dates.' };

    try {
      const overlaps = await new FinanceService(getSupabaseServerClient()).overlaps(parsed.data);
      return { success: true, overlaps };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run from the repo root:
```bash
pnpm --filter @kit/finance test:unit
pnpm typecheck
pnpm lint
pnpm exec oxfmt --check packages/features/finance apps/portal/package.json apps/portal/next.config.mjs
```
Expected:
- all finance unit tests PASS;
- typecheck passes for every package, including `@kit/finance`;
- lint is clean;
- oxfmt reports no failures in these paths. If it does, run `pnpm exec oxfmt` on the listed files.

- [ ] **Step 6: Commit**

```bash
git add packages/features/finance apps/portal/package.json apps/portal/next.config.mjs pnpm-lock.yaml
git commit -m "feat(finance): add the @kit/finance package"
```

---

### Task 4: Hosting costs page

**Files:**
- Create:
  - `packages/features/finance/src/components/year-picker.tsx`
  - `packages/features/finance/src/components/hosting-cost-form-dialog.tsx`
  - `packages/features/finance/src/components/hosting-costs-table.tsx`
  - `packages/features/finance/src/components/repeat-last-bill.tsx`
  - `packages/features/finance/src/components/hosting-costs-table.test.tsx`
  - `apps/portal/app/home/hosting-costs/page.tsx`
- Modify:
  - `packages/brand/src/config/paths.config.ts` and `paths.config.test.ts`: add `hostingCosts: '/home/hosting-costs'`
  - `apps/portal/config/navigation.config.tsx`: add a nav item
  - `packages/brand/i18n/messages/en/common.json`: add `routes.hostingCosts`. Also add it to every other locale folder under `packages/brand/i18n/messages/` that has a `routes` block, with the English text.

**Interfaces:**
- Consumes (Task 3):
  - `FinanceService.providers`, `listCosts`, `latestBills` and `netByYear`;
  - the actions;
  - `HostingCostFormSchema`;
  - `centsToDollarsInput`, `addDaysIso`, `nextPeriod` and `monthlyEquivalentCents`;
  - `parseYearParam`, `fraternalYearLabel` and `yearOptions`;
  - `formatAmountCents` from `@kit/dues`;
  - `readDuesIfDeployed`.
- Produces:
  - the route `/home/hosting-costs`;
  - `<YearPicker year options />`, which Task 5 reuses;
  - `data-test` hooks for Task 6:
    - `year-picker`, `hosting-costs-table`, `hosting-cost-row`, `hosting-costs-empty`
    - `hosting-cost-add`, `hosting-cost-edit`, `hosting-cost-delete`, `hosting-cost-delete-confirm`
    - `hosting-cost-provider`, `hosting-cost-amount`, `hosting-cost-paid-on`, `hosting-cost-covers-from`, `hosting-cost-covers-to`, `hosting-cost-note`
    - `hosting-cost-monthly`, `hosting-cost-overlap-warning`, `hosting-cost-save`
    - `hosting-repeat-last`, `hosting-repeat-last-<slug>`, `hosting-repeat-preview`, `hosting-repeat-confirm`

Before writing any component, read `packages/features/dues/src/components/member-dues-card.tsx`, `record-payment-form.tsx` and `void-period-button.tsx`. Copy their exact `@kit/ui` imports (Dialog, AlertDialog, Select, Form or Label + Input, Table, Button) and their `useTransition` + `toast` patterns. The code below uses those same components.

- [ ] **Step 1: Write the failing component test**

`packages/features/finance/src/components/hosting-costs-table.test.tsx`. Copy the render setup (the testing-library import and any providers) from `packages/features/dues/src/components/member-dues-card.test.tsx`.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/hosting-actions', () => ({
  saveHostingCostAction: vi.fn(),
  deleteHostingCostAction: vi.fn(),
  repeatLastHostingCostAction: vi.fn(),
  hostingOverlapsAction: vi.fn(),
}));

import { HostingCostsTable } from './hosting-costs-table';

const providers = [{ slug: 'supabase', name: 'Supabase' }];
const cost = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'supabase',
  providerName: 'Supabase',
  amountCents: 2500,
  paidOn: '2026-10-01',
  periodStart: '2026-10-01',
  periodEnd: '2026-11-01',
  note: null,
  recordedByEmail: 'fs@example.com',
  updatedAt: '2026-10-01T12:00:00Z',
};

describe('HostingCostsTable', () => {
  it('shows the covered period inclusively and the amount', () => {
    render(<HostingCostsTable costs={[cost]} providers={providers} latest={[]} canManage={false} />);
    expect(screen.getByText('$25.00')).toBeTruthy();
    expect(screen.getByText('2026-10-01 – 2026-10-31')).toBeTruthy();
  });

  it('hides management controls without finance.manage', () => {
    const { container } = render(
      <HostingCostsTable costs={[cost]} providers={providers} latest={[]} canManage={false} />,
    );
    expect(container.querySelector('[data-test="hosting-cost-add"]')).toBeNull();
    expect(container.querySelector('[data-test="hosting-cost-edit"]')).toBeNull();
  });

  it('shows controls with finance.manage', () => {
    const { container } = render(
      <HostingCostsTable costs={[cost]} providers={providers} latest={[]} canManage />,
    );
    expect(container.querySelector('[data-test="hosting-cost-add"]')).not.toBeNull();
    expect(container.querySelector('[data-test="hosting-cost-edit"]')).not.toBeNull();
  });

  it('shows an empty state', () => {
    const { container } = render(
      <HostingCostsTable costs={[]} providers={providers} latest={[]} canManage={false} />,
    );
    expect(container.querySelector('[data-test="hosting-costs-empty"]')).not.toBeNull();
  });
});
```

Run `pnpm --filter @kit/finance test:unit`. Expected: FAIL, with the module not found. If `@testing-library/react` or a DOM environment is not configured in the package, copy the dues package's `devDependencies` entries for it and its `vitest.config.ts` environment setting.

- [ ] **Step 2: Year picker**

`packages/features/finance/src/components/year-picker.tsx`:

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';

import { fraternalYearLabel } from '../lib/fraternal-year';

export function YearPicker({ year, options }: { year: number; options: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Select
      value={String(year)}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        next.set('year', value);
        router.replace(`${pathname}?${next.toString()}`);
      }}
    >
      <SelectTrigger className="w-40" data-test="year-picker" aria-label="Fraternal year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {fraternalYearLabel(y)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 3: Form dialog**

`packages/features/finance/src/components/hosting-cost-form-dialog.tsx`, a client component. It needs:

- **Props:** `{ providers: HostingProvider[]; cost?: HostingCost; trigger: React.ReactNode }`.
- **Form setup:** react-hook-form with `zodResolver(HostingCostFormSchema)`.
- **Default values:**
  - Editing: `id`, `provider`, `amount: centsToDollarsInput(cost.amountCents)`, `paidOn`, `coversFrom: cost.periodStart`, `coversTo: addDaysIso(cost.periodEnd, -1)` and `note ?? ''`.
  - Adding: provider `providers[0]?.slug ?? ''`, amount `''`, and `paidOn`, `coversFrom` and `coversTo` all set to `chicagoToday()`.
- **Fields,** each with a `<Label htmlFor>`:
  - a provider `Select` (`data-test="hosting-cost-provider"`);
  - an amount `Input` with `inputMode="decimal"` and placeholder `25.00` (`data-test="hosting-cost-amount"`);
  - date inputs for paid on, covers from and covers to (`hosting-cost-paid-on`, `hosting-cost-covers-from`, `hosting-cost-covers-to`);
  - a note `Textarea`, or an `Input` if there is no textarea component (`hosting-cost-note`).
- **Monthly equivalent line** (`data-test="hosting-cost-monthly"`):
  - When the amount parses and the dates are in order, show `≈ {formatAmountCents(monthlyEquivalentCents(cents, coversFrom, addDaysIso(coversTo, 1)))} a month`.
  - Otherwise render nothing.
- **Overlap check, on submit:**
  1. If an overlap has not been acknowledged yet, call `hostingOverlapsAction({ provider, periodStart: coversFrom, periodEnd: addDaysIso(coversTo, 1), excludeId: id })`.
  2. If it returns any ids, show `This overlaps {n} other {provider} bill(s). Save anyway?` (`data-test="hosting-cost-overlap-warning"`), set `acknowledged = true`, change the Save button text to "Save anyway", and stop.
  3. Otherwise, or on the second submit, call `saveHostingCostAction(values)`.
- **After saving:**
  - On `{ success: true }`: `toast.success('Hosting cost saved')`, close the dialog and reset the form.
  - On failure: `toast.error(result.error)`, and keep the dialog open.
  - Changing the provider or any date resets `acknowledged` to false.
- **Save button** (`data-test="hosting-cost-save"`): disabled while pending.

- [ ] **Step 4: Table and repeat**

`packages/features/finance/src/components/repeat-last-bill.tsx`, a client component:

- **Props:** `{ providers: HostingProvider[]; latest: LatestBill[] }`.
- **Menu:** a "Repeat last bill" `DropdownMenu` (`data-test="hosting-repeat-last"`). It has one item per provider that has a latest bill (`data-test="hosting-repeat-last-<slug>"`). If none do, render nothing.
- **Choosing an item** opens an `AlertDialog`. Its body (`data-test="hosting-repeat-preview"`) reads: `Add {name} {formatAmountCents(amountCents)} for {start} – {addDaysIso(end, -1)}?`, where `{ start, end } = nextPeriod(bill.periodStart, bill.periodEnd)`.
- **Confirm** (`data-test="hosting-repeat-confirm"`) calls `repeatLastHostingCostAction({ provider })`, then toasts the result.

`packages/features/finance/src/components/hosting-costs-table.tsx`, a client component:

- **Props:** `{ costs: HostingCost[]; providers: HostingProvider[]; latest: LatestBill[]; canManage: boolean }`.
- **Toolbar,** shown when `canManage`:
  - `<HostingCostFormDialog providers trigger={<Button data-test="hosting-cost-add">Add bill</Button>} />`
  - `<RepeatLastBill providers latest />`
- **Empty state:** with no costs, render `<p data-test="hosting-costs-empty">No hosting costs recorded for this year.</p>`.
- **Table** (`data-test="hosting-costs-table"`):
  - Columns: Provider, Amount (`formatAmountCents`), Paid on, Covers (`${periodStart} – ${addDaysIso(periodEnd, -1)}`) and Note (`note ?? '—'`).
  - When `canManage`, add a last column with a visually hidden header "Actions" (`<span className="sr-only">Actions</span>`). It holds an Edit button, which opens `HostingCostFormDialog` with `cost` (`data-test="hosting-cost-edit"`), and a Delete button (`data-test="hosting-cost-delete"`).
  - Delete opens an `AlertDialog`: "Delete the {providerName} bill of {amount}?". Its confirm (`data-test="hosting-cost-delete-confirm"`) calls `deleteHostingCostAction({ id })`, then toasts.
  - Each row has `data-test="hosting-cost-row"`.
  - Each action button's `aria-label` names the bill, e.g. `Edit Supabase bill 2026-10-01 – 2026-10-31`.

- [ ] **Step 5: Page, path, nav and translation**

`packages/brand/src/config/paths.config.ts`:
- add `hostingCosts: z.string().min(1),` to the `app` schema, next to `members`;
- add `hostingCosts: '/home/hosting-costs',` to the values.

Update `paths.config.test.ts` if it snapshots or lists the paths.

`apps/portal/config/navigation.config.tsx`: after the Members item, add the following. Import `Receipt` from `lucide-react`, next to the existing icon imports.

```tsx
      {
        label: 'common.routes.hostingCosts',
        path: pathsConfig.app.hostingCosts,
        Icon: <Receipt className={iconClasses} />,
        section: 'finance',
        verb: 'view' as const,
      },
```

`packages/brand/i18n/messages/en/common.json`: in the `routes` object, add `"hostingCosts": "Hosting costs"`. `AppBreadcrumbs` may resolve path segments through i18n. If so (check how it labels `members`), also add the key it expects for `hosting-costs`.

`apps/portal/app/home/hosting-costs/page.tsx`:

```tsx
import { Suspense } from 'react';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { HostingCostsTable } from '@kit/finance/components/hosting-costs-table';
import { YearPicker } from '@kit/finance/components/year-picker';
import { fraternalYearOf, parseYearParam, yearOptions } from '@kit/finance/lib/fraternal-year';
import { FinanceService } from '@kit/finance/server/finance.service';
import { hasPermission } from '@kit/rbac/types';
import { getCurrentPermissions, requirePermission } from '~/lib/server/require-permission';

/** Per-user by construction; see app/home/layout.tsx. */
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function HostingCostsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <HostingCostsContent searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function HostingCostsContent({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('finance', 'view');

  const perms = await getCurrentPermissions();
  const today = chicagoToday();
  const year = parseYearParam((await searchParams).year, today);
  const service = new FinanceService(getSupabaseServerClient());

  const read = await readDuesIfDeployed(() =>
    Promise.all([service.providers(), service.listCosts(year), service.latestBills(), service.netByYear()]),
  );

  if (!read.deployed) {
    return <p data-test="hosting-costs-empty">Hosting costs are not available yet.</p>;
  }

  const [providers, costs, latest, net] = read.value;
  const current = fraternalYearOf(today);

  return (
    <div className="flex flex-col gap-4">
      <YearPicker year={year} options={yearOptions(current, net[0]?.year ?? current)} />
      <HostingCostsTable
        costs={costs}
        providers={providers}
        latest={latest}
        canManage={hasPermission(perms, 'finance', 'manage')}
      />
    </div>
  );
}
```

`readDuesIfDeployed` treats a missing finance function (PGRST202) or table (PGRST205) as "not deployed". The name says dues, but the codes are generic, which is why it is reused here.

- [ ] **Step 6: Run the tests and checks**

```bash
pnpm --filter @kit/finance test:unit
pnpm --filter @kit/brand test:unit   # only if the brand package has a test:unit script; check package.json
pnpm typecheck
pnpm lint
pnpm exec oxfmt --check packages/features/finance apps/portal/app/home/hosting-costs apps/portal/config packages/brand/src/config packages/brand/i18n
```
Expected: all pass, and no new oxfmt failures.

- [ ] **Step 7: Commit**

```bash
git add packages/features/finance apps/portal/app/home/hosting-costs apps/portal/config/navigation.config.tsx \
  packages/brand/src/config packages/brand/i18n
git commit -m "feat(finance): add the hosting costs page"
```

---

### Task 5: `/home` — financial dashboard and member home

**Files:**
- Create:
  - `packages/features/finance/src/components/headline-cards.tsx`
  - `packages/features/finance/src/components/finance-charts.tsx`
  - `packages/features/finance/src/components/follow-up-table.tsx`
  - `packages/features/finance/src/components/payments-to-check-table.tsx`
  - `packages/features/finance/src/components/member-home.tsx`
  - `packages/features/finance/src/components/headline-cards.test.tsx`
  - `packages/features/finance/src/components/member-home.test.tsx`
- Modify: `apps/portal/app/home/page.tsx` (rewrite)
- Delete: `apps/portal/app/home/_components/dashboard-demo.tsx` and `apps/portal/app/home/_components/dashboard-demo-charts.tsx`

**Interfaces:**
- Consumes:
  - `FinanceService.dashboard`, `netByYear`, `followUp`, `paymentsToCheck` and `providers` (Task 3)
  - `YearPicker` (Task 4)
  - `DuesService.mySummary()` and `MyDuesSummary` (`@kit/dues`)
  - `DuesStatusBadge` (`@kit/dues/components/dues-status-badge`)
  - `formatAmountCents`
  - the chart-data helpers (Task 3)
- Produces `data-test` hooks for Task 6:
  - `finance-dashboard`, `finance-dues-collected`, `finance-outstanding`, `finance-collection-rate`, `finance-hosting-to-date`, `finance-hosting-projection`
  - `finance-chart-dues`, `finance-chart-status`, `finance-chart-hosting`, `finance-chart-net`
  - `finance-follow-up`, `finance-follow-up-row`, `finance-payments-to-check`
  - `member-home`, `member-home-dues-status`, `member-home-pay-link`, `member-home-no-member`

- [ ] **Step 1: Write the failing component tests**

`packages/features/finance/src/components/headline-cards.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeadlineCards } from './headline-cards';

const empty = {
  year: 2026,
  yearStart: '2026-07-01',
  yearEnd: '2027-07-01',
  isCurrentYear: true,
  today: '2026-10-16',
  duesCollectedCents: 0,
  outstandingCents: 0,
  collection: { numerator: 0, denominator: 0 },
  statusCounts: { current: 0, due_soon: 0, due: 0, lapsed: 0, no_record: 0 },
  hostingToDateCents: 0,
  hostingProjectionCents: 0,
  duesByMonth: [],
  hostingByMonth: [],
};

const text = (c: HTMLElement, hook: string) => c.querySelector(`[data-test="${hook}"]`)?.textContent ?? '';

describe('HeadlineCards', () => {
  it('shows zeros and a dash for a council with no data', () => {
    const { container } = render(<HeadlineCards dashboard={empty} />);
    expect(text(container, 'finance-dues-collected')).toContain('$0.00');
    expect(text(container, 'finance-collection-rate')).toContain('—');
    expect(text(container, 'finance-hosting-projection')).toContain('$0.00');
  });

  it('hides the projection for a past year', () => {
    const { container } = render(
      <HeadlineCards dashboard={{ ...empty, isCurrentYear: false, hostingProjectionCents: null }} />,
    );
    expect(container.querySelector('[data-test="finance-hosting-projection"]')).toBeNull();
  });

  it('labels the snapshot figures as of today', () => {
    const { container } = render(<HeadlineCards dashboard={{ ...empty, outstandingCents: 13500 }} />);
    expect(text(container, 'finance-outstanding')).toContain('$135.00');
    expect(text(container, 'finance-outstanding')).toContain('as of today');
  });
});
```

`packages/features/finance/src/components/member-home.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberHome } from './member-home';

const summary = {
  memberId: 'm1',
  duesLevel: 'regular',
  levelName: 'Regular',
  amountCents: 5000,
  acceptedOn: '2025-01-01',
  isStudent: false,
  paidThrough: '2026-01-01',
  duesStatus: 'lapsed' as const,
  levelSelfService: true,
  levelActive: true,
};

describe('MemberHome', () => {
  it('shows dues status and a pay link when lapsed', () => {
    const { container } = render(<MemberHome summary={summary} duesDeployed />);
    expect(container.querySelector('[data-test="member-home-dues-status"]')).not.toBeNull();
    expect(container.querySelector('[data-test="member-home-pay-link"]')?.getAttribute('href')).toBe('/home/checkout');
  });

  it('has no pay link when current', () => {
    const { container } = render(
      <MemberHome summary={{ ...summary, duesStatus: 'current', paidThrough: '2027-06-01' }} duesDeployed />,
    );
    expect(container.querySelector('[data-test="member-home-pay-link"]')).toBeNull();
  });

  it('explains when the account has no member record', () => {
    const { container } = render(<MemberHome summary={null} duesDeployed />);
    expect(container.querySelector('[data-test="member-home-no-member"]')).not.toBeNull();
  });

  it('shows only the links before dues are deployed', () => {
    const { container } = render(<MemberHome summary={null} duesDeployed={false} />);
    expect(container.querySelector('[data-test="member-home-no-member"]')).toBeNull();
    expect(container.querySelector('a[href="/home/payments"]')).not.toBeNull();
  });
});
```

Run `pnpm --filter @kit/finance test:unit`. Expected: FAIL, with the modules not found.

- [ ] **Step 2: Implement the components**

`packages/features/finance/src/components/headline-cards.tsx`. It has no `'use client'`: no hooks, so it renders on the server or the client.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { formatAmountCents } from '@kit/dues/lib/format-amount';

import { collectionRateLabel } from '../lib/chart-data';
import type { FinanceDashboard } from '../types';

function Figure({ hook, title, value, sub }: { hook: string; title: string; value: string; sub?: string }) {
  return (
    <Card data-test={hook}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {sub ? <p className="text-muted-foreground text-xs">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function HeadlineCards({ dashboard }: { dashboard: FinanceDashboard }) {
  const d = dashboard;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Figure hook="finance-dues-collected" title="Dues collected" value={formatAmountCents(d.duesCollectedCents)} sub="This fraternal year" />
      <Figure hook="finance-outstanding" title="Outstanding" value={formatAmountCents(d.outstandingCents)} sub="Due and lapsed, as of today" />
      <Figure
        hook="finance-collection-rate"
        title="Collection rate"
        value={collectionRateLabel(d.collection.numerator, d.collection.denominator)}
        sub="Excluding honorary, as of today"
      />
      <Card data-test="finance-hosting-to-date">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">Hosting so far</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{formatAmountCents(d.hostingToDateCents)}</div>
          {d.isCurrentYear && d.hostingProjectionCents !== null ? (
            <p className="text-muted-foreground text-xs" data-test="finance-hosting-projection">
              Projected for the year: {formatAmountCents(d.hostingProjectionCents)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
```

`packages/features/finance/src/components/finance-charts.tsx`, a `'use client'` component. Before writing it, read `packages/ui/src/shadcn/chart.tsx` for the exported `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent` and `ChartConfig`. Also read the deleted demo, `dashboard-demo-charts.tsx`, for a working Recharts example in this repo before you delete it.

It exports four charts, each inside a `Card` with a title:
- `DuesByMonthChart({ rows })`:
  - a stacked `BarChart` of `toDuesChartData(rows)`, with keys `online`, `check` and `cash`;
  - `data-test="finance-chart-dues"`;
  - when every value is 0, show "No dues recorded this year." in place of the chart.
- `StatusChart({ counts })`:
  - a `BarChart` of `toStatusChartData(counts)`;
  - the x axis uses the `DuesStatusBadge` labels: Current, Due soon, Due, Lapsed, No record;
  - `data-test="finance-chart-status"`;
  - the title ends with "(as of today)".
- `HostingByMonthChart({ rows, providers, year })`:
  - a `BarChart` of `toHostingChartData(rows, providers, year)`, stacked by provider slug;
  - `data-test="finance-chart-hosting"`;
  - when `rows` is empty, show "No hosting costs recorded this year."
- `NetByYearChart({ rows })`:
  - a `BarChart` of `toNetChartData(rows)` with bars for `dues`, `hosting` and `net`;
  - `data-test="finance-chart-net"`.

Build each chart's `ChartConfig` from its keys, with colours `var(--chart-1)` to `var(--chart-5)`, and format the tooltip values as dollars.

`packages/features/finance/src/components/follow-up-table.tsx`:
- **Props:** `{ rows: FollowUpRow[]; canOpenMembers: boolean }`.
- **Layout:** a `Card` titled "Follow up (as of today)" (`data-test="finance-follow-up"`) containing a `Table`.
- **Columns:** Name, Membership #, Status (`DuesStatusBadge`), Paid through (`paidThrough ?? '—'`), Level and Owed (`formatAmountCents(amountCents)`).
- **Name cell:** `<Link href={\`/home/members/${memberId}\`}>` when `canOpenMembers`, plain text otherwise.
- **Rows** have `data-test="finance-follow-up-row"`.
- **Empty state:** "Everyone is paid up."

`packages/features/finance/src/components/payments-to-check-table.tsx`:
- **Props:** `{ rows: PaymentToCheck[] }`. It returns `null` when `rows` is empty.
- **Layout:** a `Card` titled "Payments to check" (`data-test="finance-payments-to-check"`), with a line explaining that these online dues payments succeeded but no dues period was recorded, so the Financial Secretary should record each one on the member's page.
- **Columns:** Date (`createdAt.slice(0, 10)`), Member (`memberName ?? 'No linked member'`, linked to `/home/members/${memberId}` when `memberId` is present), Level (`duesLevel ?? '—'`), Amount and Provider.

`packages/features/finance/src/components/member-home.tsx`. It has no `'use client'`.

```tsx
import Link from 'next/link';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { DuesStatusBadge } from '@kit/dues/components/dues-status-badge';
import type { MyDuesSummary } from '@kit/dues/types';

const PAYABLE = new Set(['due', 'lapsed', 'due_soon']);

export function MemberHome({ summary, duesDeployed }: { summary: MyDuesSummary | null; duesDeployed: boolean }) {
  return (
    <div className="flex flex-col gap-4" data-test="member-home">
      {duesDeployed && summary ? (
        <Card>
          <CardHeader>
            <CardTitle>My dues</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span data-test="member-home-dues-status">
              <DuesStatusBadge status={summary.duesStatus} />
            </span>
            <p>Paid through {summary.paidThrough ?? '—'}</p>
            <p>Level: {summary.levelName}</p>
            {PAYABLE.has(summary.duesStatus) ? (
              <Button asChild>
                <Link href="/home/checkout" data-test="member-home-pay-link">
                  Pay dues
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {duesDeployed && !summary ? (
        <p className="text-muted-foreground" data-test="member-home-no-member">
          Your sign-in is not linked to a membership record yet. Ask the Financial Secretary to link it.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button variant="outline" asChild>
          <Link href="/home/payments">Payments</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/home/settings">Settings</Link>
        </Button>
      </div>
    </div>
  );
}
```

`DuesStatusBadge` may be a `'use client'` component. If so, it still renders inside this server component. Check its props name (`status`) against `dues-status-badge.tsx`.

- [ ] **Step 3: Rewrite `/home`**

`apps/portal/app/home/page.tsx`:

```tsx
import { Suspense } from 'react';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { DuesService } from '@kit/dues/server/dues.service';
import {
  DuesByMonthChart,
  HostingByMonthChart,
  NetByYearChart,
  StatusChart,
} from '@kit/finance/components/finance-charts';
import { FollowUpTable } from '@kit/finance/components/follow-up-table';
import { HeadlineCards } from '@kit/finance/components/headline-cards';
import { MemberHome } from '@kit/finance/components/member-home';
import { PaymentsToCheckTable } from '@kit/finance/components/payments-to-check-table';
import { YearPicker } from '@kit/finance/components/year-picker';
import { fraternalYearOf, parseYearParam, yearOptions } from '@kit/finance/lib/fraternal-year';
import { FinanceService } from '@kit/finance/server/finance.service';
import { hasPermission } from '@kit/rbac/types';
import { getCurrentPermissions } from '~/lib/server/require-permission';

/** Per-user by construction; see app/home/layout.tsx. */
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function HomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <HomeContent searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function HomeContent({ searchParams }: { searchParams: SearchParams }) {
  const perms = await getCurrentPermissions();
  const client = getSupabaseServerClient();

  if (hasPermission(perms, 'finance', 'view')) {
    const today = chicagoToday();
    const year = parseYearParam((await searchParams).year, today);
    const finance = new FinanceService(client);

    const read = await readDuesIfDeployed(() =>
      Promise.all([
        finance.dashboard(year),
        finance.netByYear(),
        finance.followUp(),
        finance.paymentsToCheck(),
        finance.providers(),
      ]),
    );

    if (read.deployed) {
      const [dashboard, net, followUp, toCheck, providers] = read.value;
      const current = fraternalYearOf(today);

      return (
        <div className="flex flex-col gap-6" data-test="finance-dashboard">
          <YearPicker year={year} options={yearOptions(current, net[0]?.year ?? current)} />
          <HeadlineCards dashboard={dashboard} />
          <div className="grid gap-4 lg:grid-cols-2">
            <DuesByMonthChart rows={dashboard.duesByMonth} />
            <StatusChart counts={dashboard.statusCounts} />
            <HostingByMonthChart rows={dashboard.hostingByMonth} providers={providers} year={year} />
            <NetByYearChart rows={net} />
          </div>
          <FollowUpTable rows={followUp} canOpenMembers={hasPermission(perms, 'members', 'view')} />
          <PaymentsToCheckTable rows={toCheck} />
        </div>
      );
    }
  }

  const dues = await readDuesIfDeployed(() => new DuesService(client).mySummary());

  return <MemberHome summary={dues.deployed ? dues.value : null} duesDeployed={dues.deployed} />;
}
```

If `DuesService.mySummary()` has a different name or return type, use what `apps/portal/app/home/payments/page.tsx` calls. It reads the same summary.

Delete `apps/portal/app/home/_components/dashboard-demo.tsx` and `dashboard-demo-charts.tsx`. Then run `grep -rn "dashboard-demo" apps packages`. Expected: no matches. Any i18n keys used only by the demo can stay.

- [ ] **Step 4: Run the tests and checks**

```bash
pnpm --filter @kit/finance test:unit
pnpm --filter @kit/dues test:unit
pnpm typecheck
pnpm lint
pnpm exec oxfmt --check packages/features/finance apps/portal/app/home
```
Expected: all pass.

Server/client boundary check: in the portal, nothing may import a non-component export from a `'use client'` file. Run `grep -l "'use client'" packages/features/finance/src/components/*.tsx`. For each file listed, confirm the portal imports only its React components.

- [ ] **Step 5: Commit**

```bash
git add packages/features/finance apps/portal/app/home
git commit -m "feat(finance): show the financial dashboard on /home"
```

---

### Task 6: End-to-end tests

**Files:**
- Create: `apps/e2e/tests/finance/finance.spec.ts`, `apps/e2e/tests/finance/finance.po.ts`

**Interfaces:**
- Consumes: the Task 4 and Task 5 `data-test` hooks. Also the sign-in, sign-up and administrator-promotion helpers used by `apps/e2e/tests/dues/dues.po.ts` and `dues.spec.ts`. Read both files first and reuse their helpers and their America/Chicago `chicagoToday`/`addDaysIso` copies.

- [ ] **Step 1: Write the specs**

`finance.spec.ts`, in `test.describe('finance')`:

1. **An administrator adds a hosting bill and the dashboard moves.**
   1. Sign in as an administrator, the way `dues.spec.ts` does.
   2. Open `/home` and read the number in `finance-hosting-to-date`. Parse it with `Number(text.replace(/[^0-9.]/g, ''))`.
   3. Open `/home/hosting-costs` and click `hosting-cost-add`. Choose Supabase, and use an amount of `25.00` so a rerun is distinguishable. Set paid on to today, covers from to today minus 5 days and covers to to today, all Chicago dates. Save, acknowledging the overlap warning if it appears.
   4. Expect a toast "Hosting cost saved" and a new `hosting-cost-row` containing `$25.00`.
   5. Open `/home` again. Expect `finance-hosting-to-date` to be greater than before.
2. **Repeat last bill adds the next period.**
   1. On `/home/hosting-costs`, count the `hosting-cost-row` elements.
   2. Click `hosting-repeat-last`, then `hosting-repeat-last-supabase`. Expect `hosting-repeat-preview` to be visible, then click `hosting-repeat-confirm`.
   3. If the new period falls outside the current fraternal year, switch `year-picker` to the next year before counting. Otherwise expect the row count to go up by 1.
3. **A member without finance access gets the member home.**
   1. Sign up a fresh default member, as `dues.spec.ts` does for its plain member.
   2. Open `/home`. Expect `member-home` to be visible and `finance-dashboard` to have count 0.
   3. Expect the sidebar to have no link named "Hosting costs".
   4. Open `/home/hosting-costs`. Expect a redirect to `/home`, with no `hosting-costs-table`.

- [ ] **Step 2: Run against the stack**

Run with the sandbox disabled. The local Supabase must already be running with every migration applied; never reset it.

```bash
pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/finance
pnpm --filter web-e2e exec playwright test tests/dues tests/rbac tests/members
pnpm stack:down
```

Expected: all three finance specs pass, and the dues, rbac and members suites still pass. `pnpm stack:up` rebuilds the portal container from the working tree. Leave local Supabase running afterwards.

- [ ] **Step 3: Type-check and commit**

```bash
pnpm --filter web-e2e typecheck
pnpm exec oxfmt --check apps/e2e/tests/finance
git add apps/e2e/tests/finance
git commit -m "test(e2e): cover hosting costs and the financial dashboard"
```
