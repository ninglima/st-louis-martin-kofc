# Finance Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give anyone who can open the finance dashboard a Reports page that shows a live monthly dues worksheet and saved Supreme/state payment packets, and that can email either document to the signed-in account.

**Architecture:** Two additive migrations. The worksheet is a `security definer` function over `dues_periods` and `kit.member_dues_snapshot`. Packets are a table written only through save and delete functions. `@kit/finance` gains the types, the service methods, the mail builder, and the page components. `/home/reports` is a sibling of `/home/dashboard`, linked from the dashboard nav.

**Tech Stack:**

- Supabase Postgres 17 with pgTAP
- Next.js 16 App Router, server actions via `enhanceAction`
- Resend through `@kit/email/resend` and `@kit/email/branded-layout`
- Vitest with jsdom
- Playwright

**Spec:** `docs/superpowers/specs/2026-10-12-finance-reports-design.md`

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
  1. Run `pnpm exec supabase gen types typescript --local --schema public` from `apps/portal`.
  2. Write the output into BOTH `apps/portal/lib/database.types.ts` and `packages/supabase/src/database.types.ts`.
  3. Re-add `__InternalSupabase`.
  4. Re-apply every existing `HAND-CORRECTED` block verbatim. The generator will drop those comments and widen nullable columns.
  5. Keep the two files byte-identical.
- **Dates:** "Today" is the America/Chicago date: `kit.council_today()` in SQL, `chicagoToday()` from `@kit/dues/schemas` in TypeScript.
- **Functions:**
  - Every new function is `security definer set search_path = ''`.
  - `kit.*` cores: `revoke all … from public, anon, authenticated`.
  - `public.*` wrappers: `revoke all … from public, anon;`, then `grant execute … to authenticated`. Each wrapper calls `kit.assert_finance_dashboard()` first.
- **Test lock-in:** `kit_authenticated_grants.test.sql` pins the kit functions `authenticated` may run. New kit functions must not be granted to `authenticated`. `revoke all … from authenticated` is required or that test fails.
- **Worksheet money:** count `dues_periods` with `voided_at is null`, `method in ('online','check','cash')`, and `received_on` in `[month, month + 1 month)`. Exclude `waived` and `opening_balance`.
- **Worksheet roster:** status counts come from `kit.member_dues_snapshot(p_today)` for `current`, `due_soon`, `due`, `lapsed`, and `no_record`. `roster` is the sum of those five, so they add up. Evaluated on `p_today`, not on the worksheet month.
- **Packet amounts:** stored in cents. Zero is allowed. Negative is refused. At least one of `supreme_cents` and `state_cents` is non-null. A blank note is stored as null.
- **Packet order:** `clock_timestamp()`, not `now()`. `now()` is frozen for the whole transaction, so two saves in one test would tie.
- **Email:** From `DUES_NOTICES_FROM`, API key `RESEND_API_KEY`, allowlist `EMAIL_ALLOWLIST` via `parseEmailAllowlist`. Recipient is the signed-in account. No PDF. No send log.
- **Permission on the page and the mail action:** `dashboard_finance` / `view`. The SQL wrappers stay on `kit.assert_finance_dashboard()` (`finance.view` or `dashboard_finance.view`), matching the other dashboard functions.
- **Graceful absence:** worksheet and packet reads go through `readDuesIfDeployed` from `@kit/dues/lib/dues-schema`.
- **Formatting:** no new oxfmt failures.
- **Leave alone:** `.mcp.json`, `.claude/` and `apps/portal/supabase/snippets/` stay untouched and unstaged.

## File map

| File | Responsibility |
| --- | --- |
| `apps/portal/supabase/migrations/20261012120000_finance_reports_worksheet.sql` | Worksheet function |
| `apps/portal/supabase/migrations/20261012120100_finance_payment_packets.sql` | Packet table and functions |
| `apps/portal/supabase/tests/finance_reports_worksheet.test.sql` | Worksheet pgTAP |
| `apps/portal/supabase/tests/finance_payment_packets.test.sql` | Packet pgTAP |
| `packages/features/finance/src/lib/worksheet-month.ts` | Default month and month list |
| `packages/features/finance/src/schemas.ts` | Packet form schema, added to the existing file |
| `packages/features/finance/src/types.ts` | `MonthlyWorksheet`, `PaymentPacket` |
| `packages/features/finance/src/server/finance.service.ts` | RPC wrappers |
| `packages/features/finance/src/server/report-mail.ts` | Subject, bodies, send |
| `packages/features/finance/src/server/report-actions.ts` | Save, delete, email actions |
| `packages/features/finance/src/components/reports-screen.tsx` | The page body |
| `apps/portal/app/home/reports/page.tsx` | Route |
| `packages/brand/src/config/paths.config.ts` | `app.reports` |
| `apps/portal/config/navigation.config.tsx` | Sidebar link |
| `packages/features/finance/src/components/dashboard-tabs-nav.tsx` | Reports link beside the tabs |

## Review focus

1. **Far-future money, delta roster.** Dues assertions use March 2099 so they do not collide with rows already in the long-lived local database. Roster assertions are a before/after delta, because `member_dues_snapshot` sees every existing member. Tested in Task 1.
2. **Tied timestamps.** `created_at` uses `clock_timestamp()` so "newest first" is true inside one transaction. Tested in Task 2.
3. **Allowlist and a missing From address disable the button.** They do not throw away a saved packet. Tested in Task 4.
4. **A member opening `/home/reports` is refused.** `requirePermission` redirects to `/home`. Tested in Task 6.

---

### Task 1: Monthly worksheet SQL

**Files:**

- Create: `apps/portal/supabase/migrations/20261012120000_finance_reports_worksheet.sql`
- Create: `apps/portal/supabase/tests/finance_reports_worksheet.test.sql`

**Interfaces:**

