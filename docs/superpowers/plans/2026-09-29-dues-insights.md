# Dues Insights Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/home` into Overview, Collection, Lapses and Retention tabs. Between them, the tabs show collection progress, the next 12 months coming due, how long lapsed members have gone unpaid, and retention, all computed in Postgres.

**Architecture:** One additive migration adds `kit.*_at(p_today)` core functions and `public.finance_*` wrappers gated on `finance.view`. The same migration narrows `finance_follow_up` so it no longer lists lapsed members. `@kit/finance` gains types, pure transforms, service methods and components. `/home` renders the tab chosen by `?tab=` and fetches only that tab's data.

**Tech Stack:**
- Supabase Postgres 17 with pgTAP
- Next.js 16 App Router
- `@kit/ui`: Base UI shadcn, including `progress` and `chart` (Recharts)
- Vitest with jsdom
- Playwright

**Spec:** `docs/superpowers/specs/2026-09-29-dues-insights-design.md`

## Global Constraints

- **Local database:**
  - Never run `supabase db reset`.
  - Apply migrations with `pnpm exec supabase migration up`, from `apps/portal`.
  - Run the database tests with `pnpm exec supabase test db`, from `apps/portal`.
  - Docker, supabase and stack commands need the sandbox disabled.
- **pgTAP test files:**
  - Start each file with `\ir helpers/dues_fixtures.inc`, inside `begin; … rollback;`.
  - The fixtures provide `tests.make_user(email, role_slug)`, `tests.make_member(number, user)`, `tests.act_as(uid)` and `tests.act_as_service()`.
  - `administrator` has finance view and manage; `member` has neither.
- **Regenerating types:**
  1. Run `pnpm exec supabase gen types typescript --local --schema public`.
  2. Write the output into BOTH `apps/portal/lib/database.types.ts` and `packages/supabase/src/database.types.ts`.
  3. Re-add `__InternalSupabase`.
  4. Re-apply every `HAND-CORRECTED` block verbatim.
  5. Keep the two files byte-identical.
- **Dates:**
  - "Today" is the America/Chicago date: `kit.council_today()` in SQL, `chicagoToday()` from `@kit/dues/schemas` in TypeScript.
  - Fraternal year `Y` is `[Y-07-01, (Y+1)-07-01)`.
  - `paid_through` and `period_end` are exclusive.
- **Grace period:** 90 days. A renewal counts as kept when its period follows the lapsed one and its `received_on` is at most `period_end + 90`. A window counts as closed when `period_end + 90 < today`.
- **Honorary members** (`members.dues_level = 'honorary'`) are excluded from these figures:
  - expected and renewed counts;
  - renewal-rate eligibility;
  - new lapses.

  They are included in:
  - dollars collected;
  - the coming-due list and its dollars;
  - lapse aging and the lapsed list.
- **Functions:**
  - Every new function is `security definer set search_path = ''`.
  - `kit.*` cores: `revoke all … from public, anon, authenticated`.
  - `public.*` wrappers: `revoke all … from public, anon;`, then `grant execute … to authenticated`. Each wrapper calls `kit.assert_finance_view()` first.
- **Existing helpers:** `kit.member_dues_snapshot(p_today)`, `kit.dues_monthly(p_year)`, `kit.dues_collected(p_year)`, `kit.fraternal_year_of(date)`, `kit.assert_fraternal_year(int)`, `kit.council_today()` and `kit.assert_finance_view()`.
- **Test lock-in:** `kit_authenticated_grants.test.sql` pins the kit functions `authenticated` may run. New kit functions must not be granted to `authenticated`.
- **Graceful absence:** every new read goes through `readDuesIfDeployed` from `@kit/dues/lib/dues-schema`.
- **Permissions in the UI:** link member names only when the viewer has `members.view`.
- **Formatting:** no new oxfmt failures. 24 files already fail and are known.
- **Leave alone:** `.mcp.json`, `.claude/` and `apps/portal/supabase/snippets/` stay untouched and unstaged.

## Review Focus

1. **Late payment:** a member who pays 120 days late gets a period that starts at the old end, because periods are anchored to the previous one. Retention must count that member as lapsed, not kept. The rule therefore uses `received_on`, not `period_start`. Tested in Task 1 (r2 at +91 and r1 at +90).
2. **Brand-new member who never paid:** they appear in the lapsed list with days counted from `accepted_on`, and in collection progress as expected but not renewed. Tested in Task 1 (d30, d31 and c5).
3. **Invalid `?tab=`, `?month=` or `?year=` in the URL:** these fall back to Overview, to no selected month, or to the current year. The page never errors. Tested in Task 2 (`dashboard-tabs.test.ts`) and Task 4 (e2e `?tab=bogus`).
4. **Empty council, where every list and chart is empty:** each tab shows an empty message or "—" and never crashes. Tested in Task 2 (transforms given empty input) and Task 3 (component tests with empty props).
5. **Current fraternal year early on:** in the current year, figures for months after today are blank, not $0 and not a flat line, and renewal-rate windows that are still open are not counted. Tested in Task 1 (null `cumulativeCents` after today; r6 is excluded) and Task 2 (the running-total transform keeps `null`).

---

### Task 1: Dues insights SQL

**Files:**
- Create: `apps/portal/supabase/migrations/20260929130000_dues_insights.sql`
- Create: `apps/portal/supabase/tests/dues_insights.test.sql`
- Modify: `apps/portal/supabase/tests/finance_dashboard.test.sql` (assertion 34 only; see Step 1)
- Modify: both `database.types.ts` files (regenerated)
- Modify: `docs/superpowers/specs/2026-09-29-dues-insights-design.md` (Step 6)

**Interfaces:**
- **Consumes:** the existing helpers named in Global Constraints.
- **Produces (public):**
  - `finance_collection_progress(p_year integer) returns jsonb`. Shape: `{ expected, renewed, expectedCents, collectedCents, byMonth: [{ month, cents, cumulativeCents|null }] }`, with 12 entries.
  - `finance_renewals_forecast() returns table (month date, members integer, cents bigint)`, with 12 rows.
  - `finance_forecast_members(p_month date) returns table (member_id uuid, first_name text, last_name text, membership_number text, paid_through date, level_name text, amount_cents integer)`.
  - `finance_lapse_aging() returns table (bucket text, members integer, cents bigint)`. Always 4 rows, in the order `'1-30'`, `'31-90'`, `'91-180'`, `'181+'`.
  - `finance_lapsed_members() returns table (member_id uuid, first_name text, last_name text, membership_number text, days_unpaid integer, bucket text, level_name text, amount_cents integer, last_paid_on date)`.
  - `finance_retention() returns jsonb`. Shape: `{ years: [{ year, eligible, renewed }], lapsesByMonth: [{ month, lapses }] }`.
  - `finance_follow_up()`: same signature as before, but no longer lists lapsed members.
- **Produces (kit):**
  - `kit.collection_progress_at(integer, date)`
  - `kit.renewals_forecast_at(date)`
  - `kit.forecast_members_at(date, date)`
  - `kit.lapsed_members_at(date)`
  - `kit.lapse_aging_at(date)`
  - `kit.retention_at(date)`

- [ ] **Step 1: Write the failing pgTAP test and update the follow-up assertion**

In `apps/portal/supabase/tests/finance_dashboard.test.sql`, change assertion 34's expected array and description. Lapsed members leave the follow-up list:

```sql
  array['FS-DUE', 'FS-SOON'],
  'follow-up: due, then due within 30 days (lapsed members are on the Lapses tab)');
```

The new file freezes the database's "today" at `2040-10-15`, which is in fraternal year 2040. Real members' data doesn't reach these far-future dates, except for status counts, which include every member. Those counts are therefore asserted as the difference from a baseline taken just before each group of fixtures is added.