- Consumes: `kit.member_dues_snapshot(date)`, `kit.council_today()`, `kit.assert_finance_dashboard()`, `public.dues_periods`, `public.members`.
- Produces:
  - `kit.finance_monthly_worksheet_at(p_month date, p_today date) returns jsonb`
  - `public.finance_monthly_worksheet(p_month date) returns jsonb`
  - jsonb keys: `month`, `asOf`, `roster`, `statusCounts` (`current`, `due_soon`, `due`, `lapsed`, `no_record`), `receivedCents`, `onlineCents`, `checkCents`, `cashCents`. Counts are JSON numbers.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/supabase/tests/finance_reports_worksheet.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select plan(15);

select tests.make_user('frw-admin@example.com', 'administrator') as admin \gset
select tests.make_user('frw-knight@example.com', 'member') as knight \gset

select tests.make_member('FRW-ON') as on_id \gset
select tests.make_member('FRW-CH') as ch_id \gset
select tests.make_member('FRW-CA') as ca_id \gset
select tests.make_member('FRW-WV') as wv_id \gset
select tests.make_member('FRW-OB') as ob_id \gset
select tests.make_member('FRW-VD') as vd_id \gset
select tests.make_member('FRW-NX') as nx_id \gset

insert into public.dues_periods
  (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
values
  (:'on_id', 'regular', 1000, 'online', null, '2099-03-15', '2099-03-15', '2099-03-15'::date + 365),
  (:'ch_id', 'regular', 2000, 'check',  '2099', '2099-03-02', '2099-03-02', '2099-03-02'::date + 365),
  (:'ca_id', 'regular', 3000, 'cash',   null, '2099-03-28', '2099-03-28', '2099-03-28'::date + 365),
  (:'wv_id', 'regular', 0,    'waived', null, '2099-03-10', '2099-03-10', '2099-03-10'::date + 365),
  (:'ob_id', 'regular', 0,    'opening_balance', null, '2099-03-11', '2099-03-11', '2099-03-11'::date + 365),
  (:'vd_id', 'regular', 6000, 'cash',   null, '2099-03-12', '2099-03-12', '2099-03-12'::date + 365),
  (:'nx_id', 'regular', 7000, 'online', null, '2099-04-01', '2099-04-01', '2099-04-01'::date + 365);

update public.dues_periods
   set voided_at = clock_timestamp(), void_reason = 'test'
 where member_id = :'vd_id';

select kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') as w \gset

select is((:'w'::jsonb ->> 'onlineCents')::int, 1000, 'March online');
select is((:'w'::jsonb ->> 'checkCents')::int, 2000, 'March check');
select is((:'w'::jsonb ->> 'cashCents')::int, 3000, 'March cash, voided row excluded');
select is((:'w'::jsonb ->> 'receivedCents')::int, 6000, 'waiver and opening balance excluded');
select is((:'w'::jsonb ->> 'month'), '2099-03-01', 'month is the first of March');
select is((:'w'::jsonb ->> 'asOf'), '2099-06-01', 'asOf is the today argument');

select is(
  (:'w'::jsonb ->> 'roster')::int,
  (
    (:'w'::jsonb -> 'statusCounts' ->> 'current')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'due_soon')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'due')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'lapsed')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'no_record')::int
  ),
  'five status counts add up to the roster'
);

select (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') ->> 'roster')::int as roster_before \gset
select (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') -> 'statusCounts' ->> 'no_record')::int as none_before \gset
select tests.make_member('FRW-NEW') as new_id \gset
select is(
  (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') ->> 'roster')::int,
  :roster_before + 1,
  'a new member increases the roster by one'
);
select is(
  (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') -> 'statusCounts' ->> 'no_record')::int,
  :none_before + 1,
  'a member with no acceptance date and no period is no_record'
);

select throws_ok(
  $$select kit.finance_monthly_worksheet_at('1999-12-01', '2099-06-01')$$,
  'P0001', 'invalid worksheet month: 1999-12-01',
  'months before 2000 are refused');
select throws_ok(
  $$select kit.finance_monthly_worksheet_at('2099-07-01', '2099-06-01')$$,
  'P0001', 'invalid worksheet month: 2099-07-01',
  'a month after today is refused');
select throws_ok(
  $$select kit.finance_monthly_worksheet_at('2099-03-15', '2099-06-01')$$,
  'P0001', 'invalid worksheet month: 2099-03-15',
  'a date that is not the first of a month is refused');
select lives_ok(
  $$select kit.finance_monthly_worksheet_at('2099-06-01', '2099-06-15')$$,
  'the current month is allowed');

select tests.act_as(:'knight');
select throws_ok(
  $$select public.finance_monthly_worksheet('2099-03-01')$$,
  '42501', 'forbidden',
  'a member cannot read the worksheet');

select tests.act_as(:'admin');
select lives_ok(
  $$select public.finance_monthly_worksheet(date_trunc('month', kit.council_today())::date)$$,
  'an administrator can read the current month');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

From `apps/portal`:

```bash
pnpm exec supabase test db
```

Expected: FAIL because `kit.finance_monthly_worksheet_at` does not exist.

- [ ] **Step 3: Write the migration**

Create `apps/portal/supabase/migrations/20261012120000_finance_reports_worksheet.sql`:

```sql
-- Monthly council worksheet. Membership is the roster as of p_today.
-- Dues received are the chosen calendar month only.

create or replace function kit.finance_monthly_worksheet_at(p_month date, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_online bigint;
  v_check  bigint;
  v_cash   bigint;
  v_counts jsonb;
  v_roster integer;
begin
  if p_month is null
     or p_month <> date_trunc('month', p_month)::date
     or p_month < date '2000-01-01'
     or p_month > date_trunc('month', p_today)::date then
    raise exception 'invalid worksheet month: %', p_month using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_cents) filter (where p.method = 'online'), 0),
         coalesce(sum(p.amount_cents) filter (where p.method = 'check'), 0),
         coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0)
    into v_online, v_check, v_cash
    from public.dues_periods p
   where p.voided_at is null
     and p.received_on >= p_month
     and p.received_on < (p_month + interval '1 month')::date;

  select jsonb_object_agg(
           k.status,
           coalesce((select count(*)::int
                       from kit.member_dues_snapshot(p_today) s
                      where s.dues_status = k.status), 0))
    into v_counts
    from unnest(array['current', 'due_soon', 'due', 'lapsed', 'no_record']) as k(status);

  v_roster :=
      coalesce((v_counts ->> 'current')::int, 0)
    + coalesce((v_counts ->> 'due_soon')::int, 0)
    + coalesce((v_counts ->> 'due')::int, 0)
    + coalesce((v_counts ->> 'lapsed')::int, 0)
    + coalesce((v_counts ->> 'no_record')::int, 0);

  return jsonb_build_object(
    'month', p_month,
    'asOf', p_today,
    'roster', v_roster,
    'statusCounts', v_counts,
    'receivedCents', v_online + v_check + v_cash,
    'onlineCents', v_online,
    'checkCents', v_check,
    'cashCents', v_cash);
end $$;

revoke all on function kit.finance_monthly_worksheet_at(date, date) from public, anon, authenticated;

create or replace function public.finance_monthly_worksheet(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kit.assert_finance_dashboard();
  return kit.finance_monthly_worksheet_at(p_month, kit.council_today());
end $$;

revoke all on function public.finance_monthly_worksheet(date) from public, anon;
grant execute on function public.finance_monthly_worksheet(date) to authenticated;
```

The `dues_periods` alias `p` shadows the plpgsql parameters. Name the alias `dp` instead of `p` in the real file so `p_month` stays visible. Use this select:

```sql
  select coalesce(sum(dp.amount_cents) filter (where dp.method = 'online'), 0),
         coalesce(sum(dp.amount_cents) filter (where dp.method = 'check'), 0),
         coalesce(sum(dp.amount_cents) filter (where dp.method = 'cash'), 0)
    into v_online, v_check, v_cash
    from public.dues_periods dp
   where dp.voided_at is null
     and dp.received_on >= p_month
     and dp.received_on < (p_month + interval '1 month')::date;
```

- [ ] **Step 4: Apply and run the tests**

From `apps/portal`:

```bash
pnpm exec supabase migration up
pnpm exec supabase test db
```

Expected: `finance_reports_worksheet.test.sql` passes (`plan(15)`), and `kit_authenticated_grants.test.sql` still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/supabase/migrations/20261012120000_finance_reports_worksheet.sql \
        apps/portal/supabase/tests/finance_reports_worksheet.test.sql
git commit -m "$(cat <<'EOF'
feat(finance): add the monthly worksheet query

EOF
)"
```

---

### Task 2: Payment packet SQL

**Files:**

- Create: `apps/portal/supabase/migrations/20261012120100_finance_payment_packets.sql`
- Create: `apps/portal/supabase/tests/finance_payment_packets.test.sql`

**Interfaces:**

- Consumes: `kit.assert_finance_dashboard()`, `auth.uid()`, `auth.users`.
- Produces:
  - table `public.finance_payment_packets (id uuid, label text, supreme_cents int, state_cents int, note text, created_by uuid, created_at timestamptz, updated_at timestamptz)`
  - `public.finance_payment_packets() returns setof public.finance_payment_packets`
  - `public.finance_payment_packet_save(p_id uuid, p_label text, p_supreme_cents int, p_state_cents int, p_note text) returns public.finance_payment_packets`
  - `public.finance_payment_packet_delete(p_id uuid) returns void`
  - Errors, all `P0001`: `payment packet label is required`, `payment packet label is too long`, `payment packet note is too long`, `payment packet needs a total`, `payment packet total is negative`, `payment packet not found`.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/supabase/tests/finance_payment_packets.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select plan(18);

select tests.make_user('frp-admin@example.com', 'administrator') as admin \gset
select tests.make_user('frp-other@example.com', 'administrator') as other \gset
select tests.make_user('frp-knight@example.com', 'member') as knight \gset

select tests.act_as(:'admin');

select id as first_id, created_by as first_by
  from public.finance_payment_packet_save(null, 'Supreme, January 2099', 175, null, '  ') \gset

select is(:'first_by'::uuid, :'admin'::uuid, 'created_by is the caller');
select ok(
  (select note is null from public.finance_payment_packets where id = :'first_id'),
  'a blank note is stored as null');
select is(
  (select supreme_cents from public.finance_payment_packets where id = :'first_id'),
  175,
  'a Supreme total alone is saved');

select id as second_id
  from public.finance_payment_packet_save(null, 'State, 2099', null, 0, 'state bill') \gset

select is(
  (select state_cents from public.finance_payment_packets where id = :'second_id'),
  0,
  'a zero state total is allowed');

select is(
  (select id from public.finance_payment_packets() limit 1),
  :'second_id'::uuid,
  'the list is newest first');

select tests.act_as(:'other');
select created_by as still_by
  from public.finance_payment_packet_save(:'first_id', 'Supreme, January 2099', 200, 50, 'corrected') \gset
select is(:'still_by'::uuid, :'admin'::uuid, 'update leaves created_by alone');
select is(
  (select supreme_cents from public.finance_payment_packets where id = :'first_id'),
  200,
  'update changes the Supreme total');

select tests.act_as(:'admin');

select throws_ok(
  $$select public.finance_payment_packet_save(null, 'x', null, null, null)$$,
  'P0001', 'payment packet needs a total',
  'both totals empty is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, 'x', -1, null, null)$$,
  'P0001', 'payment packet total is negative',
  'a negative total is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, '   ', 1, null, null)$$,
  'P0001', 'payment packet label is required',
  'a blank label is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, repeat('a', 121), 1, null, null)$$,
  'P0001', 'payment packet label is too long',
  'a label over 120 characters is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, 'ok', 1, null, repeat('n', 501))$$,
  'P0001', 'payment packet note is too long',
  'a note over 500 characters is refused');
select throws_ok(
  $$select public.finance_payment_packet_save('00000000-0000-0000-0000-000000000000', 'ok', 1, null, null)$$,
  'P0001', 'payment packet not found',
  'update of an unknown id is refused');
select throws_ok(
  $$select public.finance_payment_packet_delete('00000000-0000-0000-0000-000000000000')$$,
  'P0001', 'payment packet not found',
  'delete of an unknown id is refused');

select public.finance_payment_packet_delete(:'second_id');
select is(
  (select count(*)::int from public.finance_payment_packets where id = :'second_id'),
  0,
  'delete removes the packet');

select ok(
  not has_table_privilege('authenticated', 'public.finance_payment_packets', 'SELECT'),
  'authenticated cannot read the table directly');
select ok(
  not has_table_privilege('authenticated', 'public.finance_payment_packets', 'INSERT'),
  'authenticated cannot insert the table directly');

select tests.act_as(:'knight');
select throws_ok(
  $$select public.finance_payment_packet_save(null, 'nope', 1, null, null)$$,
  '42501', 'forbidden',
  'a member cannot save a packet');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

From `apps/portal`:

```bash
pnpm exec supabase test db
```

Expected: FAIL because `public.finance_payment_packets` does not exist.

- [ ] **Step 3: Write the migration**

Create `apps/portal/supabase/migrations/20261012120100_finance_payment_packets.sql`:

```sql
create table public.finance_payment_packets (
  id             uuid primary key default extensions.uuid_generate_v4(),
  label          text not null,
  supreme_cents  integer,
  state_cents    integer,
  note           text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default clock_timestamp(),
  updated_at     timestamptz not null default clock_timestamp(),
  constraint finance_payment_packets_label_len
    check (char_length(btrim(label)) between 1 and 120),
  constraint finance_payment_packets_note_len
    check (note is null or char_length(note) <= 500),
  constraint finance_payment_packets_supreme_nonneg
    check (supreme_cents is null or supreme_cents >= 0),
  constraint finance_payment_packets_state_nonneg
    check (state_cents is null or state_cents >= 0),
  constraint finance_payment_packets_has_total
    check (supreme_cents is not null or state_cents is not null)
);

alter table public.finance_payment_packets enable row level security;
revoke all on public.finance_payment_packets from anon, authenticated;

create or replace function public.finance_payment_packet_save(
  p_id uuid,
  p_label text,
  p_supreme_cents integer,
  p_state_cents integer,
  p_note text
) returns public.finance_payment_packets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.finance_payment_packets;
  v_label text := btrim(coalesce(p_label, ''));
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform kit.assert_finance_dashboard();

  if v_label = '' then
    raise exception 'payment packet label is required' using errcode = 'P0001';
  end if;
  if char_length(v_label) > 120 then
    raise exception 'payment packet label is too long' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'payment packet note is too long' using errcode = 'P0001';
  end if;
  if p_supreme_cents is null and p_state_cents is null then
    raise exception 'payment packet needs a total' using errcode = 'P0001';
  end if;
  if coalesce(p_supreme_cents, 0) < 0 or coalesce(p_state_cents, 0) < 0 then
    raise exception 'payment packet total is negative' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.finance_payment_packets
      (label, supreme_cents, state_cents, note, created_by, created_at, updated_at)
    values
      (v_label, p_supreme_cents, p_state_cents, v_note, auth.uid(),
       clock_timestamp(), clock_timestamp())
    returning * into v_row;
  else
    update public.finance_payment_packets
       set label = v_label,
           supreme_cents = p_supreme_cents,
           state_cents = p_state_cents,
           note = v_note,
           updated_at = clock_timestamp()
     where id = p_id
     returning * into v_row;
    if not found then
      raise exception 'payment packet not found' using errcode = 'P0001';
    end if;
  end if;

  return v_row;
end $$;

create or replace function public.finance_payment_packet_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kit.assert_finance_dashboard();
  delete from public.finance_payment_packets where id = p_id;
  if not found then
    raise exception 'payment packet not found' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.finance_payment_packets()
returns setof public.finance_payment_packets
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kit.assert_finance_dashboard();
  return query
    select * from public.finance_payment_packets
     order by created_at desc, id desc;
end $$;

revoke all on function public.finance_payment_packet_save(uuid, text, integer, integer, text) from public, anon;
revoke all on function public.finance_payment_packet_delete(uuid) from public, anon;
revoke all on function public.finance_payment_packets() from public, anon;
grant execute on function public.finance_payment_packet_save(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.finance_payment_packet_delete(uuid) to authenticated;
grant execute on function public.finance_payment_packets() to authenticated;
```

`extensions.uuid_generate_v4()` is what `public.members` uses. If that call fails on apply, use `gen_random_uuid()` instead and keep the column type `uuid`.

- [ ] **Step 4: Apply and run the tests**

From `apps/portal`:

```bash
pnpm exec supabase migration up
pnpm exec supabase test db
```

Expected: `finance_payment_packets.test.sql` passes (`plan(18)`).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/supabase/migrations/20261012120100_finance_payment_packets.sql \
        apps/portal/supabase/tests/finance_payment_packets.test.sql
git commit -m "$(cat <<'EOF'
feat(finance): store Supreme and state payment packets

EOF
)"
```

---

### Task 3: Types, month helper, and service

**Files:**

- Modify: `apps/portal/lib/database.types.ts`
- Modify: `packages/supabase/src/database.types.ts`
- Modify: `packages/features/finance/src/types.ts`
- Modify: `packages/features/finance/src/schemas.ts`
- Create: `packages/features/finance/src/lib/worksheet-month.ts`
- Create: `packages/features/finance/src/lib/worksheet-month.test.ts`
- Create: `packages/features/finance/src/schemas.reports.test.ts`
- Modify: `packages/features/finance/src/server/finance.service.ts`

**Interfaces:**

- Consumes: the two RPCs from Tasks 1 and 2, `parseDollarsToCents` from `src/lib/money.ts`.
- Produces:

```ts
export interface MonthlyWorksheet {
  month: string;
  asOf: string;
  roster: number;
  statusCounts: Record<
    'current' | 'due_soon' | 'due' | 'lapsed' | 'no_record',
    number
  >;
  receivedCents: number;
  onlineCents: number;
  checkCents: number;
  cashCents: number;
}

export interface PaymentPacket {
  id: string;
  label: string;
  supremeCents: number | null;
  stateCents: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function defaultWorksheetMonth(today: string): string;
export function worksheetMonthOptions(today: string): string[];

export const PaymentPacketFormSchema: z.ZodType<{
  id?: string;
  label: string;
  supreme: string;
  state: string;
  note?: string;
}>;

export function toPaymentPacketCents(input: {
  supreme: string;
  state: string;
}): { supremeCents: number | null; stateCents: number | null };
```

`FinanceService` methods: `monthlyWorksheet(month: string): Promise<MonthlyWorksheet>`, `paymentPackets(): Promise<PaymentPacket[]>`, `savePaymentPacket(input): Promise<PaymentPacket>`, `deletePaymentPacket(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing unit tests**

`packages/features/finance/src/lib/worksheet-month.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  defaultWorksheetMonth,
  worksheetMonthOptions,
} from './worksheet-month';

describe('defaultWorksheetMonth', () => {
  it('is the previous calendar month', () => {
    expect(defaultWorksheetMonth('2026-10-12')).toBe('2026-09-01');
    expect(defaultWorksheetMonth('2026-01-03')).toBe('2025-12-01');
  });

  it('does not go before January 2000', () => {
    expect(defaultWorksheetMonth('2000-01-15')).toBe('2000-01-01');
  });
});

describe('worksheetMonthOptions', () => {
  it('starts at the current month and ends at January 2000', () => {
    const months = worksheetMonthOptions('2000-03-02');

    expect(months[0]).toBe('2000-03-01');
    expect(months.at(-1)).toBe('2000-01-01');
    expect(months).toHaveLength(3);
  });
});
```

`packages/features/finance/src/schemas.reports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  PaymentPacketFormSchema,
  toPaymentPacketCents,
} from './schemas';

describe('PaymentPacketFormSchema', () => {
  it('accepts a Supreme total alone, including zero', () => {
    const parsed = PaymentPacketFormSchema.parse({
      label: 'Supreme, January 2027',
      supreme: '0',
      state: '',
    });

    expect(toPaymentPacketCents(parsed)).toEqual({
      supremeCents: 0,
      stateCents: null,
    });
  });

  it('accepts dollars and cents', () => {
    const parsed = PaymentPacketFormSchema.parse({
      label: 'State',
      supreme: '',
      state: '12.50',
    });

    expect(toPaymentPacketCents(parsed).stateCents).toBe(1250);
  });

  it.each([
    [{ label: 'x', supreme: '', state: '' }, 'Enter a Supreme or a state total'],
    [{ label: 'x', supreme: '-1', state: '' }, 'Enter an amount like 25 or 25.00'],
    [{ label: 'x', supreme: '1.234', state: '' }, 'Enter an amount like 25 or 25.00'],
    [{ label: '   ', supreme: '1', state: '' }, 'Enter a label'],
  ])('refuses %j', (input, message) => {
    const result = PaymentPacketFormSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === message)).toBe(
        true,
      );
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

From the repo root:

```bash
pnpm --filter @kit/finance test:unit -- src/lib/worksheet-month.test.ts src/schemas.reports.test.ts
```

Expected: FAIL because the modules are not exported.

- [ ] **Step 3: Regenerate database types**

From `apps/portal`, follow Global Constraints. After the copy, if `supreme_cents`, `state_cents`, or `note` on `finance_payment_packets` are typed as non-null, add a `HAND-CORRECTED` comment and widen them to `number | null` and `string | null`. Do the same on the `Returns` of `finance_payment_packet_save` and the `Returns` row of `finance_payment_packets`.

- [ ] **Step 4: Implement the helper, schema, types, and service**

`packages/features/finance/src/lib/worksheet-month.ts`:

```ts
/** Previous calendar month, as YYYY-MM-01. January 2000 stays January 2000. */
export function defaultWorksheetMonth(today: string): string {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const previous =
    month === 1
      ? `${year - 1}-12-01`
      : `${year}-${String(month - 1).padStart(2, '0')}-01`;

  return previous < '2000-01-01' ? '2000-01-01' : previous;
}

/** First-of-month dates from the current month back through 2000-01-01. */
export function worksheetMonthOptions(today: string): string[] {
  const current = `${today.slice(0, 7)}-01`;
  const months: string[] = [];
  let cursor = current;

  while (cursor >= '2000-01-01') {
    months.push(cursor);
    const [year, month] = cursor.split('-').map(Number) as [number, number];
    cursor =
      month === 1
        ? `${year - 1}-12-01`
        : `${year}-${String(month - 1).padStart(2, '0')}-01`;
  }

  return months;
}

export function worksheetMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}T00:00:00Z`));
}
```

Add to `packages/features/finance/src/schemas.ts`:

```ts
export const PaymentPacketFormSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1, 'Enter a label').max(120, 'The label can be at most 120 characters'),
    supreme: z.string(),
    state: z.string(),
    note: z.string().max(500, 'The note can be at most 500 characters').optional(),
  })
  .superRefine((value, ctx) => {
    const supremeBlank = value.supreme.trim() === '';
    const stateBlank = value.state.trim() === '';

    if (!supremeBlank && parseDollarsToCents(value.supreme) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['supreme'],
        message: 'Enter an amount like 25 or 25.00',
      });
    }
    if (!stateBlank && parseDollarsToCents(value.state) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Enter an amount like 25 or 25.00',
      });
    }
    if (supremeBlank && stateBlank) {
      ctx.addIssue({
        code: 'custom',
        path: ['supreme'],
        message: 'Enter a Supreme or a state total',
      });
    }
  });