`apps/portal/supabase/tests/dues_insights.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select plan(33);

select tests.make_user('di-admin@example.com', 'administrator') as admin \gset
select tests.make_user('di-knight@example.com', 'member') as knight \gset

-- helper: a period ending on p_end (start = p_end - 365), as the superuser
create or replace function tests.di_period(p_member uuid, p_end date, p_received date,
  p_method public.dues_method default 'check', p_amount integer default 5000, p_level text default 'regular')
returns void language sql as $$
  insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
  values (p_member, p_level, case when p_method in ('waived','opening_balance') then 0 else p_amount end, p_method,
          case when p_method = 'check' then '1' end, p_received, p_end - 365, p_end);
$$;

------------------------------------------------------------------ collection progress (FY2040)
select kit.collection_progress_at(2040, '2040-10-15') as cbase \gset

select tests.make_member('DI-C1') as c1 \gset
select tests.make_member('DI-C2') as c2 \gset
select tests.make_member('DI-C3') as c3 \gset
select tests.make_member('DI-C4') as c4 \gset
select tests.make_member('DI-C5') as c5 \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'c3', 'honorary');
select public.set_member_accepted_on(:'c4', '2040-08-01');
select public.set_member_accepted_on(:'c5', '2040-09-01');
select tests.act_as_service();
-- c1: ends 2040-08-31 (FY2040), renewed by check received 2040-08-20
select tests.di_period(:'c1', '2040-08-31', '2039-09-01', 'waived');
insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
values (:'c1', 'regular', 5000, 'check', '2', '2040-08-20', '2040-08-31', '2040-08-31'::date + 365);
-- c2: ends 2041-03-01 (FY2040), not renewed
select tests.di_period(:'c2', '2041-03-01', '2040-03-01', 'waived');
-- c3 (honorary): ends 2040-08-14, renewed with cash 1900 on 2040-09-10
select tests.di_period(:'c3', '2040-08-14', '2039-08-14', 'waived');
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'c3', 'honorary', 1900, 'cash', '2040-09-10', '2040-08-14', '2040-08-14'::date + 365);
-- c4: first dues, paid online 5800 on 2040-08-05
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'c4', 'regular_contrib', 5800, 'online', '2040-08-05', '2040-08-01', '2040-08-01'::date + 365);
-- c5: first dues, unpaid

-- 1-6
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'expected')::int
          - (:'cbase'::jsonb ->> 'expected')::int, 4, 'expected: c1, c2, c4, c5 (honorary left out)');
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'renewed')::int
          - (:'cbase'::jsonb ->> 'renewed')::int, 2, 'renewed: c1 (next period) and c4 (first dues paid)');
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'expectedCents')::int
          - (:'cbase'::jsonb ->> 'expectedCents')::int, 23200, 'expected dollars: 4 x 5800 at the default level');
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'collectedCents')::int, 12700,
          'collected: 5000 + 5800 + honorary 1900 received in FY2040');
select is((select (e ->> 'cumulativeCents')::int
             from jsonb_array_elements(kit.collection_progress_at(2040, '2040-10-15') -> 'byMonth') e
            where e ->> 'month' = '2040-09-01'), 12700, 'running total through September');
select is((select e ->> 'cumulativeCents'
             from jsonb_array_elements(kit.collection_progress_at(2040, '2040-10-15') -> 'byMonth') e
            where e ->> 'month' = '2040-11-01'), null::text, 'months after today are blank in the current year');

------------------------------------------------------------------ coming due (from 2040-10-15)
select tests.make_member('DI-F1') as f1 \gset
select tests.make_member('DI-F2') as f2 \gset
select tests.make_member('DI-F3') as f3 \gset
select tests.make_member('DI-F4') as f4 \gset
select tests.di_period(:'f1', '2040-10-20', '2039-10-20', 'waived');
select tests.di_period(:'f2', '2040-10-10', '2039-10-10', 'waived');
select tests.di_period(:'f3', '2041-09-30', '2040-09-30', 'waived');
select tests.di_period(:'f4', '2041-10-01', '2040-10-01', 'waived');

-- 7-11
select is((select count(*)::int from kit.renewals_forecast_at('2040-10-15')), 12, 'twelve months');
select results_eq($$select min(month), max(month) from kit.renewals_forecast_at('2040-10-15')$$,
                  $$values ('2040-10-01'::date, '2041-09-01'::date)$$, 'from this month through eleven months on');
select is((select array_agg(membership_number order by membership_number) from kit.forecast_members_at('2040-10-01', '2040-10-15')
            where membership_number like 'DI-F%'), array['DI-F1'], 'October: due later this month, not the one already lapsed');
select is((select array_agg(membership_number) from kit.forecast_members_at('2041-09-01', '2040-10-15')
            where membership_number like 'DI-F%'), array['DI-F3'], 'the twelfth month is included');
select is((select count(*)::int from kit.forecast_members_at('2041-10-01', '2040-10-15')
            where membership_number like 'DI-F%'), 0, 'the thirteenth month is not part of the forecast');

------------------------------------------------------------------ lapse aging (as of 2040-10-15)
select tests.act_as_service();
create temp table di_aging_base as select * from kit.lapse_aging_at('2040-10-15');

select tests.make_member('DI-A30') as a30 \gset
select tests.make_member('DI-A31') as a31 \gset
select tests.make_member('DI-A90') as a90 \gset
select tests.make_member('DI-A91') as a91 \gset
select tests.make_member('DI-A180') as a180 \gset
select tests.make_member('DI-A181') as a181 \gset
select tests.make_member('DI-D30') as d30 \gset
select tests.make_member('DI-D31') as d31 \gset
-- paid_through = today - days + 1
select tests.di_period(:'a30',  '2040-10-15'::date - 29,  '2039-01-01', 'waived');
select tests.di_period(:'a31',  '2040-10-15'::date - 30,  '2039-01-01', 'waived');
select tests.di_period(:'a90',  '2040-10-15'::date - 89,  '2039-01-01', 'waived');
select tests.di_period(:'a91',  '2040-10-15'::date - 90,  '2039-01-01', 'waived');
select tests.di_period(:'a180', '2040-10-15'::date - 179, '2039-01-01', 'waived');
select tests.di_period(:'a181', '2040-10-15'::date - 180, '2039-01-01', 'waived');
select tests.act_as(:'admin');
select public.set_member_accepted_on(:'d30', '2040-10-15'::date - 29);
select public.set_member_accepted_on(:'d31', '2040-10-15'::date - 30);
select tests.act_as_service();

-- 12-17
select results_eq(
  $$select membership_number, days_unpaid, bucket from kit.lapsed_members_at('2040-10-15')
     where membership_number in ('DI-A30','DI-A31','DI-A90','DI-A91','DI-A180','DI-A181','DI-D30','DI-D31')
     order by days_unpaid, membership_number$$,
  $$values ('DI-A30', 30, '1-30'), ('DI-D30', 30, '1-30'), ('DI-A31', 31, '31-90'), ('DI-D31', 31, '31-90'),
           ('DI-A90', 90, '31-90'), ('DI-A91', 91, '91-180'), ('DI-A180', 180, '91-180'), ('DI-A181', 181, '181+')$$,
  'days unpaid count the paid-through (or accepted-on) day as day 1, and bucket edges are exact');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '1-30')
          - (select members from di_aging_base where bucket = '1-30'), 2, 'bucket 1-30 +2');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '31-90')
          - (select members from di_aging_base where bucket = '31-90'), 3, 'bucket 31-90 +3');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '91-180')
          - (select members from di_aging_base where bucket = '91-180'), 2, 'bucket 91-180 +2');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '181+')
          - (select members from di_aging_base where bucket = '181+'), 1, 'bucket 181+ +1');
select is((select array_agg(bucket order by ord) from kit.lapse_aging_at('2040-10-15') with ordinality as t(bucket, members, cents, ord)),
          array['1-30', '31-90', '91-180', '181+'], 'four buckets in order');

-- 18
select is((select last_paid_on from kit.lapsed_members_at('2040-10-15') where membership_number = 'DI-A30'),
           '2039-01-01'::date, 'last payment date is the latest received date');

------------------------------------------------------------------ retention (as of 2040-10-15)
select kit.retention_at('2040-10-15') as rbase \gset

select tests.make_member('DI-R1') as r1 \gset
select tests.make_member('DI-R2') as r2 \gset
select tests.make_member('DI-R3') as r3 \gset
select tests.make_member('DI-R4') as r4 \gset
select tests.make_member('DI-R5') as r5 \gset
select tests.make_member('DI-R6') as r6 \gset
select tests.make_member('DI-R7') as r7 \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'r5', 'honorary');
select tests.act_as_service();
-- FY2038 endings on 2038-09-01; grace closes 2038-11-30
select tests.di_period(:'r1', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r2', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r3', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r4', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r5', '2038-09-01', '2037-09-01', 'waived');
-- r1 renews on day +90, r2 on day +91 (period still anchored at the old end), r3 early
select tests.di_period(:'r1', '2039-09-01', '2038-11-30');
select tests.di_period(:'r2', '2039-09-01', '2038-12-01');
select tests.di_period(:'r3', '2039-09-01', '2038-08-01');
-- current year: r6 ends 2040-08-01 (window still open), r7 ends 2040-07-10 (closed 2040-10-08), no renewal
select tests.di_period(:'r6', '2040-08-01', '2039-08-01', 'waived');
select tests.di_period(:'r7', '2040-07-10', '2039-07-10', 'waived');

-- 19-24
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2038)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase'::jsonb -> 'years') y where (y ->> 'year')::int = 2038),
          4, 'FY2038 eligible: r1-r4 (honorary r5 left out)');
select is((select (y ->> 'renewed')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2038)
          - (select (y ->> 'renewed')::int from jsonb_array_elements(:'rbase'::jsonb -> 'years') y where (y ->> 'year')::int = 2038),
          2, 'FY2038 renewed: r1 at +90 and r3 early; r2 at +91 is a lapse');
select is((select (m ->> 'lapses')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'lapsesByMonth') m where m ->> 'month' = '2038-11-01')
          - (select (m ->> 'lapses')::int from jsonb_array_elements(:'rbase'::jsonb -> 'lapsesByMonth') m where m ->> 'month' = '2038-11-01'),
          2, 'November 2038 lapses: r2 and r4');
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2040)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase'::jsonb -> 'years') y where (y ->> 'year')::int = 2040),
          1, 'current year counts only closed windows: r7, not r6');
select is((select count(*)::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years')), 5, 'five fraternal years');
select is((select min((y ->> 'year')::int) from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y), 2036,
          'years 2036 to 2040');

------------------------------------------------------------------ public wrappers
-- 25-30 refused without finance.view
select tests.act_as(:'knight');
select throws_ok($$select public.finance_collection_progress(2026)$$, '42501', 'forbidden', 'member: collection progress refused');
select throws_ok($$select * from public.finance_renewals_forecast()$$, '42501', 'forbidden', 'member: forecast refused');
select throws_ok($$select * from public.finance_forecast_members(date_trunc('month', now())::date)$$, '42501', 'forbidden', 'member: forecast members refused');
select throws_ok($$select * from public.finance_lapse_aging()$$, '42501', 'forbidden', 'member: aging refused');
select throws_ok($$select * from public.finance_lapsed_members()$$, '42501', 'forbidden', 'member: lapsed list refused');
select throws_ok($$select public.finance_retention()$$, '42501', 'forbidden', 'member: retention refused');

-- 31-33 validation and a working call
select tests.act_as(:'admin');
select throws_ok($$select public.finance_collection_progress(1999)$$, 'P0001', 'unknown fraternal year: 1999', 'year validated');
select throws_ok($$select * from public.finance_forecast_members('2026-10-15')$$, 'P0001', 'unknown forecast month: 2026-10-15',
                 'month must be the first of a month');
select lives_ok($$select * from public.finance_lapse_aging()$$, 'admin can read aging');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

From `apps/portal`, with the sandbox disabled, run `pnpm exec supabase test db`.

Expected: `dues_insights.test.sql` fails with `function kit.collection_progress_at(integer, unknown) does not exist`. `finance_dashboard.test.sql` fails assertion 34, because `FS-HON` and `FS-LAPSED` are still listed.

- [ ] **Step 3: Write the migration**

Create `apps/portal/supabase/migrations/20260929130000_dues_insights.sql`:

```sql
-- Dues insights: collection progress, coming due, lapse aging and retention.
-- Grace period: a renewal is kept when the next period's received_on is at
-- most period_end + 90 (periods are anchored at the previous end, so
-- period_start cannot tell a late payment from an on-time one). A window is
-- closed once period_end + 90 < today. Honorary members are left out of
-- counts and rates; they stay in dollars, coming due and aging.