export function toPaymentPacketCents(input: { supreme: string; state: string }): {
  supremeCents: number | null;
  stateCents: number | null;
} {
  return {
    supremeCents: input.supreme.trim() === '' ? null : parseDollarsToCents(input.supreme),
    stateCents: input.state.trim() === '' ? null : parseDollarsToCents(input.state),
  };
}
```

Add `MonthlyWorksheet` and `PaymentPacket` to `types.ts` exactly as in Interfaces.

Add the four methods to `FinanceService`. Map packet rows from snake_case (`supreme_cents`, `state_cents`, `created_by`, `created_at`, `updated_at`) to the camelCase interface. `monthlyWorksheet` returns the jsonb payload cast to `MonthlyWorksheet`, the same way `dashboard` returns its payload. Pass `p_month`, `p_id`, `p_label`, `p_supreme_cents`, `p_state_cents`, `p_note`. Send `undefined` rather than `null` for an absent `p_id` if the generated args type uses `undefined`. Send `null` for a blank total.

- [ ] **Step 5: Run the unit tests**

```bash
pnpm --filter @kit/finance test:unit -- src/lib/worksheet-month.test.ts src/schemas.reports.test.ts
pnpm --filter @kit/finance typecheck
```

Expected: PASS, and typecheck is clean.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/database.types.ts packages/supabase/src/database.types.ts \
        packages/features/finance/src/types.ts packages/features/finance/src/schemas.ts \
        packages/features/finance/src/schemas.reports.test.ts \
        packages/features/finance/src/lib/worksheet-month.ts \
        packages/features/finance/src/lib/worksheet-month.test.ts \
        packages/features/finance/src/server/finance.service.ts
git commit -m "$(cat <<'EOF'
feat(finance): read the worksheet and payment packets

EOF
)"
```

---

### Task 4: Email the report to the signed-in account

**Files:**

- Modify: `packages/features/finance/package.json` (add `"@kit/email": "workspace:*"` and `"@kit/rbac": "workspace:*"` to dependencies, and `"server-only"` if it is not already present)
- Create: `packages/features/finance/src/server/report-mail.ts`
- Create: `packages/features/finance/src/server/report-mail.test.ts`
- Create: `packages/features/finance/src/server/report-actions.ts`

**Interfaces:**

- Consumes: `MonthlyWorksheet`, `PaymentPacket`, `worksheetMonthLabel`, `sendEmail` from `@kit/email/resend`, `renderBrandedEmail` from `@kit/email/branded-layout`, `parseEmailAllowlist` and `isEmailAllowlisted` and `NOT_ON_ALLOWLIST_ERROR` from `@kit/email/allowlist`, `formatAmountCents` from `@kit/dues/lib/format-amount`, `loadPermissionsForUser` from `@kit/rbac/server/permissions.service`, `hasPermission` from `@kit/rbac/types`.
- Produces:

```ts
export interface ReportMailConfig {
  apiKey: string;
  from: string;
  siteUrl: string;
  allowlist: ReadonlySet<string> | null;
  missing: string[];
}

export function readReportMailConfig(
  env?: Record<string, string | undefined>,
): ReportMailConfig;

export function reportEmailBlocker(
  config: ReportMailConfig,
  recipient: string | null,
): string | null;

export function renderWorksheetReport(
  worksheet: MonthlyWorksheet,
  siteUrl: string,
): { subject: string; html: string; text: string };

export function renderPacketReport(
  packet: PaymentPacket,
  siteUrl: string,
): { subject: string; html: string; text: string };

export async function sendFinanceReport(args: {
  config: ReportMailConfig;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }>;
```