create or replace function kit.collection_progress_at(p_year integer, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with bounds as (
    select make_date(p_year, 7, 1) as ys, make_date(p_year + 1, 7, 1) as ye
  ),
  ended as (
    select distinct on (p.member_id) p.member_id, p.period_end
      from public.dues_periods p
      join public.members m on m.id = p.member_id
      cross join bounds b
     where p.voided_at is null
       and m.dues_level <> 'honorary'
       and p.period_end >= b.ys and p.period_end < b.ye
     order by p.member_id, p.period_end desc
  ),
  first_due as (
    select m.id as member_id,
           exists (select 1 from public.dues_periods q where q.member_id = m.id and q.voided_at is null) as paid
      from public.members m cross join bounds b
     where m.dues_level <> 'honorary'
       and m.accepted_on is not null
       and m.id not in (select member_id from ended)
       and (
         (m.accepted_on >= b.ys and m.accepted_on < b.ye)
         or (m.accepted_on < b.ys
             and not exists (select 1 from public.dues_periods q where q.member_id = m.id and q.voided_at is null))
       )
  ),
  expected as (
    select e.member_id,
           exists (select 1 from public.dues_periods q
                    where q.member_id = e.member_id and q.voided_at is null and q.period_start >= e.period_end) as renewed
      from ended e
    union all
    select f.member_id, f.paid from first_due f
  ),
  months as (
    -- the running total is computed here: a window call cannot sit inside jsonb_agg
    select d.month,
           d.online_cents + d.check_cents + d.cash_cents as cents,
           sum(d.online_cents + d.check_cents + d.cash_cents) over (order by d.month) as cumulative
      from kit.dues_monthly(p_year) d
  )
  select jsonb_build_object(
    'expected', (select count(*) from expected),
    'renewed', (select count(*) from expected where renewed),
    'expectedCents', (select coalesce(sum(l.amount_cents), 0)
                        from expected x
                        join public.members m on m.id = x.member_id
                        join public.dues_levels l on l.slug = m.dues_level),
    'collectedCents', kit.dues_collected(p_year),
    'byMonth', (
      select jsonb_agg(jsonb_build_object(
               'month', mo.month,
               'cents', mo.cents,
               'cumulativeCents', case when mo.month > p_today then null else mo.cumulative end)
             order by mo.month)
        from months mo)
  );
$$;

create or replace function kit.renewals_forecast_rows_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer, month date)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number, s.paid_through,
         s.level_name, s.amount_cents, date_trunc('month', s.paid_through)::date
    from kit.member_dues_snapshot(p_today) s
   where s.paid_through > p_today
     and s.paid_through < (date_trunc('month', p_today) + interval '12 months')::date;
$$;

create or replace function kit.renewals_forecast_at(p_today date)
returns table (month date, members integer, cents bigint)
language sql stable security definer set search_path = '' as $$
  select m.month,
         count(r.member_id)::integer,
         coalesce(sum(r.amount_cents), 0)::bigint
    from (select (date_trunc('month', p_today) + make_interval(months => i))::date as month
            from generate_series(0, 11) as i) m
    left join kit.renewals_forecast_rows_at(p_today) r on r.month = m.month
   group by m.month
   order by m.month;
$$;