Actions, each returning `FinanceActionResult` except the mail action, which returns `{ success: true; sentTo: string } | { success: false; error: string }`:

- `savePaymentPacketAction`
- `deletePaymentPacketAction`
- `emailWorksheetAction({ month: string })`
- `emailPacketAction({ id: string })`

- [ ] **Step 1: Write the failing mail tests**

`packages/features/finance/src/server/report-mail.test.ts` covers:

- `renderWorksheetReport` subject is `Council worksheet, March 2099` for month `2099-03-01`.
- The text body contains `As of 2099-06-01`, `Roster 4`, `Current 1`, `Due soon 1`, `Due 1`, `Lapsed 1`, `No record 0`, `Received $60.00`, `Card $10.00`, `Check $20.00`, `Cash $30.00`. Use a worksheet with those cents (1000, 2000, 3000) and those status counts.
- The html contains `Council worksheet, March 2099` and `Pay` is not required. It contains the escaped label nowhere. It contains `$60.00`.
- `renderPacketReport` subject is `Payment packet: Supreme, January 2099`.
- Text contains `Supreme $1.75`, `State` followed by a blank line when `stateCents` is null, and the note `stub enclosed` when set. When `note` is null, the text does not contain `Note`.
- `reportEmailBlocker` returns `Email is not configured (DUES_NOTICES_FROM)` when `from` is empty, `The signed-in account has no email address` when recipient is null, and `not on EMAIL_ALLOWLIST` when the allowlist is `new Set(['other@example.com'])` and the recipient is `fs@example.com`. It returns null when from and api key are set, the allowlist is null, and the recipient is `fs@example.com`.
- `sendFinanceReport` calls `sendEmail`, which reads `response.ok` and `response.json()`. A `fetchImpl` returning `{ ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({ message: 'nope' }) }` makes the result `{ ok: false, error: 'Resend 422: nope' }`. A `fetchImpl` returning `{ ok: true, status: 200, statusText: 'OK', json: async () => ({ id: 'email_1' }) }` makes the result `{ ok: true }`. The function does not take a packet, so a failed send cannot delete one.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kit/finance test:unit -- src/server/report-mail.test.ts
```

Expected: FAIL because `report-mail.ts` does not exist.

- [ ] **Step 3: Implement the mail module and the actions**

`readReportMailConfig` reads `RESEND_API_KEY`, `DUES_NOTICES_FROM`, `EMAIL_ALLOWLIST`, and `NEXT_PUBLIC_SITE_URL`. `missing` lists `RESEND_API_KEY` and `DUES_NOTICES_FROM` when blank. `siteUrl` is the env value with a trailing slash removed, or `https://kofc-15256.org` when the env value is empty. An empty allowlist parses to null.