create or replace function kit.forecast_members_at(p_month date, p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select r.member_id, r.first_name, r.last_name, r.membership_number, r.paid_through, r.level_name, r.amount_cents
    from kit.renewals_forecast_rows_at(p_today) r
   where r.month = p_month
   order by r.paid_through, r.last_name, r.first_name;
$$;

create or replace function kit.lapsed_members_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               days_unpaid integer, bucket text, level_name text, amount_cents integer, last_paid_on date)
language sql stable security definer set search_path = '' as $$
  with base as (
    select s.*, m.accepted_on,
           greatest(1, case when s.paid_through is not null then p_today - s.paid_through + 1
                            else p_today - m.accepted_on + 1 end) as days
      from kit.member_dues_snapshot(p_today) s
      join public.members m on m.id = s.member_id
     where s.dues_status in ('lapsed', 'due')
  )
  select b.member_id, b.first_name, b.last_name, b.membership_number, b.days,
         case when b.days <= 30 then '1-30' when b.days <= 90 then '31-90'
              when b.days <= 180 then '91-180' else '181+' end,
         b.level_name, b.amount_cents,
         (select max(q.received_on) from public.dues_periods q where q.member_id = b.member_id and q.voided_at is null)
    from base b
   order by b.days desc, b.last_name, b.first_name;
$$;

create or replace function kit.lapse_aging_at(p_today date)
returns table (bucket text, members integer, cents bigint)
language sql stable security definer set search_path = '' as $$
  select k.bucket,
         count(l.member_id)::integer,
         coalesce(sum(l.amount_cents), 0)::bigint
    from (values (1, '1-30'), (2, '31-90'), (3, '91-180'), (4, '181+')) as k(ord, bucket)
    left join kit.lapsed_members_at(p_today) l on l.bucket = k.bucket
   group by k.ord, k.bucket
   order by k.ord;
$$;

create or replace function kit.retention_at(p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select kit.fraternal_year_of(p_today) as y),
  periods as (
    -- every closed grace window of a non-honorary member, and whether it was renewed in time
    select p.member_id, p.period_end,
           exists (select 1 from public.dues_periods q
                    where q.member_id = p.member_id and q.voided_at is null
                      and q.period_start >= p.period_end
                      and q.received_on <= p.period_end + 90) as kept
      from public.dues_periods p
      join public.members m on m.id = p.member_id
     where p.voided_at is null
       and m.dues_level <> 'honorary'
       and p.period_end + 90 < p_today
  ),
  latest_per_year as (
    select distinct on (pe.member_id, kit.fraternal_year_of(pe.period_end))
           kit.fraternal_year_of(pe.period_end) as year, pe.kept
      from periods pe
     order by pe.member_id, kit.fraternal_year_of(pe.period_end), pe.period_end desc
  )
  select jsonb_build_object(
    'years', (
      select jsonb_agg(jsonb_build_object(
               'year', g.y,
               'eligible', (select count(*) from latest_per_year l where l.year = g.y),
               'renewed', (select count(*) from latest_per_year l where l.year = g.y and l.kept))
             order by g.y)
        from cur c cross join lateral generate_series(c.y - 4, c.y) as g(y)),
    'lapsesByMonth', (
      select jsonb_agg(jsonb_build_object(
               'month', mo.month,
               'lapses', (select count(*) from periods pe
                           where not pe.kept
                             and date_trunc('month', pe.period_end + 90)::date = mo.month))
             order by mo.month)
        from cur c
        cross join lateral (
          select gs::date as month
            from generate_series(make_date(c.y - 4, 7, 1), date_trunc('month', p_today)::date, interval '1 month') gs
        ) mo)
  );
$$;

-- Follow-up now lists only due members and those due within 30 days;
-- lapsed members moved to the Lapses tab. Same signature.
create or replace function kit.finance_follow_up_at(p_today date)
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number,
         s.dues_status, s.paid_through, s.level_name, s.amount_cents
    from kit.member_dues_snapshot(p_today) s
   where s.dues_status = 'due'
      or (s.dues_status = 'due_soon' and s.paid_through <= p_today + 30)
   order by case s.dues_status when 'due' then 0 else 1 end,
            s.paid_through nulls last, s.last_name, s.first_name;
$$;

revoke all on function kit.collection_progress_at(integer, date) from public, anon, authenticated;
revoke all on function kit.renewals_forecast_rows_at(date) from public, anon, authenticated;
revoke all on function kit.renewals_forecast_at(date) from public, anon, authenticated;
revoke all on function kit.forecast_members_at(date, date) from public, anon, authenticated;
revoke all on function kit.lapsed_members_at(date) from public, anon, authenticated;
revoke all on function kit.lapse_aging_at(date) from public, anon, authenticated;
revoke all on function kit.retention_at(date) from public, anon, authenticated;
revoke all on function kit.finance_follow_up_at(date) from public, anon, authenticated;