`reportEmailBlocker` checks `missing` first (join the names into `Email is not configured (${names})`), then a null or blank recipient (`The signed-in account has no email address`), then `isEmailAllowlisted` (`NOT_ON_ALLOWLIST_ERROR`).

`renderWorksheetReport` builds plain text lines and an HTML body of `<p>` elements whose text is passed through `escapeHtml` from `@kit/email/html` before insertion. `renderBrandedEmail` gets `title` equal to the subject, `ctaLabel` `Open reports`, `ctaUrl` `${siteUrl}/home/reports`. Status labels: Current, Due soon, Due, Lapsed, No record. Money goes through `formatAmountCents`. Card is `onlineCents`.

`renderPacketReport` prints `Supreme` and `State`. A null total is the word `blank`, not `$0.00`. A zero total is `$0.00`. The note line is omitted when `note` is null.

`sendFinanceReport` calls `sendEmail(config.apiKey, { from, to: recipient, subject, html, text, tags: [{ name: 'kind', value: 'finance_report' }] }, { fetchImpl })` and maps `{ ok: false, error }` through.

`report-actions.ts` is `'use server'`. Follow `hosting-actions.ts`: `enhanceAction`, parse with zod, return `{ success: false, error }` instead of throwing. Map Postgres `42501` to `You do not have permission to use reports.` and `P0001` to the exception message.

Before sending, load permissions with `loadPermissionsForUser(getSupabaseServerAdminClient(), user.sub)` and refuse unless `hasPermission(perms, 'dashboard_finance', 'view')`. Recipient is `user.email ?? null`. Call `reportEmailBlocker` and return its string when set. Load the worksheet or the packet through `FinanceService` on the signed-in client. On `sendFinanceReport` failure, return that error and do not delete the packet. On success, return `{ success: true, sentTo: recipient }`.

`emailWorksheetAction` schema: `{ month: z.string().regex(/^\d{4}-\d{2}-01$/) }`. `emailPacketAction` schema: `{ id: z.string().uuid() }`.

Save and delete revalidate `/home/reports`.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @kit/finance test:unit -- src/server/report-mail.test.ts
pnpm --filter @kit/finance typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/features/finance/package.json \
        packages/features/finance/src/server/report-mail.ts \
        packages/features/finance/src/server/report-mail.test.ts \
        packages/features/finance/src/server/report-actions.ts
git commit -m "$(cat <<'EOF'
feat(finance): email a worksheet or payment packet to the signer

EOF
)"
```

---

### Task 5: Reports page

**Files:**

- Modify: `packages/brand/src/config/paths.config.ts`
- Modify: `packages/brand/i18n/messages/en/common.json` (`routes.reports`: `Reports`)
- Modify: `apps/portal/config/navigation.config.tsx`
- Modify: `packages/features/finance/src/components/dashboard-tabs-nav.tsx`
- Create: `packages/features/finance/src/components/reports-screen.tsx`
- Create: `apps/portal/app/home/reports/page.tsx`

**Interfaces:**

- Consumes: `FinanceService`, `defaultWorksheetMonth`, `worksheetMonthOptions`, `worksheetMonthLabel`, `PaymentPacketFormSchema`, `toPaymentPacketCents`, `centsToDollarsInput`, `formatAmountCents`, `readDuesIfDeployed`, `readReportMailConfig`, `reportEmailBlocker`, the three actions, `requirePermission('dashboard_finance', 'view')`.
- Produces: route `/home/reports`. Query `?month=YYYY-MM-01`. An invalid or out-of-range month falls back to `defaultWorksheetMonth(chicagoToday())`.

- [ ] **Step 1: Add the path, the sidebar item, and the dashboard link**

In `paths.config.ts`, add `reports: z.string().min(1)` to the app object and `reports: '/home/reports'` to the parsed config.

In `navigation.config.tsx`, add a child after the dashboard item:

```tsx
{
  label: 'common.routes.reports',
  path: pathsConfig.app.reports,
  Icon: <LayoutDashboard className={iconClasses} />,
  section: 'dashboard_finance',
  verb: 'view' as const,
},
```

Change `DashboardTabsNav` so `active` is `DashboardTab | 'reports'`. After the tab links, render:

```tsx
<Link
  href={pathsConfig.app.reports}
  aria-current={active === 'reports' ? 'page' : undefined}
  data-test="dashboard-reports-link"
  className={cn(
    '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
    active === 'reports'
      ? 'border-primary text-foreground'
      : 'text-muted-foreground border-transparent hover:text-foreground',
  )}
>
  Reports