create or replace function public.finance_collection_progress(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  perform kit.assert_fraternal_year(p_year);
  return kit.collection_progress_at(p_year, kit.council_today());
end $$;

create or replace function public.finance_renewals_forecast()
returns table (month date, members integer, cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.renewals_forecast_at(kit.council_today());
end $$;

create or replace function public.finance_forecast_members(p_month date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_first date := date_trunc('month', kit.council_today())::date;
begin
  perform kit.assert_finance_view();
  if p_month is null or p_month <> date_trunc('month', p_month)::date
     or p_month < v_first or p_month > (v_first + interval '11 months')::date then
    raise exception 'unknown forecast month: %', coalesce(p_month::text, '(none)');
  end if;
  return query select * from kit.forecast_members_at(p_month, kit.council_today());
end $$;

create or replace function public.finance_lapse_aging()
returns table (bucket text, members integer, cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.lapse_aging_at(kit.council_today());
end $$;

create or replace function public.finance_lapsed_members()
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               days_unpaid integer, bucket text, level_name text, amount_cents integer, last_paid_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.lapsed_members_at(kit.council_today());
end $$;

create or replace function public.finance_retention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return kit.retention_at(kit.council_today());
end $$;

revoke all on function public.finance_collection_progress(integer) from public, anon;
revoke all on function public.finance_renewals_forecast() from public, anon;
revoke all on function public.finance_forecast_members(date) from public, anon;
revoke all on function public.finance_lapse_aging() from public, anon;
revoke all on function public.finance_lapsed_members() from public, anon;
revoke all on function public.finance_retention() from public, anon;
grant execute on function public.finance_collection_progress(integer) to authenticated;
grant execute on function public.finance_renewals_forecast() to authenticated;
grant execute on function public.finance_forecast_members(date) to authenticated;
grant execute on function public.finance_lapse_aging() to authenticated;
grant execute on function public.finance_lapsed_members() to authenticated;
grant execute on function public.finance_retention() to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

From `apps/portal`, with the sandbox disabled, run `pnpm exec supabase migration up && pnpm exec supabase test db`.

Expected: all 33 new tests pass, and every earlier test passes, including the amended assertion 34 and `kit_authenticated_grants.test.sql`.

If a value differs, first check the migration against the rule in this plan. Change a test value only when the plan's arithmetic was wrong, and show the corrected arithmetic in your report.

If you need to re-apply the migration, run `docker exec -i supabase_db_next-supabase-saas-kit-turbo-lite psql -U postgres -v ON_ERROR_STOP=1 < <file>`. This is safe because every statement in the file is `create or replace`.

- [ ] **Step 5: Regenerate the types**

Follow the Global Constraints rules. Then add a `HAND-CORRECTED` block, in both files, that sets these to `string | null`:
- `last_paid_on` in `finance_lapsed_members` Returns;
- `paid_through` in `finance_forecast_members` Returns.

`finance_collection_progress` and `finance_retention` return `Json`. Run `cmp` on the two files and expect no output.

- [ ] **Step 6: Amend the spec**

In `docs/superpowers/specs/2026-09-29-dues-insights-design.md`, under "Retention", replace the numerator bullet with:

> Numerator: those with a later active period (`period_start ≥ period_end`) whose `received_on ≤ period_end + 90`. Periods are anchored at the previous end, so the received date, not the start date, tells a late payment from an on-time one. Early renewals count.

Then change the closed-window wording from `period_end + 90 ≤ today` to `period_end + 90 < today`. On day +90 itself the member can still pay.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/supabase/migrations/20260929130000_dues_insights.sql \
  apps/portal/supabase/tests/dues_insights.test.sql apps/portal/supabase/tests/finance_dashboard.test.sql \
  apps/portal/lib/database.types.ts packages/supabase/src/database.types.ts \
  docs/superpowers/specs/2026-09-29-dues-insights-design.md
git commit -m "feat(finance): compute dues insights in Postgres"
```

---

### Task 2: `@kit/finance` types, parsing, transforms and service methods

**Files:**
- Modify: `packages/features/finance/src/types.ts`
- Create: `packages/features/finance/src/lib/dashboard-tabs.ts` and `dashboard-tabs.test.ts`
- Create: `packages/features/finance/src/lib/insights-data.ts` and `insights-data.test.ts`
- Modify: `packages/features/finance/src/server/finance.service.ts`
- Create: `packages/features/finance/src/server/finance.insights.test.ts`

**Interfaces:**
- **Consumes:** the Task 1 RPCs, through `Database`.
- **Produces:**
  - Types: `DashboardTab`, `CollectionProgress`, `ForecastMonth`, `ForecastMember`, `AgingBucket`, `LapsedMember` and `Retention`, exactly as in Step 3.
  - `DASHBOARD_TABS`, `parseTab(raw)` and `parseMonthParam(raw, today)`.
  - The transforms `progressLabel`, `toRunningTotalData`, `toForecastChartData`, `toAgingChartData`, `toRetentionRateData` and `toLapsesByMonthData`, plus the `BUCKET_LABELS` map.
  - `FinanceService` methods: `collectionProgress(year)`, `renewalsForecast()`, `forecastMembers(month)`, `lapseAging()`, `lapsedMembers()` and `retention()`.

- [ ] **Step 1: Write the failing tests**

`packages/features/finance/src/lib/dashboard-tabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DASHBOARD_TABS, parseMonthParam, parseTab } from './dashboard-tabs';

describe('parseTab', () => {
  it('accepts the four tabs', () => {
    expect(DASHBOARD_TABS).toEqual(['overview', 'collection', 'lapses', 'retention']);
    expect(parseTab('lapses')).toBe('lapses');
    expect(parseTab(['retention', 'x'])).toBe('retention');
  });

  it('falls back to overview', () => {
    expect(parseTab(undefined)).toBe('overview');
    expect(parseTab('bogus')).toBe('overview');
    expect(parseTab('')).toBe('overview');
  });
});

describe('parseMonthParam', () => {
  const today = '2040-10-15';

  it('accepts the first of a month in the next twelve months', () => {
    expect(parseMonthParam('2040-10-01', today)).toBe('2040-10-01');
    expect(parseMonthParam('2041-09-01', today)).toBe('2041-09-01');
  });

  it('rejects anything else', () => {
    expect(parseMonthParam(undefined, today)).toBeNull();
    expect(parseMonthParam('2040-10-15', today)).toBeNull();
    expect(parseMonthParam('2041-10-01', today)).toBeNull();
    expect(parseMonthParam('2040-09-01', today)).toBeNull();
    expect(parseMonthParam('2040-13-01', today)).toBeNull();
  });
});
```

`packages/features/finance/src/lib/insights-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  BUCKET_LABELS,
  progressLabel,
  toAgingChartData,
  toForecastChartData,
  toLapsesByMonthData,
  toRetentionRateData,
  toRunningTotalData,
} from './insights-data';

describe('insights data', () => {
  it('labels progress', () => {
    expect(progressLabel(0, 0)).toBe('—');
    expect(progressLabel(2, 4)).toBe('50%');
  });

  it('keeps blank future months in the running total', () => {
    expect(
      toRunningTotalData(
        [
          { month: '2040-07-01', cents: 0, cumulativeCents: 0 },
          { month: '2040-08-01', cents: 10800, cumulativeCents: 10800 },
          { month: '2040-11-01', cents: 0, cumulativeCents: null },
        ],
        23200,
      ),
    ).toEqual([
      { month: 'Jul', collected: 0, expected: 232 },
      { month: 'Aug', collected: 108, expected: 232 },
      { month: 'Nov', collected: null, expected: 232 },
    ]);
    expect(toRunningTotalData([], 0)).toEqual([]);
  });

  it('labels forecast months with the year and keeps the key', () => {
    expect(toForecastChartData([{ month: '2041-01-01', members: 3, cents: 17400 }])).toEqual([
      { key: '2041-01-01', month: "Jan '41", members: 3, dollars: 174 },
    ]);
  });

  it('maps buckets to readable labels', () => {
    expect(BUCKET_LABELS['181+']).toBe('181+ days');
    expect(toAgingChartData([{ bucket: '1-30', members: 2, cents: 11600 }])).toEqual([
      { bucket: '1–30 days', members: 2, dollars: 116 },
    ]);
  });

  it('computes renewal rates and leaves empty years blank', () => {
    expect(
      toRetentionRateData([
        { year: 2038, eligible: 4, renewed: 2 },
        { year: 2039, eligible: 0, renewed: 0 },
      ]),
    ).toEqual([
      { year: '2038–39', rate: 50, eligible: 4, renewed: 2 },
      { year: '2039–40', rate: null, eligible: 0, renewed: 0 },
    ]);
  });

  it('labels lapse months', () => {
    expect(toLapsesByMonthData([{ month: '2038-11-01', lapses: 2 }])).toEqual([{ month: "Nov '38", lapses: 2 }]);
  });
});
```

`packages/features/finance/src/server/finance.insights.test.ts` is a service test with a fake client. It pins the jsonb and row shapes that Task 1 returns.

```ts
import { describe, expect, it, vi } from 'vitest';

import { FinanceService } from './finance.service';

function clientReturning(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { client: { rpc } as never, rpc };
}

describe('FinanceService insights', () => {
  it('passes collection progress through', async () => {
    const progress = {
      expected: 4, renewed: 2, expectedCents: 23200, collectedCents: 12700,
      byMonth: [{ month: '2040-07-01', cents: 0, cumulativeCents: 0 }],
    };
    const { client, rpc } = clientReturning(progress);
    await expect(new FinanceService(client).collectionProgress(2040)).resolves.toEqual(progress);
    expect(rpc).toHaveBeenCalledWith('finance_collection_progress', { p_year: 2040 });
  });

  it('maps lapsed members', async () => {
    const { client } = clientReturning([
      { member_id: 'm1', first_name: 'A', last_name: 'B', membership_number: '1', days_unpaid: 31,
        bucket: '31-90', level_name: 'Regular', amount_cents: 5000, last_paid_on: null },
    ]);
    await expect(new FinanceService(client).lapsedMembers()).resolves.toEqual([
      { memberId: 'm1', firstName: 'A', lastName: 'B', membershipNumber: '1', daysUnpaid: 31,
        bucket: '31-90', levelName: 'Regular', amountCents: 5000, lastPaidOn: null },
    ]);
  });

  it('requests forecast members for a month', async () => {
    const { client, rpc } = clientReturning([]);
    await new FinanceService(client).forecastMembers('2040-10-01');
    expect(rpc).toHaveBeenCalledWith('finance_forecast_members', { p_month: '2040-10-01' });
  });

  it('throws the raw error so its code survives', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } });
    await expect(new FinanceService({ rpc } as never).retention()).rejects.toMatchObject({ code: 'PGRST202' });
  });
});
```

From the repo root, run `pnpm --filter @kit/finance test:unit`. Expected: FAIL, because the modules and methods don't exist yet.

- [ ] **Step 2: Add the types**

Append to `packages/features/finance/src/types.ts`:

```ts
export type DashboardTab = 'overview' | 'collection' | 'lapses' | 'retention';

export interface CollectionProgress {
  expected: number;
  renewed: number;
  expectedCents: number;
  collectedCents: number;
  byMonth: { month: string; cents: number; cumulativeCents: number | null }[];
}

export interface ForecastMonth {
  month: string;
  members: number;
  cents: number;
}

export interface ForecastMember {
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  paidThrough: string | null;
  levelName: string;
  amountCents: number;
}

export type AgingBucketKey = '1-30' | '31-90' | '91-180' | '181+';

export interface AgingBucket {
  bucket: AgingBucketKey;
  members: number;
  cents: number;
}

export interface LapsedMember {
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  daysUnpaid: number;
  bucket: AgingBucketKey;
  levelName: string;
  amountCents: number;
  lastPaidOn: string | null;
}

export interface Retention {
  years: { year: number; eligible: number; renewed: number }[];
  lapsesByMonth: { month: string; lapses: number }[];
}
```

- [ ] **Step 3: Implement the parsing and transforms**

`packages/features/finance/src/lib/dashboard-tabs.ts`:

```ts
import type { DashboardTab } from '../types';

export const DASHBOARD_TABS: readonly DashboardTab[] = ['overview', 'collection', 'lapses', 'retention'];

export function parseTab(raw: string | string[] | undefined): DashboardTab {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return (DASHBOARD_TABS as readonly string[]).includes(value ?? '') ? (value as DashboardTab) : 'overview';
}

/** `?month=` -> the first of a month from this month through eleven months
 * on (matches finance_forecast_members), or null. `today` is the Chicago date. */
export function parseMonthParam(raw: string | string[] | undefined, today: string): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) {
    return null;
  }

  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const [vy, vm] = value.split('-').map(Number) as [number, number];
  const offset = vy * 12 + vm - (ty * 12 + tm);

  return offset >= 0 && offset <= 11 ? value : null;
}
```

`packages/features/finance/src/lib/insights-data.ts`:

```ts
import { fraternalYearLabel } from './fraternal-year';
import { monthLabel } from './chart-data';
import type { AgingBucket, AgingBucketKey, CollectionProgress, ForecastMonth, Retention } from '../types';

const dollars = (cents: number) => cents / 100;

export const BUCKET_LABELS: Record<AgingBucketKey, string> = {
  '1-30': '1–30 days',
  '31-90': '31–90 days',
  '91-180': '91–180 days',
  '181+': '181+ days',
};

export function progressLabel(renewed: number, expected: number): string {
  return expected === 0 ? '—' : `${Math.round((renewed / expected) * 100)}%`;
}

export function toRunningTotalData(rows: CollectionProgress['byMonth'], expectedCents: number) {
  return rows.map((r) => ({
    month: monthLabel(r.month),
    collected: r.cumulativeCents === null ? null : dollars(r.cumulativeCents),
    expected: dollars(expectedCents),
  }));
}

function monthYearLabel(iso: string): string {
  return `${monthLabel(iso)} '${iso.slice(2, 4)}`;
}

export function toForecastChartData(rows: ForecastMonth[]) {
  return rows.map((r) => ({ key: r.month, month: monthYearLabel(r.month), members: r.members, dollars: dollars(r.cents) }));
}

export function toAgingChartData(rows: AgingBucket[]) {
  return rows.map((r) => ({ bucket: BUCKET_LABELS[r.bucket], members: r.members, dollars: dollars(r.cents) }));
}

export function toRetentionRateData(rows: Retention['years']) {
  return rows.map((r) => ({
    year: fraternalYearLabel(r.year),
    rate: r.eligible === 0 ? null : Math.round((r.renewed / r.eligible) * 100),
    eligible: r.eligible,
    renewed: r.renewed,
  }));
}

export function toLapsesByMonthData(rows: Retention['lapsesByMonth']) {
  return rows.map((r) => ({ month: monthYearLabel(r.month), lapses: r.lapses }));
}
```

- [ ] **Step 4: Add the service methods**

Add these methods to `FinanceService` in `packages/features/finance/src/server/finance.service.ts`, and add the Task 2 types to its type import. If the generated types report `members` or `cents` as `number`, `Number(...)` is a harmless no-op.

```ts
  async collectionProgress(year: number): Promise<CollectionProgress> {
    const { data, error } = await this.client.rpc('finance_collection_progress', { p_year: year });
    if (error) throw error;
    return data as unknown as CollectionProgress;
  }

  async renewalsForecast(): Promise<ForecastMonth[]> {
    const { data, error } = await this.client.rpc('finance_renewals_forecast');
    if (error) throw error;
    return (data ?? []).map((r) => ({ month: r.month, members: Number(r.members), cents: Number(r.cents) }));
  }

  async forecastMembers(month: string): Promise<ForecastMember[]> {
    const { data, error } = await this.client.rpc('finance_forecast_members', { p_month: month });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      paidThrough: r.paid_through,
      levelName: r.level_name,
      amountCents: r.amount_cents,
    }));
  }

  async lapseAging(): Promise<AgingBucket[]> {
    const { data, error } = await this.client.rpc('finance_lapse_aging');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      bucket: r.bucket as AgingBucketKey,
      members: Number(r.members),
      cents: Number(r.cents),
    }));
  }

  async lapsedMembers(): Promise<LapsedMember[]> {
    const { data, error } = await this.client.rpc('finance_lapsed_members');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      daysUnpaid: r.days_unpaid,
      bucket: r.bucket as AgingBucketKey,
      levelName: r.level_name,
      amountCents: r.amount_cents,
      lastPaidOn: r.last_paid_on,
    }));
  }

  async retention(): Promise<Retention> {
    const { data, error } = await this.client.rpc('finance_retention');
    if (error) throw error;
    return data as unknown as Retention;
  }
```

- [ ] **Step 5: Run the tests and checks**

From the repo root:

```bash
pnpm --filter @kit/finance test:unit
pnpm typecheck
pnpm lint
pnpm exec oxfmt --check packages/features/finance
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/features/finance
git commit -m "feat(finance): add dues insights types, transforms and service methods"
```

---

### Task 3: Tabs on `/home` and the three new tabs

**Files:**
- Create: `packages/features/finance/src/components/dashboard-tabs-nav.tsx`
- Create: `packages/features/finance/src/components/insights-charts.tsx` (`'use client'`)
- Create: `packages/features/finance/src/components/collection-tab.tsx`
- Create: `packages/features/finance/src/components/lapses-tab.tsx`
- Create: `packages/features/finance/src/components/retention-tab.tsx`
- Create: `packages/features/finance/src/components/insights-tabs.test.tsx`
- Modify: `apps/portal/app/home/page.tsx`

**Interfaces:**
- **Consumes (Task 2):** the service methods, types, parsers and transforms.
- **Consumes (existing):**
  - `YearPicker`, `HeadlineCards` and `FollowUpTable`;
  - `DuesByMonthChart`, `StatusChart`, `NetByYearChart` and `HostingByMonthChart`;
  - `PaymentsToCheckTable` and `MemberHome`;
  - `formatAmountCents` from `@kit/dues/lib/format-amount`;
  - `featuresFlagConfig.enableHostingCosts`.
- **Produces these `data-test` hooks for Task 4:**
  - `dashboard-tabs` and `dashboard-tab-<name>`, with `aria-current="page"` on the active tab;
  - `collection-progress`, `collection-collected`, `collection-expected`, `collection-running-total`, `collection-forecast`, `collection-forecast-members` and `collection-forecast-row`;
  - `lapses-bucket-<key>` (the keys are `1-30`, `31-90`, `91-180` and `181+`), `lapses-aging-chart`, `lapsed-members` and `lapsed-member-row`;
  - `retention-rate-chart` and `retention-lapses-chart`;
  - `insights-unavailable`.

Before writing anything, read these files:
- `packages/features/finance/src/components/finance-charts.tsx`, for the Recharts/ChartContainer pattern and `moneyTooltipFormatter`;
- `follow-up-table.tsx`, for the table and link patterns;
- `year-picker.tsx`;
- `packages/ui/src/shadcn/progress.tsx`, for the `Progress` props.

Reuse those patterns and imports.

- [ ] **Step 1: Write the failing component tests**

Write `packages/features/finance/src/components/insights-tabs.test.tsx`. The jsdom environment and cleanup are already configured in `packages/features/finance/test/setup.ts`.

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(),
}));

// Recharts needs real layout; these tests cover the cards, lists and links around the charts.
vi.mock('./insights-charts', () => ({
  AgingChart: () => null,
  RunningTotalChart: () => null,
  ForecastChart: () => null,
  RetentionRateChart: () => null,
  LapsesByMonthChart: () => null,
}));

import { DashboardTabsNav } from './dashboard-tabs-nav';
import { LapsesTab } from './lapses-tab';
import { CollectionSummary } from './collection-tab';

describe('DashboardTabsNav', () => {
  it('marks the active tab and links each tab', () => {
    const { container } = render(<DashboardTabsNav active="lapses" />);
    const active = container.querySelector('[data-test="dashboard-tab-lapses"]');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-test="dashboard-tab-retention"]')?.getAttribute('href')).toBe('/home?tab=retention');
  });
});

describe('LapsesTab', () => {
  const buckets = [
    { bucket: '1-30' as const, members: 0, cents: 0 },
    { bucket: '31-90' as const, members: 1, cents: 5000 },
    { bucket: '91-180' as const, members: 0, cents: 0 },
    { bucket: '181+' as const, members: 0, cents: 0 },
  ];

  it('shows each bucket and the list', () => {
    const { container } = render(
      <LapsesTab
        buckets={buckets}
        members={[{ memberId: 'm1', firstName: 'A', lastName: 'B', membershipNumber: '1', daysUnpaid: 31,
          bucket: '31-90', levelName: 'Regular', amountCents: 5000, lastPaidOn: null }]}
        canOpenMembers={false}
      />,
    );
    expect(container.querySelector('[data-test="lapses-bucket-31-90"]')?.textContent).toContain('1');
    expect(container.querySelectorAll('[data-test="lapsed-member-row"]')).toHaveLength(1);
    expect(container.querySelector('[data-test="lapsed-member-row"] a')).toBeNull();
  });

  it('says so when nobody is lapsed', () => {
    const { container } = render(
      <LapsesTab buckets={buckets.map((b) => ({ ...b, members: 0, cents: 0 }))} members={[]} canOpenMembers />,
    );
    expect(container.querySelector('[data-test="lapsed-members"]')?.textContent).toContain('No lapsed members');
  });
});

describe('CollectionSummary', () => {
  it('shows progress and a dash when nothing is expected', () => {
    const { container } = render(
      <CollectionSummary progress={{ expected: 0, renewed: 0, expectedCents: 0, collectedCents: 0, byMonth: [] }} />,
    );
    expect(container.querySelector('[data-test="collection-progress"]')?.textContent).toContain('—');
    expect(container.querySelector('[data-test="collection-collected"]')?.textContent).toContain('$0.00');
  });

  it('shows renewed of expected', () => {
    const { container } = render(
      <CollectionSummary progress={{ expected: 4, renewed: 2, expectedCents: 23200, collectedCents: 12700, byMonth: [] }} />,
    );
    expect(container.querySelector('[data-test="collection-progress"]')?.textContent).toContain('2 of 4');
    expect(container.querySelector('[data-test="collection-expected"]')?.textContent).toContain('$232.00');
  });
});
```