</Link>
```

Import `pathsConfig` from `@kit/brand/config/paths`. The existing tab links keep `data-test={`dashboard-tab-${tab}`}`.

- [ ] **Step 2: Build the screen**

`reports-screen.tsx` is a server component. Props:

```ts
{
  worksheet: MonthlyWorksheet;
  packets: PaymentPacket[];
  month: string;
  monthOptions: string[];
  emailBlocker: string | null;
  editing: PaymentPacket | null;
}
```

Layout:

- A `<form method="get">` month `<select name="month" data-test="worksheet-month">` whose options are `worksheetMonthLabel`. The selected option is `month`.
- Roster block `data-test="worksheet-roster"`: total, then the five labels.
- Received block `data-test="worksheet-received"`: total, Card, Check, Cash, via `formatAmountCents`.
- Email worksheet: a `<form action={emailWorksheetAction}>` with hidden `month`. The submit button `data-test="email-worksheet"` is disabled when `emailBlocker` is set, and the blocker text is shown beside it.
- Packet list `data-test="payment-packet-row"` per packet: label, Supreme, State (`blank` or the formatted amount), and a link `?month=&packet=<id>` labeled Edit.
- The packet form posts to `savePaymentPacketAction`. Fields `label`, `supreme`, `state`, `note`, hidden `id` when editing. `data-test="packet-label"`, `packet-supreme`, `packet-state`, `packet-save`. Prefill with `centsToDollarsInput` when editing. A delete button, only when editing, posts to `deletePaymentPacketAction`.
- Email packet button `data-test="email-packet"` on each row, disabled under the same blocker, posting `id` to `emailPacketAction`.

Use the existing `@kit/ui` form controls the hosting-cost form uses (`Input`, `Label`, `Button`, `Textarea`) so the page matches the portal. Show action errors from the returned `{ success: false, error }` with the same pattern as `hosting-cost-form-dialog.tsx` if that form is a client component. If the packet form must be a client component to read the action result, put only the form in `payment-packet-form.tsx` with `'use client'` and leave the worksheet markup in the server screen.

- [ ] **Step 3: Add the route**

`apps/portal/app/home/reports/page.tsx`:

- `await requirePermission('dashboard_finance', 'view')`.
- `today = chicagoToday()`. `month` from `searchParams.month` when it is in `worksheetMonthOptions(today)`, otherwise `defaultWorksheetMonth(today)`.
- `readDuesIfDeployed` around `finance.monthlyWorksheet(month)` and `finance.paymentPackets()`. When `deployed` is false, render the page header and the sentence `Not available yet`.
- `emailBlocker` from `reportEmailBlocker(readReportMailConfig(), user.email)`. Load the user with the same helper the dashboard page's layout uses (`requireUserInServerComponent` from `~/lib/server/require-user-in-server-component`) or from `enhanceAction`'s pattern is not available in a page. Use `requireUser` from `@kit/supabase/require-user` on `getSupabaseServerClient()` if that returns `{ data: { email } }`. Pass `data.email ?? null`.
- `editing` is the packet whose id equals `searchParams.packet`, or null.
- Render `DashboardTabsNav active="reports"` and `ReportsScreen`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @kit/finance typecheck
pnpm --filter portal typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/brand/src/config/paths.config.ts \
        packages/brand/i18n/messages/en/common.json \
        apps/portal/config/navigation.config.tsx \
        packages/features/finance/src/components/dashboard-tabs-nav.tsx \
        packages/features/finance/src/components/reports-screen.tsx \
        apps/portal/app/home/reports/page.tsx
git commit -m "$(cat <<'EOF'
feat(finance): add the reports page beside the dashboard

EOF
)"
```

Include `payment-packet-form.tsx` in the `git add` when that file was created.

---

### Task 6: Browser test

**Files:**

- Modify: `apps/e2e/tests/finance/finance.po.ts`
- Create: `apps/e2e/tests/finance/reports.spec.ts`

**Interfaces:**

- Consumes: `data-test="dashboard-reports-link"`, `worksheet-month`, `worksheet-roster`, `packet-label`, `packet-supreme`, `packet-save`, `payment-packet-row`. `AuthPageObject.signUpFlow`, `RbacPageObject.promoteToAdministrator`.

- [ ] **Step 1: Write the test**

Add `goToReports()` on `FinancePageObject` that `goto('/home/reports')`.

`apps/e2e/tests/finance/reports.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { chicagoToday } from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';
import { FinancePageObject } from './finance.po';

function previousMonthLabel(today: string): string {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const previous =
    month === 1
      ? `${year - 1}-12-01`
      : `${year}-${String(month - 1).padStart(2, '0')}-01`;
  const monthStart = previous < '2000-01-01' ? '2000-01-01' : previous;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthStart}T00:00:00Z`));
}

test.describe('finance reports', () => {
  test('an officer saves a Supreme packet and a member is refused', async ({
    browser,
  }) => {
    const officerPage = await browser.newPage();
    const officerAuth = new AuthPageObject(officerPage);
    const officerRbac = new RbacPageObject(officerPage);
    const officerFinance = new FinancePageObject(officerPage);
    const officerEmail = await officerAuth.signUpFlow('/home');
    await officerRbac.promoteToAdministrator(officerEmail);

    await officerFinance.goToDashboard();
    await officerPage.getByTestId('dashboard-reports-link').click();
    await expect(officerPage.getByTestId('worksheet-month')).toHaveValue(
      /.*/,
    );
    await expect(officerPage.getByTestId('worksheet-month')).toContainText(
      previousMonthLabel(chicagoToday()),
    );
    await expect(officerPage.getByTestId('worksheet-roster')).toBeVisible();

    const label = `Supreme e2e ${Date.now()}`;
    await officerPage.getByTestId('packet-label').fill(label);
    await officerPage.getByTestId('packet-supreme').fill('10.00');
    await officerPage.getByTestId('packet-save').click();
    await expect(officerPage.getByText(label)).toBeVisible();

    const memberPage = await browser.newPage();
    const memberAuth = new AuthPageObject(memberPage);
    await memberAuth.signUpFlow('/home');
    await memberPage.goto('/home/reports');
    await expect(memberPage).toHaveURL(/\/home\/?$/);
    await expect(memberPage.getByTestId('worksheet-roster')).toHaveCount(0);

    await officerPage.close();
    await memberPage.close();
  });
});
```

Do not click Email to me. The local stack may not have Resend configured, and Task 4 already covers sending.

- [ ] **Step 2: Run the test**

The header comment on `apps/e2e/tests/finance/finance.spec.ts` is the runbook: Docker, `pnpm supabase:web:start`, `pnpm stack:up`, then:

```bash
pnpm --filter web-e2e exec playwright test tests/finance/reports.spec.ts
```

Expected: the test passes. Then `pnpm stack:down` if this session started the stack.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/finance/finance.po.ts apps/e2e/tests/finance/reports.spec.ts
git commit -m "$(cat <<'EOF'
test(finance): cover the reports page for an officer and a member

EOF
)"
```