Run `pnpm --filter @kit/finance test:unit`. Expected: FAIL, because the modules aren't found yet.

- [ ] **Step 2: Add the tabs navigation**

`packages/features/finance/src/components/dashboard-tabs-nav.tsx` has no client directive:

```tsx
import Link from 'next/link';

import { cn } from '@kit/ui/utils';

import { DASHBOARD_TABS } from '../lib/dashboard-tabs';
import type { DashboardTab } from '../types';

const LABELS: Record<DashboardTab, string> = {
  overview: 'Overview',
  collection: 'Collection',
  lapses: 'Lapses',
  retention: 'Retention',
};

export function DashboardTabsNav({ active }: { active: DashboardTab }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Dashboard" data-test="dashboard-tabs">
      {DASHBOARD_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/home?tab=${tab}`}
          aria-current={tab === active ? 'page' : undefined}
          data-test={`dashboard-tab-${tab}`}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            tab === active ? 'border-primary text-foreground' : 'text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Add the charts**

`packages/features/finance/src/components/insights-charts.tsx` is a `'use client'` file. It follows `finance-charts.tsx`: each chart is a `Card` wrapping a `ChartContainer`, with dollar tooltips from `moneyTooltipFormatter`. If that helper isn't exported, export it from `finance-charts.tsx`.

It exports five charts:

- **`RunningTotalChart({ rows, expectedCents })`**
  - A `LineChart` of `toRunningTotalData(rows, expectedCents)`.
  - Two lines: `collected` (solid, with `connectNulls={false}` so the blank future months stay blank) and `expected` (dashed).
  - The Card has `data-test="collection-running-total"` and the title "Collected so far vs. expected".
  - When `rows` is empty, show "No dues recorded this year." in place of the chart.
- **`ForecastChart({ rows, selected })`**
  - A `BarChart` of `toForecastChartData(rows)` with `members` bars. The tooltip shows members and dollars.
  - Clicking a bar calls `router.replace` with `?tab=collection&month=<key>`. Use `useRouter` and `useSearchParams`, and keep `year` if it is present.
  - Below the chart, add an accessible fallback: a native `<select aria-label="Show members for month">` of the 12 months that does the same navigation.
  - The Card has `data-test="collection-forecast"` and the title "Coming due (next 12 months)".
  - When every month has 0 members, show "No renewals due in the next 12 months."
- **`AgingChart({ buckets })`**
  - A `BarChart` of `toAgingChartData(buckets)`, bars = `members`, with dollars in the tooltip.
  - The Card has `data-test="lapses-aging-chart"` and the title "Lapsed members by days unpaid".
- **`RetentionRateChart({ years })`**
  - A `LineChart` of `toRetentionRateData(years)`. The y axis runs 0–100 and is labelled with %.
  - The tooltip shows "renewed of eligible". `rate: null` points are gaps.
  - The Card has `data-test="retention-rate-chart"` and the title "Renewal rate (renewed within 90 days)".
- **`LapsesByMonthChart({ rows })`**
  - A `BarChart` of `toLapsesByMonthData(rows)`.
  - The Card has `data-test="retention-lapses-chart"` and the title "New lapses per month".
  - When every value is 0, show "No lapses in the last five years."

- [ ] **Step 4: Add the three tab components**

**`collection-tab.tsx`** (no client directive):

```tsx
import Link from 'next/link';

import { formatAmountCents } from '@kit/dues/lib/format-amount';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';

import { progressLabel } from '../lib/insights-data';
import type { CollectionProgress, ForecastMember, ForecastMonth } from '../types';
import { ForecastChart, RunningTotalChart } from './insights-charts';

export function CollectionSummary({ progress }: { progress: CollectionProgress }) {
  const percent = progress.expected === 0 ? 0 : Math.round((progress.renewed / progress.expected) * 100);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card data-test="collection-progress">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">Renewals received</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="text-2xl font-semibold">{progressLabel(progress.renewed, progress.expected)}</div>
          <Progress value={percent} aria-label="Renewals received" />
          <p className="text-muted-foreground text-xs">
            {progress.renewed} of {progress.expected} expected, excluding honorary
          </p>
        </CardContent>
      </Card>
      <Card data-test="collection-collected">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">Dues collected</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{formatAmountCents(progress.collectedCents)}</div>
        </CardContent>
      </Card>
      <Card data-test="collection-expected">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">Dues expected</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{formatAmountCents(progress.expectedCents)}</div>
          <p className="text-muted-foreground text-xs">At each expected member's current level</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function CollectionTab({
  progress,
  forecast,
  month,
  monthMembers,
  canOpenMembers,
}: {
  progress: CollectionProgress;
  forecast: ForecastMonth[];
  month: string | null;
  monthMembers: ForecastMember[];
  canOpenMembers: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <CollectionSummary progress={progress} />
      <RunningTotalChart rows={progress.byMonth} expectedCents={progress.expectedCents} />
      <ForecastChart rows={forecast} selected={month} />
      {month ? (
        <Card data-test="collection-forecast-members">
          <CardHeader>
            <CardTitle>Coming due in {month.slice(0, 7)}</CardTitle>
          </CardHeader>
          <CardContent>
            {monthMembers.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody is due that month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Membership #</TableHead>
                    <TableHead>Paid through</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthMembers.map((m) => (
                    <TableRow key={m.memberId} data-test="collection-forecast-row">
                      <TableCell>
                        {canOpenMembers ? (
                          <Link href={`/home/members/${m.memberId}`}>{`${m.firstName} ${m.lastName}`}</Link>
                        ) : (
                          `${m.firstName} ${m.lastName}`
                        )}
                      </TableCell>
                      <TableCell>{m.membershipNumber}</TableCell>
                      <TableCell>{m.paidThrough ?? '—'}</TableCell>
                      <TableCell>{m.levelName}</TableCell>
                      <TableCell>{formatAmountCents(m.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
```

**`lapses-tab.tsx`** (no client directive):

```tsx
import Link from 'next/link';

import { formatAmountCents } from '@kit/dues/lib/format-amount';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';

import { BUCKET_LABELS } from '../lib/insights-data';
import type { AgingBucket, LapsedMember } from '../types';
import { AgingChart } from './insights-charts';

export function LapsesTab({
  buckets,
  members,
  canOpenMembers,
}: {
  buckets: AgingBucket[];
  members: LapsedMember[];
  canOpenMembers: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {buckets.map((b) => (
          <Card key={b.bucket} data-test={`lapses-bucket-${b.bucket}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">{BUCKET_LABELS[b.bucket]} unpaid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{b.members}</div>
              <p className="text-muted-foreground text-xs">{formatAmountCents(b.cents)} owed</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <AgingChart buckets={buckets} />
      <Card data-test="lapsed-members">
        <CardHeader>
          <CardTitle>Lapsed and unpaid members (as of today)</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No lapsed members.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Membership #</TableHead>
                  <TableHead>Days unpaid</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Owed</TableHead>
                  <TableHead>Last paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.memberId} data-test="lapsed-member-row">
                    <TableCell>
                      {canOpenMembers ? (
                        <Link href={`/home/members/${m.memberId}`}>{`${m.firstName} ${m.lastName}`}</Link>
                      ) : (
                        `${m.firstName} ${m.lastName}`
                      )}
                    </TableCell>
                    <TableCell>{m.membershipNumber}</TableCell>
                    <TableCell>
                      {m.daysUnpaid} ({BUCKET_LABELS[m.bucket]})
                    </TableCell>
                    <TableCell>{m.levelName}</TableCell>
                    <TableCell>{formatAmountCents(m.amountCents)}</TableCell>
                    <TableCell>{m.lastPaidOn ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**`retention-tab.tsx`** (no client directive):

```tsx
import type { Retention } from '../types';
import { LapsesByMonthChart, RetentionRateChart } from './insights-charts';

export function RetentionTab({ retention }: { retention: Retention }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RetentionRateChart years={retention.years} />
      <LapsesByMonthChart rows={retention.lapsesByMonth} />
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `/home` around the tabs**

In `apps/portal/app/home/page.tsx`, keep the finance-view branch and the member-home branch, and change the finance-view branch as follows:

```tsx
    const params = await searchParams;
    const today = chicagoToday();
    const tab = parseTab(params.tab);
    const finance = new FinanceService(client);
    const canOpenMembers = hasPermission(perms, 'members', 'view');

    return (
      <div className="flex flex-col gap-6" data-test="finance-dashboard">
        <DashboardTabsNav active={tab} />
        {tab === 'overview' ? (
          <OverviewTab finance={finance} today={today} canOpenMembers={canOpenMembers} />
        ) : null}
        {tab === 'collection' ? (
          <CollectionTabContent
            finance={finance}
            today={today}
            year={parseYearParam(params.year, today)}
            month={parseMonthParam(params.month, today)}
            canOpenMembers={canOpenMembers}
          />
        ) : null}
        {tab === 'lapses' ? <LapsesTabContent finance={finance} canOpenMembers={canOpenMembers} /> : null}
        {tab === 'retention' ? <RetentionTabContent finance={finance} /> : null}
      </div>
    );
```

Define the four async server components in the same file:

- **`OverviewTab`**
  - Holds today's dashboard exactly as it is: the headline cards, the dues-per-month, status, per-year and hosting charts, the follow-up list and payments to check. The hosting chart still respects `featuresFlagConfig.enableHostingCosts`.
  - Reads always use the current fraternal year, `fraternalYearOf(today)`. The year picker moves to the Collection tab.
  - If `readDuesIfDeployed` reports "not deployed", fall back to the member home, as today.
- **`CollectionTabContent`**
  - Reads `Promise.all([finance.collectionProgress(year), finance.renewalsForecast(), finance.netByYear(), month ? finance.forecastMembers(month) : Promise.resolve([])])` through `readDuesIfDeployed`.
  - Renders a `YearPicker` (`year`, `yearOptions(fraternalYearOf(today), net[0]?.year ?? fraternalYearOf(today))`), then `CollectionTab`.
  - The YearPicker keeps `tab=collection`: it already preserves the other search params.
- **`LapsesTabContent`**: reads `Promise.all([finance.lapseAging(), finance.lapsedMembers()])` and renders `LapsesTab`.
- **`RetentionTabContent`**: reads `finance.retention()` and renders `RetentionTab`.

For the three new tabs, when `read.deployed` is false, render `<p className="text-muted-foreground" data-test="insights-unavailable">Not available yet.</p>`.

Import `parseTab`/`parseMonthParam` from `@kit/finance/lib/dashboard-tabs` and the new components from their files. Keep every existing import the Overview still uses.

- [ ] **Step 6: Run the tests and checks**

```bash
pnpm --filter @kit/finance test:unit
pnpm typecheck
pnpm lint
pnpm exec oxfmt --check packages/features/finance apps/portal/app/home
```

Expected: everything passes.

Then check the server/client boundary. List the client files with `grep -l "'use client'" packages/features/finance/src/components/*.tsx`. The portal page must import only React components from them.

- [ ] **Step 7: Commit**

```bash
git add packages/features/finance apps/portal/app/home/page.tsx
git commit -m "feat(finance): add Collection, Lapses and Retention tabs to /home"
```

---

### Task 4: End-to-end coverage for the tabs

**Files:**
- Modify: `apps/e2e/tests/finance/finance.spec.ts` and `finance.po.ts`

**Interfaces:**
- **Consumes:**
  - the Task 3 `data-test` hooks;
  - the existing administrator sign-in and plain-member helpers in `finance.po.ts` and `apps/e2e/tests/dues/dues.po.ts`.

- [ ] **Step 1: Write the specs**

Add two tests to `finance.spec.ts`. Neither depends on hosting costs.

**4. An administrator can open every dashboard tab.**
1. Sign in as an administrator, the same way scenario 1 does.
2. Open `/home`. Expect `dashboard-tab-overview` to have `aria-current="page"` and `finance-dues-collected` to be visible.
3. Click `dashboard-tab-collection`. Expect `collection-progress`, `collection-running-total` and `collection-forecast` to be visible.
4. Choose the first option of the month `<select>` inside `collection-forecast`. Expect the URL to contain `month=` and `collection-forecast-members` to be visible.
5. Click `dashboard-tab-lapses`. Expect the four `lapses-bucket-*` cards and `lapsed-members` to be visible.
6. Click `dashboard-tab-retention`. Expect `retention-rate-chart` and `retention-lapses-chart` to be visible.

**5. An unknown tab falls back to Overview.**
1. Sign in as an administrator and open `/home?tab=bogus`.
2. Expect `dashboard-tab-overview` to have `aria-current="page"` and `finance-dues-collected` to be visible.

The existing scenario 3 must still pass: a member gets `member-home` and never sees `dashboard-tabs`. Add `await expect(page.locator('[data-test="dashboard-tabs"]')).toHaveCount(0)` to it.

- [ ] **Step 2: Run against the stack**

Run with the sandbox disabled. Local Supabase must already be running with every migration applied; never reset it.

```bash
pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/finance tests/dues
pnpm stack:down
```

Expected results:
- finance scenarios 3, 4 and 5 pass;
- scenarios 1 and 2 are skipped, because hosting costs are off;
- the dues tests still pass, with the Stripe scenario skipped.

- [ ] **Step 3: Type-check and commit**

```bash
pnpm --filter web-e2e typecheck
pnpm exec oxfmt --check apps/e2e/tests/finance
git add apps/e2e/tests/finance
git commit -m "test(e2e): cover the dues insights tabs"
```
