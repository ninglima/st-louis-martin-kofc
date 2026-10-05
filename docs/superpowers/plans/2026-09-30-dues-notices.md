# Dues Notices by Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send dues reminders automatically by email through Resend (30 days before, on the due date, and 30 days after), and show the Financial Secretary each email's tracking status: sent, delivered, opened, clicked, bounced or complained.

**Architecture:**
- **Database:** Postgres picks who is due which notice and claims each row once, keyed on `(member_id, kind, cycle_date)`.
- **Daily job:** a Cloudflare cron on the router Worker calls a portal endpoint once a day. The endpoint claims the notices and, in live mode, sends them through Resend's batch API.
- **Webhook:** a Resend webhook, verified with a Svix signature, records each tracking event.
- **Code:** a new `@kit/dues-notices` package holds the config, templates, Resend client, signature check, job, webhook handler, reads and components.
- **UI:** a new `/home/dues-notices` page, a "Last notice" column on the existing lists, and a notices card on the member page.

**Tech Stack:**
- Supabase Postgres 17 with pgTAP
- Next.js 16 route handlers and pages
- Resend REST API, called with `fetch` (no SDK)
- `node:crypto` for the Svix HMAC
- Cloudflare Workers `scheduled`
- Vitest (jsdom for components; the Workers pool for the router)
- Playwright

**Spec:** `docs/superpowers/specs/2026-09-30-dues-notices-design.md`

## Global Constraints

- **Local database**
  - Never run `supabase db reset`.
  - Apply migrations with `pnpm exec supabase migration up`, from `apps/portal`.
  - Run database tests with `pnpm exec supabase test db`.
  - Docker, supabase and stack commands need the sandbox disabled.
- **pgTAP fixtures**
  - Include them with `\ir helpers/dues_fixtures.inc`, inside `begin; … rollback;`.
  - Available helpers: `tests.make_user(email, role_slug)`, `tests.make_member(number, user)` (sets `primary_email` to `<number>@example.com`), `tests.act_as(uid)` and `tests.act_as_service()`.
  - `administrator` has finance view and manage; `member` has neither.
- **Type regeneration**
  - Run `pnpm exec supabase gen types typescript --local --schema public`.
  - Write the output into BOTH `apps/portal/lib/database.types.ts` and `packages/supabase/src/database.types.ts`.
  - Re-add `__InternalSupabase`, re-apply every `HAND-CORRECTED` block verbatim, and keep both files byte-identical.
- **Dates and cycles**
  - "Today" is the America/Chicago date: `kit.council_today()` in SQL, `chicagoToday()` from `@kit/dues/schemas` in TypeScript.
  - Cycle date `c` = `paid_through` (exclusive). If there is none, `c` = `accepted_on`. A member whose `accepted_on` is after today is never notified.
- **Windows (inclusive)**

  | Notice | Window | Extra condition |
  |---|---|---|
  | `before_30` | `c−30` … `c−1` | none |
  | `due_date` | `c` … `c+7` | none |
  | `after_30` | `c+30` … `c+37` | status is `lapsed` or `due` |

  - One notice per member, kind and cycle date: unique `(member_id, kind, cycle_date)`.
- **Exclusions:** honorary members (`members.dues_level = 'honorary'`), `members.dues_notices_opt_out`, and a blank `primary_email`.
- **Modes**
  - `DUES_NOTICES_MODE` takes `off` (default), `dry-run` or `live`. The database stores them as `off`, `dry_run` and `live`.
  - No email is ever sent except in `live`. No test ever sends real email.
- **Privileges**
  - Tables: RLS enabled, no policies, all privileges revoked from `anon` and `authenticated`.
  - `dues_notices_claim`: `service_role` only.
  - Reads: `kit.assert_finance_view()`.
  - Opt-out setter: `kit.assert_finance_manage()`.
  - Every new function is `security definer set search_path = ''`.
  - `kit.*` functions are revoked from `public`, `anon` and `authenticated`. `kit_authenticated_grants.test.sql` pins the set `authenticated` may call, so it must keep passing unchanged.
- **Endpoints**
  - `POST /api/jobs/dues-notices` requires `Authorization: Bearer ${DUES_JOBS_SECRET}`, compared in constant time. A missing or wrong secret gets 401.
  - `POST /api/webhooks/resend` requires a valid Svix signature over the raw body, with a timestamp within 300 seconds.
- **Configuration:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (`whsec_…`), `DUES_NOTICES_MODE`, `DUES_NOTICES_FROM`, `DUES_NOTICES_REPLY_TO`, `DUES_JOBS_SECRET`, and the existing `NEXT_PUBLIC_SITE_URL`. Do not edit `.github/workflows/deploy.yml`; document it in the runbook instead.
- **Degrading gracefully:** new UI reads go through `readDuesIfDeployed` from `@kit/dues/lib/dues-schema`.
- **Hygiene**
  - No new external dependencies.
  - No new oxfmt failures (24 already exist).
  - Leave `.mcp.json`, `.claude/` and `apps/portal/supabase/snippets/` untouched and unstaged.

## Review Focus

1. **The daily job runs twice on one day.** This can happen with a cron retry or a manual call.
   - Expected: no member gets a second email.
   - Test: Task 1 (a second claim returns 0 rows) and Task 3 (the job with no new claims sends nothing).
2. **Resend returns an error for a batch or times out.**
   - Expected: those notices become `failed` with the error. Their claim remains, so they are not retried automatically, and the Financial Secretary can see them. The run still records its counts, and the endpoint returns 200 with the counts, so the cron does not retry in a loop.
   - Test: Task 3 (the live job with a failing fake Resend).
3. **A member's name or email contains HTML or odd characters,** such as `O'Brien <x>`.
   - Expected: the HTML email escapes them, and the plain-text version is readable.
   - Test: Task 2 (template escaping).
4. **Resend sends events for emails that aren't dues notices** (sign-in emails, if Resend is used for those later), or sends an event twice.
   - Expected: 200 is returned and nothing is stored or duplicated.
   - Test: Task 3 (webhook with an unknown ID and a replayed `svix-id`).
5. **The mode is set to `live` but the API key or From address is missing.**
   - Expected: nothing is claimed or sent, and the run records a clear error so the notices go out on the first correctly configured day.
   - Test: Task 3 (live with missing config).

---

### Task 1: Dues notices schema, selection and reads

**Files:**
- Create: `apps/portal/supabase/migrations/20260930120000_dues_notices.sql`
- Create: `apps/portal/supabase/tests/dues_notices.test.sql`
- Modify: both `database.types.ts` files (regenerated)

**Interfaces:**
- **Produces, tables:**
  - `public.dues_notices`
  - `public.dues_notice_events`
  - `public.dues_notice_runs`
  - the column `members.dues_notices_opt_out`
  - the enum `public.dues_notice_kind ('before_30','due_date','after_30')`
- **Produces, kit functions:**
  - `kit.dues_notice_due_at(p_today date)`, which returns `(member_id, first_name, last_name, membership_number, email text|null, kind, cycle_date, first_dues boolean, level_name, amount_cents)` for every eligible member currently inside a window, whether or not they have an email.
  - `kit.dues_notice_candidates_at(p_today date)`: the same columns, but only rows with an email and not already recorded.
  - `kit.dues_notices_claim_at(p_mode text, p_today date)`
  - `kit.dues_notice_tracking(p_notice_id uuid) returns text`
- **Produces, public functions:**
  - `dues_notices_claim(p_mode text)` returns `table (notice_id uuid, member_id uuid, first_name text, email text, kind public.dues_notice_kind, cycle_date date, first_dues boolean, level_name text, amount_cents integer)`. Callable by `service_role` only.
  - `dues_notices_list(p_kind text default null, p_tracking text default null, p_limit integer default 200)` returns `table (id uuid, member_id uuid, first_name text, last_name text, membership_number text, email text, kind text, cycle_date date, status text, tracking text, sent_at timestamptz, created_at timestamptz)`.
  - `dues_notice_events_for(p_notice_id uuid)` returns `table (type text, occurred_at timestamptz)`.
  - `dues_notices_last_run()` returns `table (ran_at timestamptz, mode text, candidates integer, sent integer, skipped integer, failed integer, error text)`.
  - `dues_notices_unreachable()` returns `table (member_id uuid, first_name text, last_name text, membership_number text, reason text, detail text)`, where `reason` is one of `'no_email'`, `'bounced'` or `'complained'`.
  - `dues_last_notices(p_member_ids uuid[])` returns `table (member_id uuid, kind text, sent_at timestamptz, tracking text)`.
  - `member_dues_notices(p_member_id uuid)` returns `table (id uuid, kind text, cycle_date date, sent_at timestamptz, tracking text)`.
  - `member_dues_notices_opt_out(p_member_id uuid) returns boolean`.
  - `set_member_dues_notices(p_member_id uuid, p_opt_out boolean) returns void`.

- [ ] **Step 1: Write the failing pgTAP test**

`apps/portal/supabase/tests/dues_notices.test.sql`:

```sql
begin;
\ir helpers/dues_fixtures.inc
select plan(28);

select tests.make_user('dn-admin@example.com', 'administrator') as admin \gset
select tests.make_user('dn-knight@example.com', 'member') as knight \gset

-- a member paid through today + p_offset (period start = end - 365)
create or replace function tests.dn_member(p_number text, p_offset integer, p_today date default '2040-10-15')
returns uuid language plpgsql as $$
declare v_id uuid := tests.make_member(p_number);
begin
  insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
  values (v_id, 'regular_contrib', 0, 'waived', p_today + p_offset - 365, p_today + p_offset - 365, p_today + p_offset);
  return v_id;
end $$;

-- window edges (today = 2040-10-15; c = today + offset)
select tests.dn_member('DN-P31', 31);   -- c-31: nothing
select tests.dn_member('DN-P30', 30);   -- c-30: before_30
select tests.dn_member('DN-P01', 1);    -- c-1:  before_30
select tests.dn_member('DN-Z00', 0);    -- c:    due_date
select tests.dn_member('DN-M07', -7);   -- c+7:  due_date
select tests.dn_member('DN-M08', -8);   -- c+8:  nothing
select tests.dn_member('DN-M29', -29);  -- c+29: nothing
select tests.dn_member('DN-M30', -30);  -- c+30: after_30
select tests.dn_member('DN-M37', -37);  -- c+37: after_30
select tests.dn_member('DN-M38', -38);  -- c+38: nothing

-- 1
select results_eq(
  $$select membership_number, kind::text from kit.dues_notice_candidates_at('2040-10-15')
     where membership_number like 'DN-%' order by membership_number$$,
  $$values ('DN-M07','due_date'), ('DN-M30','after_30'), ('DN-M37','after_30'),
           ('DN-P01','before_30'), ('DN-P30','before_30'), ('DN-Z00','due_date')$$,
  'each window starts and ends on the right day');

-- 2 cycle date is paid_through
select is((select cycle_date from kit.dues_notice_candidates_at('2040-10-15') where membership_number = 'DN-P30'),
          '2040-11-14'::date, 'cycle date is the paid-through date');

-- exclusions
select tests.dn_member('DN-HON', 0) as hon \gset
select tests.dn_member('DN-OPT', 0) as opt \gset
select tests.dn_member('DN-NOE', 0) as noe \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'hon', 'honorary');
select public.set_member_dues_notices(:'opt', true);
select tests.act_as_service();
update public.members set primary_email = '  ' where id = :'noe';

-- 3-6
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15') where membership_number = 'DN-HON'), 0, 'honorary members are not notified');
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15') where membership_number = 'DN-OPT'), 0, 'opted-out members are not notified');
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15') where membership_number = 'DN-NOE'), 0, 'members without an email are not candidates');
select is((select kind::text from kit.dues_notice_due_at('2040-10-15') where membership_number = 'DN-NOE'), 'due_date',
          'but they are still due a notice (for the could-not-notify list)');

-- 7 a member who paid (cycle moved) gets nothing for the old date
select tests.dn_member('DN-PAID', 0) as paid \gset
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'paid', 'regular_contrib', 5800, 'cash', '2040-10-10', '2040-10-15', '2040-10-15'::date + 365);
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15') where membership_number = 'DN-PAID'), 0,
          'paying moves the cycle date out of every window');

-- 8-9 first dues and future acceptance
select tests.make_member('DN-NEW') as newm \gset
select tests.make_member('DN-FUT') as fut \gset
select tests.act_as(:'admin');
select public.set_member_accepted_on(:'newm', '2040-10-12');
select public.set_member_accepted_on(:'fut', '2040-10-20');
select tests.act_as_service();
select results_eq($$select kind::text, first_dues from kit.dues_notice_candidates_at('2040-10-15') where membership_number = 'DN-NEW'$$,
                  $$values ('due_date', true)$$, 'a new member is due their first dues from the acceptance date');
select is((select count(*)::int from kit.dues_notice_due_at('2040-10-15') where membership_number = 'DN-FUT'), 0,
          'a member accepted in the future is never notified');

-- 10-13 claim: dry run, once only
select is((select count(*)::int from kit.dues_notices_claim_at('dry_run', '2040-10-15') where email ilike 'dn-%'), 7,
          'dry run claims every candidate with an email (6 edges + the new member)');
select is((select count(*)::int from public.dues_notices n join public.members m on m.id = n.member_id
            where m.membership_number like 'DN-%' and n.status = 'dry_run' and n.mode = 'dry_run'), 7, 'stored as dry_run');
select is((select count(*)::int from kit.dues_notices_claim_at('dry_run', '2040-10-15') where email ilike 'dn-%'), 0,
          'a second claim the same day returns nothing');
select throws_ok($$select * from kit.dues_notices_claim_at('loud', '2040-10-15')$$, 'P0001', 'unknown dues notice mode: loud', 'mode validated');

-- 14 live claim stores pending
select tests.dn_member('DN-LIVE', 5);
select is((select status from public.dues_notices where id =
            (select notice_id from kit.dues_notices_claim_at('live', '2040-10-15') where email = 'DN-LIVE@example.com')),
          'pending', 'live claims start pending');

-- 15-19 tracking order
select id as n1 from public.dues_notices n where n.member_id = (select id from public.members where membership_number = 'DN-LIVE') \gset
update public.dues_notices set status = 'sent', resend_email_id = 're_1', sent_at = now() where id = :'n1';
select is(kit.dues_notice_tracking(:'n1'), 'sent', 'sent with no events');
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n1', 'delivered', now(), 'svx-1');
select is(kit.dues_notice_tracking(:'n1'), 'delivered', 'delivered');
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n1', 'opened', now(), 'svx-2'), (:'n1', 'clicked', now(), 'svx-3');
select is(kit.dues_notice_tracking(:'n1'), 'clicked', 'clicked beats opened');
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n1', 'bounced', now(), 'svx-4');
select is(kit.dues_notice_tracking(:'n1'), 'bounced', 'bounced beats clicked');
select throws_ok($$insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id)
                   select id, 'opened', now(), 'svx-1' from public.dues_notices limit 1$$,
                 '23505', null, 'the same webhook message is stored once');

-- 20-21 could-not-notify (core, pinned to the fixture date)
select is((select reason from kit.dues_notices_unreachable_at('2040-10-15') where membership_number = 'DN-NOE'), 'no_email',
          'could-not-notify lists members without an email');
select is((select reason from kit.dues_notices_unreachable_at('2040-10-15') where membership_number = 'DN-LIVE'), 'bounced',
          'could-not-notify lists members whose last notice bounced');

-- 22-23 reads (as admin)
select id as live_member from public.members where membership_number = 'DN-LIVE' \gset
select tests.act_as(:'admin');
select is((select tracking from public.dues_last_notices(array[:'live_member'::uuid])), 'bounced',
          'last notice carries its tracking');
select is(public.member_dues_notices_opt_out(:'opt'), true, 'opt-out is readable');

-- 24-26 gates
select tests.act_as(:'knight');
select throws_ok($$select * from public.dues_notices_list()$$, '42501', 'forbidden', 'member cannot list notices');
select throws_ok(format($$select public.set_member_dues_notices(%L, false)$$, :'opt'), '42501', 'forbidden', 'member cannot opt others out');
select tests.act_as_service();
select is(has_function_privilege('authenticated', 'public.dues_notices_claim(text)', 'execute'), false,
          'claim is not callable by signed-in users');

-- 27-28 tables closed to clients
select is(has_table_privilege('authenticated', 'public.dues_notices', 'select'), false, 'no direct reads of notices');
select is(has_table_privilege('authenticated', 'public.dues_notice_events', 'insert'), false, 'no direct writes of events');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

From `apps/portal`, with the sandbox disabled: `pnpm exec supabase test db`

Expected: `dues_notices.test.sql` fails with `function tests.make_member… / public.set_member_dues_notices does not exist`. The 284 existing tests still pass.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20260930120000_dues_notices.sql`:

```sql
-- Dues notices: who is due which reminder, a once-only claim, tracking
-- events from Resend, and the reads behind the Dues notices page.

create type public.dues_notice_kind as enum ('before_30', 'due_date', 'after_30');

alter table public.members add column dues_notices_opt_out boolean not null default false;

create table public.dues_notices (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members (id) on delete restrict,
  kind            public.dues_notice_kind not null,
  cycle_date      date not null,
  email           text not null,
  mode            text not null check (mode in ('dry_run', 'live')),
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dry_run')),
  resend_email_id text unique,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (member_id, kind, cycle_date)
);

create table public.dues_notice_events (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null references public.dues_notices (id) on delete cascade,
  type        text not null check (type in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked')),
  occurred_at timestamptz not null,
  svix_id     text not null unique,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index dues_notice_events_notice_idx on public.dues_notice_events (notice_id);

create table public.dues_notice_runs (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  mode       text not null check (mode in ('off', 'dry_run', 'live')),
  candidates integer not null default 0,
  sent       integer not null default 0,
  skipped    integer not null default 0,
  failed     integer not null default 0,
  error      text
);

alter table public.dues_notices enable row level security;
alter table public.dues_notice_events enable row level security;
alter table public.dues_notice_runs enable row level security;
revoke all on public.dues_notices from anon, authenticated;
revoke all on public.dues_notice_events from anon, authenticated;
revoke all on public.dues_notice_runs from anon, authenticated;

create or replace function kit.dues_notice_due_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text, email text,
               kind public.dues_notice_kind, cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  with base as (
    select s.member_id, s.first_name, s.last_name, s.membership_number,
           nullif(btrim(m.primary_email), '') as email,
           s.level_name, s.amount_cents, s.dues_status,
           s.paid_through is null as first_dues,
           coalesce(s.paid_through, m.accepted_on) as c
      from kit.member_dues_snapshot(p_today) s
      join public.members m on m.id = s.member_id
     where s.dues_level <> 'honorary'
       and not m.dues_notices_opt_out
       and not (s.paid_through is null and m.accepted_on > p_today)
  ),
  kinds as (
    select b.*,
           case
             when p_today between b.c - 30 and b.c - 1 then 'before_30'::public.dues_notice_kind
             when p_today between b.c and b.c + 7 then 'due_date'::public.dues_notice_kind
             when p_today between b.c + 30 and b.c + 37 and b.dues_status in ('lapsed', 'due')
               then 'after_30'::public.dues_notice_kind
           end as kind
      from base b
     where b.c is not null
  )
  select k.member_id, k.first_name, k.last_name, k.membership_number, k.email,
         k.kind, k.c, k.first_dues, k.level_name, k.amount_cents
    from kinds k
   where k.kind is not null;
$$;

create or replace function kit.dues_notice_candidates_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text, email text,
               kind public.dues_notice_kind, cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select d.*
    from kit.dues_notice_due_at(p_today) d
   where d.email is not null
     and not exists (select 1 from public.dues_notices n
                      where n.member_id = d.member_id and n.kind = d.kind and n.cycle_date = d.cycle_date);
$$;

create or replace function kit.dues_notices_claim_at(p_mode text, p_today date)
returns table (notice_id uuid, member_id uuid, first_name text, email text, kind public.dues_notice_kind,
               cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_mode is null or p_mode not in ('dry_run', 'live') then
    raise exception 'unknown dues notice mode: %', coalesce(p_mode, '(none)');
  end if;

  return query
    with c as (
      select * from kit.dues_notice_candidates_at(p_today)
    ),
    ins as (
      insert into public.dues_notices (member_id, kind, cycle_date, email, mode, status, sent_at)
      select c.member_id, c.kind, c.cycle_date, c.email, p_mode,
             case when p_mode = 'dry_run' then 'dry_run' else 'pending' end,
             case when p_mode = 'dry_run' then now() end
        from c
      on conflict (member_id, kind, cycle_date) do nothing
      returning id, member_id, kind, cycle_date, email
    )
    select ins.id, ins.member_id, c.first_name, ins.email, ins.kind, ins.cycle_date,
           c.first_dues, c.level_name, c.amount_cents
      from ins
      join c on c.member_id = ins.member_id and c.kind = ins.kind and c.cycle_date = ins.cycle_date;
end $$;

create or replace function kit.dues_notice_tracking(p_notice_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when n.status in ('failed', 'dry_run', 'pending') then n.status
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'complained') then 'complained'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'bounced') then 'bounced'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'clicked') then 'clicked'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'opened') then 'opened'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'delivered') then 'delivered'
           else 'sent'
         end
    from public.dues_notices n
   where n.id = p_notice_id;
$$;

revoke all on function kit.dues_notice_due_at(date) from public, anon, authenticated;
revoke all on function kit.dues_notice_candidates_at(date) from public, anon, authenticated;
revoke all on function kit.dues_notices_claim_at(text, date) from public, anon, authenticated;
revoke all on function kit.dues_notice_tracking(uuid) from public, anon, authenticated;

-- The job's claim: service role only (the job authenticates with its own secret).
create or replace function public.dues_notices_claim(p_mode text)
returns table (notice_id uuid, member_id uuid, first_name text, email text, kind public.dues_notice_kind,
               cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query select * from kit.dues_notices_claim_at(p_mode, kit.council_today());
end $$;
revoke all on function public.dues_notices_claim(text) from public, anon, authenticated;
grant execute on function public.dues_notices_claim(text) to service_role;

create or replace function public.dues_notices_list(p_kind text default null, p_tracking text default null, p_limit integer default 200)
returns table (id uuid, member_id uuid, first_name text, last_name text, membership_number text, email text,
               kind text, cycle_date date, status text, tracking text, sent_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select * from (
      select n.id, n.member_id, m.first_name, m.last_name, m.membership_number, n.email,
             n.kind::text, n.cycle_date, n.status, kit.dues_notice_tracking(n.id) as tracking, n.sent_at, n.created_at
        from public.dues_notices n
        join public.members m on m.id = n.member_id
       where (p_kind is null or n.kind::text = p_kind)
    ) t
    where (p_tracking is null or t.tracking = p_tracking)
    order by t.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

create or replace function public.dues_notice_events_for(p_notice_id uuid)
returns table (type text, occurred_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query select e.type, e.occurred_at from public.dues_notice_events e
                where e.notice_id = p_notice_id order by e.occurred_at, e.created_at;
end $$;

create or replace function public.dues_notices_last_run()
returns table (ran_at timestamptz, mode text, candidates integer, sent integer, skipped integer, failed integer, error text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query select r.ran_at, r.mode, r.candidates, r.sent, r.skipped, r.failed, r.error
                 from public.dues_notice_runs r order by r.ran_at desc limit 1;
end $$;

create or replace function kit.dues_notices_unreachable_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text, reason text, detail text)
language sql stable security definer set search_path = '' as $$
  select d.member_id, d.first_name, d.last_name, d.membership_number, 'no_email', d.kind::text
    from kit.dues_notice_due_at(p_today) d
   where d.email is null
  union all
  select m.id, m.first_name, m.last_name, m.membership_number, t.tracking, t.email
    from (select distinct on (n.member_id) n.member_id, n.email, kit.dues_notice_tracking(n.id) as tracking
            from public.dues_notices n
           order by n.member_id, n.created_at desc) t
    join public.members m on m.id = t.member_id
   where t.tracking in ('bounced', 'complained');
$$;
revoke all on function kit.dues_notices_unreachable_at(date) from public, anon, authenticated;

create or replace function public.dues_notices_unreachable()
returns table (member_id uuid, first_name text, last_name text, membership_number text, reason text, detail text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.dues_notices_unreachable_at(kit.council_today());
end $$;

create or replace function public.dues_last_notices(p_member_ids uuid[])
returns table (member_id uuid, kind text, sent_at timestamptz, tracking text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select distinct on (n.member_id) n.member_id, n.kind::text, coalesce(n.sent_at, n.created_at), kit.dues_notice_tracking(n.id)
      from public.dues_notices n
     where n.member_id = any(p_member_ids)
     order by n.member_id, n.created_at desc;
end $$;

create or replace function public.member_dues_notices(p_member_id uuid)
returns table (id uuid, kind text, cycle_date date, sent_at timestamptz, tracking text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select n.id, n.kind::text, n.cycle_date, coalesce(n.sent_at, n.created_at), kit.dues_notice_tracking(n.id)
      from public.dues_notices n where n.member_id = p_member_id order by n.created_at desc;
end $$;

create or replace function public.member_dues_notices_opt_out(p_member_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return (select m.dues_notices_opt_out from public.members m where m.id = p_member_id);
end $$;

create or replace function public.set_member_dues_notices(p_member_id uuid, p_opt_out boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  update public.members set dues_notices_opt_out = coalesce(p_opt_out, false) where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

revoke all on function public.dues_notices_list(text, text, integer) from public, anon;
revoke all on function public.dues_notice_events_for(uuid) from public, anon;
revoke all on function public.dues_notices_last_run() from public, anon;
revoke all on function public.dues_notices_unreachable() from public, anon;
revoke all on function public.dues_last_notices(uuid[]) from public, anon;
revoke all on function public.member_dues_notices(uuid) from public, anon;
revoke all on function public.member_dues_notices_opt_out(uuid) from public, anon;
revoke all on function public.set_member_dues_notices(uuid, boolean) from public, anon;
grant execute on function public.dues_notices_list(text, text, integer) to authenticated;
grant execute on function public.dues_notice_events_for(uuid) to authenticated;
grant execute on function public.dues_notices_last_run() to authenticated;
grant execute on function public.dues_notices_unreachable() to authenticated;
grant execute on function public.dues_last_notices(uuid[]) to authenticated;
grant execute on function public.member_dues_notices(uuid) to authenticated;
grant execute on function public.member_dues_notices_opt_out(uuid) to authenticated;
grant execute on function public.set_member_dues_notices(uuid, boolean) to authenticated;
```

- [ ] **Step 4: Apply the migration and run the tests**

From `apps/portal`, with the sandbox disabled: `pnpm exec supabase migration up && pnpm exec supabase test db`

Expected: all 28 new tests pass, and every earlier test passes, including `kit_authenticated_grants.test.sql`.

Test 10's count is 7 = DN-P30, DN-P01, DN-Z00, DN-M07, DN-M30, DN-M37 and DN-NEW. The fixture emails are `<membership number>@example.com` (uppercase), so `email ilike 'dn-%'` matches only these. If a count differs, check the migration against the window rules first. Change a test value only when the plan's own arithmetic is wrong, and say why in your report.

To re-apply an edited migration, the statements before the functions are not re-runnable. Drop the new objects in one psql session, in reverse order, then re-run the file: `docker exec -i supabase_db_next-supabase-saas-kit-turbo-lite psql -U postgres -v ON_ERROR_STOP=1`.

- [ ] **Step 5: Regenerate types**

Follow the rules in Global Constraints. Add a `HAND-CORRECTED` block, in both files, making these return fields `string | null`:
- `email` in `dues_notices_claim`;
- `sent_at` and `error` in `dues_notices_list`;
- `error` in `dues_notices_last_run`;
- `detail` in `dues_notices_unreachable`.

`dues_notices_list.sent_at` and `dues_notices_last_run.error` can be null. The others only if the generator marks them nullable. Check with `cmp`: expect no output.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/supabase/migrations/20260930120000_dues_notices.sql apps/portal/supabase/tests/dues_notices.test.sql \
  apps/portal/lib/database.types.ts packages/supabase/src/database.types.ts
git commit -m "feat(notices): choose, claim and track dues notices in Postgres"
```

---

### Task 2: `@kit/dues-notices` package: config, templates, Resend client, signature check

**Files:**
- Create: `packages/features/dues-notices/package.json`, `tsconfig.json`, `vitest.config.ts`. Copy the three files from `packages/features/finance` and change the name to `@kit/dues-notices`. Keep the jsdom environment and the `test/setup.ts` cleanup. Add `"@kit/dues": "workspace:*"` to devDependencies.
- Create: `packages/features/dues-notices/test/setup.ts` (a copy of finance's)
- Create: `src/types.ts`, `src/config.ts`, `src/templates.ts`, `src/resend.ts`, `src/svix.ts`, `src/tracking.ts`
- Tests: `src/config.test.ts`, `src/templates.test.ts`, `src/resend.test.ts`, `src/svix.test.ts`, `src/tracking.test.ts`
- Modify: `apps/portal/package.json` (`"@kit/dues-notices": "workspace:*"`), `apps/portal/next.config.mjs` (add to `INTERNAL_PACKAGES`)

**Interfaces:**
- Produces:
  - Types:
    - `NoticeKind = 'before_30' | 'due_date' | 'after_30'`
    - `NoticesMode = 'off' | 'dry_run' | 'live'`
    - `Tracking = 'pending' | 'dry_run' | 'failed' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained'`
    - `ClaimedNotice { noticeId; memberId; firstName; email; kind: NoticeKind; cycleDate: string; firstDues: boolean; levelName; amountCents }`
  - `readNoticesConfig(env?: Record<string, string | undefined>): NoticesConfig`, where `NoticesConfig = { mode, apiKey, webhookSecret, jobsSecret, from, replyTo, siteUrl, missingForLive: string[] }`
  - `renderNotice(input: ClaimedNotice, siteUrl: string): { subject: string; html: string; text: string }`
  - `sendBatch(apiKey: string, emails: OutgoingEmail[], fetchImpl?: typeof fetch): Promise<SendResult[]>`, where:
    - `OutgoingEmail = { from; to: string; replyTo?: string; subject; html; text; tags: { name: string; value: string }[] }`
    - `SendResult = { ok: true; id: string } | { ok: false; error: string }`
    - results come back in input order
  - `verifySvixSignature({ secret, id, timestamp, signature, body, nowSeconds }): boolean`
  - `TRACKING_LABELS: Record<Tracking, string>`, `isProblem(t: Tracking): boolean`, `KIND_LABELS: Record<NoticeKind, string>`

- [ ] **Step 1: Write the failing tests**

`src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { readNoticesConfig } from './config';

describe('readNoticesConfig', () => {
  it('defaults to off', () => {
    expect(readNoticesConfig({}).mode).toBe('off');
    expect(readNoticesConfig({ DUES_NOTICES_MODE: 'LOUD' }).mode).toBe('off');
  });

  it('reads dry-run and live', () => {
    expect(readNoticesConfig({ DUES_NOTICES_MODE: 'dry-run' }).mode).toBe('dry_run');
    expect(readNoticesConfig({ DUES_NOTICES_MODE: ' live ' }).mode).toBe('live');
  });

  it('lists what live mode is missing', () => {
    expect(readNoticesConfig({ DUES_NOTICES_MODE: 'live' }).missingForLive).toEqual([
      'RESEND_API_KEY',
      'DUES_NOTICES_FROM',
      'NEXT_PUBLIC_SITE_URL',
    ]);
    expect(
      readNoticesConfig({
        DUES_NOTICES_MODE: 'live',
        RESEND_API_KEY: 're_x',
        DUES_NOTICES_FROM: 'FS <dues@example.org>',
        NEXT_PUBLIC_SITE_URL: 'https://example.org/',
      }),
    ).toMatchObject({ missingForLive: [], siteUrl: 'https://example.org' });
  });
});
```

`src/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { renderNotice } from './templates';

const base = {
  noticeId: 'n1',
  memberId: 'm1',
  firstName: 'John',
  email: 'john@example.com',
  kind: 'before_30' as const,
  cycleDate: '2026-11-14',
  firstDues: false,
  levelName: 'Regular',
  amountCents: 5000,
};

describe('renderNotice', () => {
  it('reminds before the due date with the last covered day and the amount', () => {
    const n = renderNotice(base, 'https://council.example.org');
    expect(n.subject).toBe('Your council dues renew soon');
    expect(n.text).toContain('paid through November 13, 2026');
    expect(n.text).toContain('$50.00');
    expect(n.text).toContain('https://council.example.org/home/checkout');
    expect(n.html).toContain('href="https://council.example.org/home/checkout"');
  });

  it('says dues are due on the due date, and past due after', () => {
    expect(renderNotice({ ...base, kind: 'due_date' }, 'https://x.org').subject).toBe('Your council dues are due');
    expect(renderNotice({ ...base, kind: 'after_30' }, 'https://x.org').subject).toBe('Your council dues are past due');
  });

  it('welcomes a new member owing first dues', () => {
    const n = renderNotice({ ...base, kind: 'due_date', firstDues: true }, 'https://x.org');
    expect(n.text).toContain('first dues');
    expect(n.text).not.toContain('paid through');
  });

  it('escapes names in HTML', () => {
    const n = renderNotice({ ...base, firstName: `O'Brien <b>` }, 'https://x.org');
    expect(n.html).toContain('O&#39;Brien &lt;b&gt;');
    expect(n.html).not.toContain('<b>');
    expect(n.text).toContain(`O'Brien <b>`);
  });

  it('tells members how to stop reminders', () => {
    expect(renderNotice(base, 'https://x.org').text).toContain('reply to this email');
  });
});
```

`src/resend.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { sendBatch } from './resend';

const email = (i: number) => ({
  from: 'FS <dues@example.org>',
  to: `m${i}@example.com`,
  subject: 's',
  html: 'h',
  text: 't',
  tags: [{ name: 'notice_id', value: `n${i}` }],
});

describe('sendBatch', () => {
  it('posts batches of 100 and returns ids in order', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[];
      return new Response(JSON.stringify({ data: body.map((_, i) => ({ id: `re_${i}` })) }), { status: 200 });
    });
    const results = await sendBatch('re_key', Array.from({ length: 150 }, (_, i) => email(i)), fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.resend.com/emails/batch');
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer re_key' });
    expect(JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body))[0]).toMatchObject({
      to: ['m0@example.com'],
      tags: [{ name: 'notice_id', value: 'n0' }],
    });
    expect(results).toHaveLength(150);
    expect(results[0]).toEqual({ ok: true, id: 're_0' });
    expect(results[120]).toEqual({ ok: true, id: 're_20' });
  });

  it('marks a whole batch failed on an HTTP error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'Invalid from' }), { status: 422 }));
    const results = await sendBatch('re_key', [email(1), email(2)], fetchImpl as never);
    expect(results).toEqual([
      { ok: false, error: 'Resend 422: Invalid from' },
      { ok: false, error: 'Resend 422: Invalid from' },
    ]);
  });

  it('marks a batch failed when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('timeout');
    });
    expect(await sendBatch('re_key', [email(1)], fetchImpl as never)).toEqual([{ ok: false, error: 'timeout' }]);
  });
});
```

`src/svix.test.ts`:

```ts
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySvixSignature } from './svix';

const rawKey = Buffer.from('super-secret-key-for-tests');
const secret = `whsec_${rawKey.toString('base64')}`;
const sign = (id: string, ts: string, body: string) =>
  `v1,${createHmac('sha256', rawKey).update(`${id}.${ts}.${body}`).digest('base64')}`;

describe('verifySvixSignature', () => {
  const body = '{"type":"email.delivered"}';
  const ts = '1790000000';

  it('accepts a valid signature, including among several', () => {
    const good = sign('msg_1', ts, body);
    expect(verifySvixSignature({ secret, id: 'msg_1', timestamp: ts, signature: good, body, nowSeconds: 1790000100 })).toBe(true);
    expect(
      verifySvixSignature({ secret, id: 'msg_1', timestamp: ts, signature: `v1,Zm9v ${good}`, body, nowSeconds: 1790000100 }),
    ).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, or an old timestamp', () => {
    const good = sign('msg_1', ts, body);
    expect(verifySvixSignature({ secret, id: 'msg_1', timestamp: ts, signature: good, body: body + ' ', nowSeconds: 1790000100 })).toBe(false);
    expect(
      verifySvixSignature({ secret: `whsec_${Buffer.from('other').toString('base64')}`, id: 'msg_1', timestamp: ts, signature: good, body, nowSeconds: 1790000100 }),
    ).toBe(false);
    expect(verifySvixSignature({ secret, id: 'msg_1', timestamp: ts, signature: good, body, nowSeconds: 1790000301 })).toBe(false);
    expect(verifySvixSignature({ secret, id: 'msg_1', timestamp: 'abc', signature: good, body, nowSeconds: 1790000100 })).toBe(false);
  });
});
```

`src/tracking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isProblem, KIND_LABELS, TRACKING_LABELS } from './tracking';

describe('tracking labels', () => {
  it('labels every state and flags problems', () => {
    expect(TRACKING_LABELS.clicked).toBe('Clicked');
    expect(TRACKING_LABELS.dry_run).toBe('Dry run');
    expect(isProblem('bounced')).toBe(true);
    expect(isProblem('complained')).toBe(true);
    expect(isProblem('failed')).toBe(true);
    expect(isProblem('opened')).toBe(false);
    expect(KIND_LABELS.after_30).toBe('30 days after');
  });
});
```

Scaffold the package (Step 1 of Files), run `pnpm install` with `allowed_domains: ["registry.npmjs.org"]`, then run `pnpm --filter @kit/dues-notices test:unit`.
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 2: Implement**

`src/types.ts`:

```ts
export type NoticeKind = 'before_30' | 'due_date' | 'after_30';
export type NoticesMode = 'off' | 'dry_run' | 'live';
export type Tracking =
  | 'pending' | 'dry_run' | 'failed' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';

export interface ClaimedNotice {
  noticeId: string;
  memberId: string;
  firstName: string;
  email: string;
  kind: NoticeKind;
  /** Exclusive paid-through (or acceptance) date, YYYY-MM-DD. */
  cycleDate: string;
  firstDues: boolean;
  levelName: string;
  amountCents: number;
}

export interface NoticeRow {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  email: string;
  kind: NoticeKind;
  cycleDate: string;
  status: string;
  tracking: Tracking;
  sentAt: string | null;
  createdAt: string;
}

export interface LastNotice {
  memberId: string;
  kind: NoticeKind;
  sentAt: string;
  tracking: Tracking;
}

export interface NoticeRun {
  ranAt: string;
  mode: NoticesMode;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
}

export interface Unreachable {
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  reason: 'no_email' | 'bounced' | 'complained';
  detail: string | null;
}

export type NoticesActionResult = { success: true } | { success: false; error: string };
```

`src/config.ts`:

```ts
import type { NoticesMode } from './types';

export interface NoticesConfig {
  mode: NoticesMode;
  apiKey: string;
  webhookSecret: string;
  jobsSecret: string;
  from: string;
  replyTo: string;
  siteUrl: string;
  /** Env names live mode needs but lacks; empty when live can send. */
  missingForLive: string[];
}

function parseMode(raw: string | undefined): NoticesMode {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === 'live') return 'live';
  if (value === 'dry-run' || value === 'dry_run') return 'dry_run';

  return 'off';
}

export function readNoticesConfig(env: Record<string, string | undefined> = process.env): NoticesConfig {
  const config = {
    mode: parseMode(env.DUES_NOTICES_MODE),
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
    webhookSecret: env.RESEND_WEBHOOK_SECRET?.trim() ?? '',
    jobsSecret: env.DUES_JOBS_SECRET?.trim() ?? '',
    from: env.DUES_NOTICES_FROM?.trim() ?? '',
    replyTo: env.DUES_NOTICES_REPLY_TO?.trim() ?? '',
    siteUrl: (env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, ''),
  };

  const missingForLive = [
    ['RESEND_API_KEY', config.apiKey],
    ['DUES_NOTICES_FROM', config.from],
    ['NEXT_PUBLIC_SITE_URL', config.siteUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  return { ...config, missingForLive };
}
```

`src/templates.ts`:

```ts
import { formatAmountCents } from '@kit/dues/lib/format-amount';

import type { ClaimedNotice, NoticeKind } from './types';

const SUBJECTS: Record<NoticeKind, string> = {
  before_30: 'Your council dues renew soon',
  due_date: 'Your council dues are due',
  after_30: 'Your council dues are past due',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 2026-11-14 (exclusive) -> "November 13, 2026", the last day covered. */
function lastCoveredDay(cycleDate: string): string {
  const d = new Date(`${cycleDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);

  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
}

function body(n: ClaimedNotice): string[] {
  const amount = formatAmountCents(n.amountCents);

  if (n.firstDues) {
    return [
      `Welcome to the council. Your first dues of ${amount} (${n.levelName}) are now due.`,
      'You can pay online in the member portal.',
    ];
  }

  const through = lastCoveredDay(n.cycleDate);

  switch (n.kind) {
    case 'before_30':
      return [`Your dues are paid through ${through}.`, `Renewing now keeps you current: ${amount} (${n.levelName}).`];
    case 'due_date':
      return [`Your dues were paid through ${through} and are now due.`, `Your renewal is ${amount} (${n.levelName}).`];
    case 'after_30':
      return [`Your dues were paid through ${through} and are now past due.`, `Your renewal is ${amount} (${n.levelName}).`];
  }
}

export function renderNotice(n: ClaimedNotice, siteUrl: string): { subject: string; html: string; text: string } {
  const payUrl = `${siteUrl}/home/checkout`;
  const lines = body(n);
  const stop = 'To stop these reminders, reply to this email and let the Financial Secretary know.';

  const text = [`Dear ${n.firstName},`, '', ...lines, '', `Pay dues: ${payUrl}`, '', stop].join('\n');

  const html = [
    `<p>Dear ${escapeHtml(n.firstName)},</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    `<p><a href="${escapeHtml(payUrl)}">Pay dues</a></p>`,
    `<p style="color:#666;font-size:12px">${escapeHtml(stop)}</p>`,
  ].join('\n');

  return { subject: SUBJECTS[n.kind], html, text };
}
```

`src/resend.ts`:

```ts
export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  tags: { name: string; value: string }[];
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

const BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;

async function sendOne(apiKey: string, batch: OutgoingEmail[], fetchImpl: typeof fetch): Promise<SendResult[]> {
  try {
    const response = await fetchImpl(BATCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        batch.map((e) => ({
          from: e.from,
          to: [e.to],
          ...(e.replyTo ? { reply_to: e.replyTo } : {}),
          subject: e.subject,
          html: e.html,
          text: e.text,
          tags: e.tags,
        })),
      ),
    });

    const json = (await response.json().catch(() => ({}))) as { data?: { id: string }[]; message?: string };

    if (!response.ok) {
      const error = `Resend ${response.status}: ${json.message ?? response.statusText}`;
      return batch.map(() => ({ ok: false, error }));
    }

    return batch.map((_, i) => {
      const id = json.data?.[i]?.id;
      return id ? { ok: true, id } : { ok: false, error: 'Resend returned no id' };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return batch.map(() => ({ ok: false, error: message }));
  }
}

/** Sends through Resend's batch API, 100 per request; results in input order. */
export async function sendBatch(
  apiKey: string,
  emails: OutgoingEmail[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    results.push(...(await sendOne(apiKey, emails.slice(i, i + BATCH_SIZE), fetchImpl)));
  }

  return results;
}
```

`src/svix.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

/** Svix (Resend webhooks): v1 = base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)),
 * key = base64-decoded part of `whsec_...`; the header may carry several
 * space-separated `v1,<sig>` values. */
export function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  nowSeconds: number;
}): boolean {
  const ts = Number(input.timestamp);

  if (!input.secret.startsWith('whsec_') || !input.id || !Number.isFinite(ts)) return false;
  if (Math.abs(input.nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(input.secret.slice('whsec_'.length), 'base64');
  const expected = createHmac('sha256', key).update(`${input.id}.${input.timestamp}.${input.body}`).digest();

  return input.signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

`src/tracking.ts`:

```ts
import type { NoticeKind, Tracking } from './types';

export const TRACKING_LABELS: Record<Tracking, string> = {
  pending: 'Pending',
  dry_run: 'Dry run',
  failed: 'Failed',
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
  complained: 'Complained',
};

export const KIND_LABELS: Record<NoticeKind, string> = {
  before_30: '30 days before',
  due_date: 'Due date',
  after_30: '30 days after',
};

export function isProblem(tracking: Tracking): boolean {
  return tracking === 'bounced' || tracking === 'complained' || tracking === 'failed';
}
```

Set up the package `exports` as follows:
- `./types`, `./config`, `./templates`, `./resend`, `./svix` and `./tracking`, each mapped to `./src/<name>.ts`;
- `./server/*` mapped to `./src/server/*.ts`;
- `./components/*` mapped to `./src/components/*.tsx`.

- [ ] **Step 3: Run the tests and checks**

`pnpm --filter @kit/dues-notices test:unit && pnpm typecheck && pnpm lint && pnpm exec oxfmt --check packages/features/dues-notices`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/features/dues-notices apps/portal/package.json apps/portal/next.config.mjs pnpm-lock.yaml
git commit -m "feat(notices): add config, templates, Resend client and webhook signature check"
```

---

### Task 3: The daily job, the Resend webhook and their endpoints

**Files:**
- Create: `packages/features/dues-notices/src/server/job.ts`, `job.test.ts`
- Create: `packages/features/dues-notices/src/server/webhook.ts`, `webhook.test.ts`
- Create: `apps/portal/app/api/jobs/dues-notices/route.ts`
- Create: `apps/portal/app/api/webhooks/resend/route.ts`
- Modify: `compose.yaml`. In the `portal` service's `environment`, add `DUES_NOTICES_MODE: dry-run`, `DUES_JOBS_SECRET: local-jobs`, `DUES_NOTICES_FROM: 'Council Financial Secretary <dues@localhost>'` and `DUES_NOTICES_REPLY_TO: fs@localhost`.
- Modify: `apps/portal/.env.development`. Add commented examples of the six variables, with `DUES_NOTICES_MODE=off`.

**Interfaces:**
- **Consumes:** `dues_notices_claim`; the tables `dues_notices`, `dues_notice_events` and `dues_notice_runs` (all through the service-role client); and everything Task 2 produced.
- **Produces:**
  - `runDuesNoticesJob({ client, config, fetchImpl? }): Promise<JobResult>`, with `JobResult = { mode: NoticesMode; candidates: number; sent: number; skipped: number; failed: number; error: string | null }`.
  - `handleResendWebhook({ client, secret, headers: Headers, body: string, nowSeconds }): Promise<{ status: number; stored: boolean }>`.
  - The endpoints `POST /api/jobs/dues-notices` and `POST /api/webhooks/resend`.

- [ ] **Step 1: Write the failing tests**

`src/server/job.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { runDuesNoticesJob } from './job';

const claimed = [
  { notice_id: 'n1', member_id: 'm1', first_name: 'A', email: 'a@x.org', kind: 'before_30', cycle_date: '2026-11-14',
    first_dues: false, level_name: 'Regular', amount_cents: 5000 },
  { notice_id: 'n2', member_id: 'm2', first_name: 'B', email: 'b@x.org', kind: 'due_date', cycle_date: '2026-10-15',
    first_dues: false, level_name: 'Regular', amount_cents: 5000 },
];

function fakeClient(rows: unknown[] = claimed) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const runs: Record<string, unknown>[] = [];
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
  const client = {
    rpc,
    from: (table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        if (table === 'dues_notice_runs') runs.push(values);
        return { error: null };
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updates.push({ id, values });
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as never, rpc, updates, runs };
}

const live = {
  mode: 'live' as const, apiKey: 're_k', webhookSecret: '', jobsSecret: 's', from: 'FS <d@x.org>',
  replyTo: 'fs@x.org', siteUrl: 'https://x.org', missingForLive: [],
};

describe('runDuesNoticesJob', () => {
  it('does nothing but record a run when off', async () => {
    const { client, rpc, runs } = fakeClient();
    const result = await runDuesNoticesJob({ client, config: { ...live, mode: 'off' } });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'off', candidates: 0, sent: 0 });
    expect(runs).toEqual([expect.objectContaining({ mode: 'off' })]);
  });

  it('claims but sends nothing in dry run', async () => {
    const { client, rpc, runs } = fakeClient();
    const fetchImpl = vi.fn();
    const result = await runDuesNoticesJob({ client, config: { ...live, mode: 'dry_run' }, fetchImpl: fetchImpl as never });
    expect(rpc).toHaveBeenCalledWith('dues_notices_claim', { p_mode: 'dry_run' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'dry_run', candidates: 2, sent: 0, skipped: 2, failed: 0 });
    expect(runs[0]).toMatchObject({ mode: 'dry_run', candidates: 2, skipped: 2 });
  });

  it('sends live and marks each notice sent with its Resend id', async () => {
    const { client, updates } = fakeClient();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 're_1' }, { id: 're_2' }] }), { status: 200 }));
    const result = await runDuesNoticesJob({ client, config: live, fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ mode: 'live', candidates: 2, sent: 2, failed: 0 });
    expect(updates).toEqual([
      { id: 'n1', values: expect.objectContaining({ status: 'sent', resend_email_id: 're_1' }) },
      { id: 'n2', values: expect.objectContaining({ status: 'sent', resend_email_id: 're_2' }) },
    ]);
  });

  it('marks notices failed when Resend fails, and still records the run', async () => {
    const { client, updates, runs } = fakeClient();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'bad from' }), { status: 422 }));
    const result = await runDuesNoticesJob({ client, config: live, fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ sent: 0, failed: 2 });
    expect(updates[0]!.values).toMatchObject({ status: 'failed', error: 'Resend 422: bad from' });
    expect(runs[0]).toMatchObject({ failed: 2 });
  });

  it('claims nothing when live is missing configuration', async () => {
    const { client, rpc, runs } = fakeClient();
    const result = await runDuesNoticesJob({ client, config: { ...live, apiKey: '', missingForLive: ['RESEND_API_KEY'] } });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.error).toBe('Live mode needs RESEND_API_KEY');
    expect(runs[0]).toMatchObject({ mode: 'live', error: 'Live mode needs RESEND_API_KEY' });
  });

  it('sends nothing when there is nothing new to claim', async () => {
    const { client } = fakeClient([]);
    const fetchImpl = vi.fn();
    expect(await runDuesNoticesJob({ client, config: live, fetchImpl: fetchImpl as never })).toMatchObject({ candidates: 0, sent: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

`src/server/webhook.test.ts`:

```ts
import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { handleResendWebhook } from './webhook';

const rawKey = Buffer.from('webhook-key');
const secret = `whsec_${rawKey.toString('base64')}`;
const now = 1790000000;

function signed(body: string, id = 'msg_1') {
  const signature = `v1,${createHmac('sha256', rawKey).update(`${id}.${now}.${body}`).digest('base64')}`;
  return new Headers({ 'svix-id': id, 'svix-timestamp': String(now), 'svix-signature': signature });
}

function fakeClient(noticeId: string | null) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: noticeId ? { id: noticeId } : null, error: null }) }),
      }),
      upsert: async (values: Record<string, unknown>, opts: unknown) => {
        if (table === 'dues_notice_events') inserted.push({ ...values, opts });
        return { error: null };
      },
    }),
  };
  return { client: client as never, inserted };
}

const event = JSON.stringify({ type: 'email.opened', created_at: '2026-10-01T12:00:00Z', data: { email_id: 're_1' } });

describe('handleResendWebhook', () => {
  it('rejects a bad signature', async () => {
    const { client, inserted } = fakeClient('n1');
    const headers = signed(event);
    headers.set('svix-signature', 'v1,Zm9v');
    expect(await handleResendWebhook({ client, secret, headers, body: event, nowSeconds: now })).toEqual({ status: 400, stored: false });
    expect(inserted).toHaveLength(0);
  });

  it('stores an event for a dues notice, keyed by the svix id', async () => {
    const { client, inserted } = fakeClient('n1');
    expect(await handleResendWebhook({ client, secret, headers: signed(event), body: event, nowSeconds: now })).toEqual({
      status: 200,
      stored: true,
    });
    expect(inserted[0]).toMatchObject({
      notice_id: 'n1', type: 'opened', occurred_at: '2026-10-01T12:00:00Z', svix_id: 'msg_1',
      opts: { onConflict: 'svix_id', ignoreDuplicates: true },
    });
  });

  it('acknowledges emails that are not dues notices without storing them', async () => {
    const { client, inserted } = fakeClient(null);
    expect(await handleResendWebhook({ client, secret, headers: signed(event), body: event, nowSeconds: now })).toEqual({
      status: 200,
      stored: false,
    });
    expect(inserted).toHaveLength(0);
  });

  it('acknowledges event types it does not track', async () => {
    const { client, inserted } = fakeClient('n1');
    const other = JSON.stringify({ type: 'contact.created', created_at: '2026-10-01T12:00:00Z', data: {} });
    expect(await handleResendWebhook({ client, secret, headers: signed(other), body: other, nowSeconds: now })).toEqual({
      status: 200,
      stored: false,
    });
    expect(inserted).toHaveLength(0);
  });

  it('refuses when no secret is configured', async () => {
    const { client } = fakeClient('n1');
    expect((await handleResendWebhook({ client, secret: '', headers: signed(event), body: event, nowSeconds: now })).status).toBe(500);
  });
});
```

Run `pnpm --filter @kit/dues-notices test:unit`. Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 2: Implement the job and webhook**

`src/server/job.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { NoticesConfig } from '../config';
import { sendBatch } from '../resend';
import { renderNotice } from '../templates';
import type { ClaimedNotice, NoticeKind, NoticesMode } from '../types';

type Client = SupabaseClient<Database>;

export interface JobResult {
  mode: NoticesMode;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
}

async function recordRun(client: Client, result: JobResult) {
  await client.from('dues_notice_runs').insert({
    mode: result.mode,
    candidates: result.candidates,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    error: result.error,
  });
}

/** Runs once a day (and is safe to run again): claims today's notices once
 * each, and in live mode sends them. Call with the SERVICE-ROLE client. */
export async function runDuesNoticesJob({
  client,
  config,
  fetchImpl = fetch,
}: {
  client: Client;
  config: NoticesConfig;
  fetchImpl?: typeof fetch;
}): Promise<JobResult> {
  const result: JobResult = { mode: config.mode, candidates: 0, sent: 0, skipped: 0, failed: 0, error: null };

  if (config.mode === 'off') {
    await recordRun(client, result);
    return result;
  }

  if (config.mode === 'live' && config.missingForLive.length > 0) {
    result.error = `Live mode needs ${config.missingForLive.join(', ')}`;
    await recordRun(client, result);
    return result;
  }

  const { data, error } = await client.rpc('dues_notices_claim', { p_mode: config.mode });

  if (error) {
    result.error = error.message;
    await recordRun(client, result);
    return result;
  }

  const claimed: ClaimedNotice[] = (data ?? []).map((r) => ({
    noticeId: r.notice_id,
    memberId: r.member_id,
    firstName: r.first_name,
    email: r.email as string,
    kind: r.kind as NoticeKind,
    cycleDate: r.cycle_date,
    firstDues: r.first_dues,
    levelName: r.level_name,
    amountCents: r.amount_cents,
  }));

  result.candidates = claimed.length;

  if (config.mode === 'dry_run' || claimed.length === 0) {
    result.skipped = config.mode === 'dry_run' ? claimed.length : 0;
    await recordRun(client, result);
    return result;
  }

  const emails = claimed.map((n) => {
    const rendered = renderNotice(n, config.siteUrl);
    return {
      from: config.from,
      to: n.email,
      replyTo: config.replyTo || undefined,
      ...rendered,
      tags: [
        { name: 'notice_id', value: n.noticeId },
        { name: 'kind', value: n.kind },
      ],
    };
  });

  const sent = await sendBatch(config.apiKey, emails, fetchImpl);

  for (const [i, outcome] of sent.entries()) {
    const notice = claimed[i]!;

    if (outcome.ok) {
      result.sent += 1;
      await client
        .from('dues_notices')
        .update({ status: 'sent', resend_email_id: outcome.id, sent_at: new Date().toISOString() })
        .eq('id', notice.noticeId);
    } else {
      result.failed += 1;
      await client.from('dues_notices').update({ status: 'failed', error: outcome.error }).eq('id', notice.noticeId);
    }
  }

  await recordRun(client, result);
  return result;
}
```

`src/server/webhook.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { verifySvixSignature } from '../svix';

type Client = SupabaseClient<Database>;

const TRACKED = new Set(['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked']);

/** Resend webhook: verify, match the email to a dues notice, store the event
 * once. Anything that isn't a dues notice is acknowledged and ignored.
 * Call with the SERVICE-ROLE client. */
export async function handleResendWebhook({
  client,
  secret,
  headers,
  body,
  nowSeconds,
}: {
  client: Client;
  secret: string;
  headers: Headers;
  body: string;
  nowSeconds: number;
}): Promise<{ status: number; stored: boolean }> {
  if (!secret) return { status: 500, stored: false };

  const id = headers.get('svix-id') ?? '';
  const valid = verifySvixSignature({
    secret,
    id,
    timestamp: headers.get('svix-timestamp') ?? '',
    signature: headers.get('svix-signature') ?? '',
    body,
    nowSeconds,
  });

  if (!valid) return { status: 400, stored: false };

  const event = JSON.parse(body) as { type?: string; created_at?: string; data?: { email_id?: string } };
  const type = (event.type ?? '').replace(/^email\./, '');
  const emailId = event.data?.email_id;

  if (!TRACKED.has(type) || !emailId) return { status: 200, stored: false };

  const { data: notice } = await client.from('dues_notices').select('id').eq('resend_email_id', emailId).maybeSingle();

  if (!notice) return { status: 200, stored: false };

  const { error } = await client.from('dues_notice_events').upsert(
    {
      notice_id: notice.id,
      type,
      occurred_at: event.created_at ?? new Date(nowSeconds * 1000).toISOString(),
      svix_id: id,
      payload: event as never,
    },
    { onConflict: 'svix_id', ignoreDuplicates: true },
  );

  if (error) throw error;

  return { status: 200, stored: true };
}
```

- [ ] **Step 3: Add the two endpoints**

`apps/portal/app/api/jobs/dues-notices/route.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { readNoticesConfig } from '@kit/dues-notices/config';
import { runDuesNoticesJob } from '@kit/dues-notices/server/job';

function authorized(header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  const config = readNoticesConfig();

  if (!authorized(request.headers.get('authorization'), config.jobsSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runDuesNoticesJob({ client: getSupabaseServerAdminClient(), config });
    // 200 even when some emails failed: the failures are recorded on the
    // notices, and a non-2xx would only make the cron retry.
    return NextResponse.json(result);
  } catch (error) {
    console.error('Dues notices job failed:', error);
    return NextResponse.json({ error: 'Job failed' }, { status: 500 });
  }
}
```

`apps/portal/app/api/webhooks/resend/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { readNoticesConfig } from '@kit/dues-notices/config';
import { handleResendWebhook } from '@kit/dues-notices/server/webhook';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const { status } = await handleResendWebhook({
      client: getSupabaseServerAdminClient(),
      secret: readNoticesConfig().webhookSecret,
      headers: request.headers,
      body,
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    return NextResponse.json({ received: status === 200 }, { status });
  } catch (error) {
    console.error('Resend webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
```

Add `"@supabase/supabase-js": "catalog:"` and `"@kit/supabase": "workspace:*"` to the package's devDependencies if the finance copy didn't already include them.

Then update the environment files as listed under **Files** above: `compose.yaml` and `apps/portal/.env.development`.

- [ ] **Step 4: Run the tests and checks**

`pnpm --filter @kit/dues-notices test:unit && pnpm typecheck && pnpm lint && pnpm exec oxfmt --check packages/features/dues-notices apps/portal/app/api`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/features/dues-notices apps/portal/app/api/jobs apps/portal/app/api/webhooks/resend compose.yaml apps/portal/.env.development pnpm-lock.yaml
git commit -m "feat(notices): run the daily dues notices job and record Resend events"
```

---

### Task 4: Reads, the Dues notices page, Last notice columns and the member card

**Files:**
- Create: `packages/features/dues-notices/src/server/notices.service.ts`, `notices.service.test.ts`
- Create: `packages/features/dues-notices/src/server/notice-actions.ts`
- Create: `packages/features/dues-notices/src/components/tracking-badge.tsx`, `last-notice-cell.tsx`, `notices-table.tsx` (`'use client'`), `unreachable-list.tsx`, `member-notices-card.tsx` (`'use client'`), and `components.test.tsx`
- Create: `apps/portal/app/home/dues-notices/page.tsx`
- Modify: `packages/brand/src/config/paths.config.ts` and its test: add `duesNotices: '/home/dues-notices'`
- Modify: `apps/portal/config/navigation.config.tsx`: add a "Dues notices" item (section `finance`, verb `view`, icon `Mail`) after Members
- Modify: `packages/brand/i18n/messages/en/common.json`: add `routes.duesNotices: "Dues notices"` and the breadcrumb key `"dues notices": "Dues notices"`
- Modify: `packages/features/finance/src/components/follow-up-table.tsx` and `lapses-tab.tsx`: add an optional `lastNotices?: Record<string, LastNotice>` prop that renders a "Last notice" column
- Modify: `packages/features/finance/package.json`: add devDependency `"@kit/dues-notices": "workspace:*"`
- Modify: `apps/portal/app/home/page.tsx`: fetch `dues_last_notices` for the members shown on the Overview and Lapses tabs
- Modify: `apps/portal/app/home/members/[id]/page.tsx`: render `MemberNoticesCard` under the dues card, for `finance.view`

**Interfaces:**
- **Consumes:** the Task 1 reads and `set_member_dues_notices`; the Task 2 types and labels.
- **Produces:**
  - `NoticesService(client)` with these methods:
    - `list({ kind?, tracking?, limit? }): NoticeRow[]`
    - `events(noticeId): { type: string; occurredAt: string }[]`
    - `lastRun(): NoticeRun | null`
    - `unreachable(): Unreachable[]`
    - `lastNotices(memberIds): Record<string, LastNotice>`
    - `memberHistory(memberId)`
    - `optOut(memberId): boolean`
    - `setOptOut(memberId, optOut)`
  - `setDuesNoticesOptOutAction({ memberId, optOut }) → NoticesActionResult`
  - Components: `TrackingBadge`, `LastNoticeCell`, `NoticesTable`, `UnreachableList` and `MemberNoticesCard`
  - `data-test` hooks: `dues-notices-status`, `dues-notices-table`, `dues-notice-row`, `dues-notice-events`, `dues-notices-unreachable`, `tracking-badge`, `last-notice`, `member-notices`, `member-notices-opt-out`

Before writing anything, read the patterns this task follows:
- `packages/features/finance/src/server/finance.service.ts` (the mapping style; throw raw errors)
- `hosting-actions.ts` (`enhanceAction`, return-don't-throw, `revalidatePath`)
- `follow-up-table.tsx`
- `apps/portal/app/home/hosting-costs/page.tsx` (page, `requirePermission`, `readDuesIfDeployed`)
- the Base UI `Switch` and `Badge` usage in `packages/features/dues/src/components/member-dues-card.tsx` and `dues-status-badge.tsx`

- [ ] **Step 1: Write the failing tests**

`src/server/notices.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { NoticesService } from './notices.service';

describe('NoticesService', () => {
  it('maps last notices into a map keyed by member', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ member_id: 'm1', kind: 'after_30', sent_at: '2026-10-03T14:00:00Z', tracking: 'opened' }],
      error: null,
    });
    await expect(new NoticesService({ rpc } as never).lastNotices(['m1', 'm2'])).resolves.toEqual({
      m1: { memberId: 'm1', kind: 'after_30', sentAt: '2026-10-03T14:00:00Z', tracking: 'opened' },
    });
    expect(rpc).toHaveBeenCalledWith('dues_last_notices', { p_member_ids: ['m1', 'm2'] });
  });

  it('skips the call for no members', async () => {
    const rpc = vi.fn();
    await expect(new NoticesService({ rpc } as never).lastNotices([])).resolves.toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns null when there has been no run', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await expect(new NoticesService({ rpc } as never).lastRun()).resolves.toBeNull();
  });

  it('throws raw errors so the code survives', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } });
    await expect(new NoticesService({ rpc } as never).list({})).rejects.toMatchObject({ code: 'PGRST202' });
  });
});
```

`src/components/components.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/notice-actions', () => ({ setDuesNoticesOptOutAction: vi.fn() }));

import { LastNoticeCell } from './last-notice-cell';
import { TrackingBadge } from './tracking-badge';

describe('notice components', () => {
  it('labels tracking and marks problems', () => {
    const { container, rerender } = render(<TrackingBadge tracking="clicked" />);
    expect(container.textContent).toBe('Clicked');
    rerender(<TrackingBadge tracking="bounced" />);
    expect(container.querySelector('[data-test="tracking-badge"]')?.getAttribute('data-problem')).toBe('true');
  });

  it('shows the last notice or a dash', () => {
    const { container, rerender } = render(<LastNoticeCell notice={undefined} />);
    expect(container.textContent).toBe('—');
    rerender(
      <LastNoticeCell notice={{ memberId: 'm1', kind: 'after_30', sentAt: '2026-10-03T14:00:00Z', tracking: 'opened' }} />,
    );
    expect(container.textContent).toContain('30 days after');
    expect(container.textContent).toContain('Oct 3');
    expect(container.textContent).toContain('Opened');
  });
});
```

Also extend `packages/features/finance/src/components/insights-tabs.test.tsx` (LapsesTab) and the follow-up tests, if there are any, with one case each: when `lastNotices` has an entry for the row's member, the row renders a `[data-test="last-notice"]` cell containing the tracking label.

Run the unit tests for both packages. Expected: FAIL.

- [ ] **Step 2: Implement the service and action**

`notices.service.ts` wraps each RPC from Task 1 in the same style as `FinanceService`:
- snake_case is mapped to camelCase;
- errors are thrown as they come;
- `lastNotices` skips the call when `memberIds` is empty and returns `Record<memberId, LastNotice>`;
- `lastRun` returns the first row or `null`;
- `optOut` returns `data === true`;
- `setOptOut` calls `set_member_dues_notices`.

`notice-actions.ts` (`'use server'`) defines `setDuesNoticesOptOutAction`:
- parse the input with zod `{ memberId: uuid, optOut: boolean }`;
- run the call through `NoticesService(getSupabaseServerClient())`;
- map `42501` to "You do not have permission to change dues notices." and anything else to "Something went wrong saving the setting.";
- on success, run `revalidatePath('/home/members/[id]', 'page')` and `revalidatePath('/home/dues-notices')`;
- return `NoticesActionResult`, following the `hosting-actions.ts` shape.

- [ ] **Step 3: Implement the components**

`tracking-badge.tsx` (no client directive):

```tsx
import { Badge } from '@kit/ui/badge';

import { isProblem, TRACKING_LABELS } from '../tracking';
import type { Tracking } from '../types';

export function TrackingBadge({ tracking }: { tracking: Tracking }) {
  const problem = isProblem(tracking);

  return (
    <Badge variant={problem ? 'destructive' : 'secondary'} data-test="tracking-badge" data-problem={String(problem)}>
      {TRACKING_LABELS[tracking]}
    </Badge>
  );
}
```

If `Badge` has no `destructive`/`secondary` variants, use whatever variants `dues-status-badge.tsx` uses and note the choice.

`last-notice-cell.tsx` (no client directive):

```tsx
import { KIND_LABELS } from '../tracking';
import type { LastNotice } from '../types';
import { TrackingBadge } from './tracking-badge';

const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });

export function LastNoticeCell({ notice }: { notice: LastNotice | undefined }) {
  if (!notice) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="flex items-center gap-2" data-test="last-notice">
      <span>
        {KIND_LABELS[notice.kind]}, {fmt.format(new Date(notice.sentAt))}
      </span>
      <TrackingBadge tracking={notice.tracking} />
    </span>
  );
}
```

`notices-table.tsx` (`'use client'`):
- **Props:** `{ rows: NoticeRow[]; canOpenMembers: boolean }`.
- **Table** (`data-test="dues-notices-table"`) has these columns:
  - Member: the name links to `/home/members/<id>` when `canOpenMembers` is true;
  - Kind (`KIND_LABELS`);
  - Cycle: shows the last covered day, which is `cycleDate` minus 1 day (`addDaysIso` from `@kit/finance/lib/dates` if available, otherwise a local UTC helper);
  - Sent: the date part of `sentAt ?? createdAt`;
  - Tracking (`TrackingBadge`).
- **Rows:** each row is `data-test="dues-notice-row"`. It has a "Show events" toggle button whose `aria-expanded` reflects its state.
- **Expanding a row:**
  - loads its events through a server action, `loadNoticeEventsAction(noticeId)`, defined in `notice-actions.ts`, which calls `NoticesService.events` and returns `{ success, events }`;
  - renders them as a list (`data-test="dues-notice-events"`) of "Delivered — Oct 3, 9:02 AM" lines in Chicago time;
  - shows "No events yet." when there are none.
- **Empty state:** "No dues notices yet."

`unreachable-list.tsx` (no client directive):
- a Card titled "Could not notify" (`data-test="dues-notices-unreachable"`);
- each row shows the name and membership number and the reason: "No email address", "Last notice bounced" or "Marked as spam";
- the name links to the member when allowed;
- empty state: "Everyone due a notice can be reached by email."

`member-notices-card.tsx` (`'use client'`):
- **Props:** `{ memberId: string; history: { id; kind; cycleDate; sentAt; tracking }[]; optOut: boolean; canManage: boolean }`.
- **Layout:** a Card titled "Dues notices" (`data-test="member-notices"`).
- **History:** kind, sent date and badge, or "No dues notices sent." when empty.
- **Opt-out switch** (`data-test="member-notices-opt-out"`):
  - labelled "No automatic dues notices" and shown only when `canManage` is true;
  - calls `setDuesNoticesOptOutAction` inside `useTransition`;
  - shows a toast on the result;
  - is disabled while pending;
  - reverts on failure.
- **Read-only view:** when `canManage` is false, show "Automatic notices: on" or "off" instead of the switch.

- [ ] **Step 4: Add the page and wire everything together**

`apps/portal/app/home/dues-notices/page.tsx` follows `hosting-costs/page.tsx`:
- `export const instant = false`;
- `requirePermission('finance', 'view')`;
- `?kind=` and `?tracking=` are checked against the known values and ignored when invalid.

Inside `readDuesIfDeployed`, read `lastRun`, `list({ kind, tracking })` and `unreachable` in parallel, then render:
- A status Card (`data-test="dues-notices-status"`) showing:
  - the mode from `readNoticesConfig().mode`, labelled "Off", "Dry run (no emails sent)" or "Live";
  - "Last run: <Chicago date/time>, <candidates> due, <sent> sent, <failed> failed", or "The daily job has not run yet.";
  - the last run's `error` in red, when there is one.
- Two filters as native `<select>`s with labels, which navigate through `?kind=`/`?tracking=` like the forecast select. Put them in a small client component in the package, `notice-filters.tsx`.
- `NoticesTable`, then `UnreachableList`.

When the migration is missing, show `<p data-test="insights-unavailable">Not available yet.</p>`.

Add the path, the nav item and the i18n keys listed under Files.

On `/home`, add `NoticesService.lastNotices(...)` to the reads:
- **OverviewTab:** read it for the follow-up rows' member IDs and pass it as `lastNotices` to `FollowUpTable`.
- **LapsesTabContent:** read it for the lapsed list's member IDs and pass it to `LapsesTab`, which forwards it to its table.

Wrap each call in `readDuesIfDeployed`. When it isn't deployed, pass `{}`.

In `FollowUpTable` and the lapsed table in `LapsesTab`, add a "Last notice" column that renders `<LastNoticeCell notice={lastNotices?.[row.memberId]} />`. Leave the column out when `lastNotices` is undefined, so existing callers are unchanged.

On the member page, when the viewer has `finance.view`:
- read `memberHistory(id)` and `optOut(id)` through `readDuesIfDeployed`;
- render `<MemberNoticesCard memberId history optOut canManage={hasPermission(perms, 'finance', 'manage')} />` below `MemberDuesCard`.

- [ ] **Step 5: Run the tests and checks**

```bash
pnpm --filter @kit/dues-notices test:unit
pnpm --filter @kit/finance test:unit
pnpm --filter @kit/brand test:unit
pnpm typecheck && pnpm lint
pnpm exec oxfmt --check packages/features/dues-notices packages/features/finance apps/portal/app/home apps/portal/config packages/brand
```

Expected: every command passes.

Also check the server/client boundary: portal pages may import only React components from `'use client'` files.

- [ ] **Step 6: Commit**

```bash
git add packages/features/dues-notices packages/features/finance apps/portal/app/home apps/portal/config packages/brand pnpm-lock.yaml
git commit -m "feat(notices): show dues notices, their tracking and the opt-out switch"
```

---

### Task 5: The daily trigger on the router Worker, and the runbook

**Files:**
- Create: `apps/router/src/scheduled.ts`, `apps/router/src/scheduled.test.ts`
- Modify:
  - `apps/router/src/index.ts`: add `scheduled` to the default export
  - `apps/router/src/env.ts`: add `DUES_JOBS_SECRET?: string`
  - `apps/router/wrangler.jsonc`: add `"triggers": { "crons": ["0 14 * * *"] }` and a comment noting that `DUES_JOBS_SECRET` is set with `wrangler secret put`
  - `apps/router/vitest.config.ts`: add the binding `DUES_JOBS_SECRET: 'test-jobs'`
  - `docs/runbook/hosting.md`: add a "Dues notices" section

**Interfaces:**
- Consumes: the portal endpoint `POST /api/jobs/dues-notices` (Task 3).
- Produces: `runDuesNoticesTrigger(env: Env, fetchImpl?: typeof fetch): Promise<Response | null>`, which returns `null` when no secret is configured.

- [ ] **Step 1: Write the failing test**

`apps/router/src/scheduled.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import { runDuesNoticesTrigger } from './scheduled';

const env = { PORTAL_ORIGIN: 'https://portal-abc.a.run.app', ORIGIN_AUTH: 'origin-secret', DUES_JOBS_SECRET: 'jobs-secret' } as Env;

describe('runDuesNoticesTrigger', () => {
  it('posts to the portal job with both secrets', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await runDuesNoticesTrigger(env, fetchImpl as never);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://portal-abc.a.run.app/api/jobs/dues-notices');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer jobs-secret');
    expect(new Headers(init.headers).get('x-origin-auth')).toBe('origin-secret');
  });

  it('does nothing without a jobs secret', async () => {
    const fetchImpl = vi.fn();
    await expect(runDuesNoticesTrigger({ ...env, DUES_JOBS_SECRET: '' }, fetchImpl as never)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

Run `pnpm --filter router test:unit` (check `apps/router/package.json` for the exact name). Expected: FAIL.

- [ ] **Step 2: Implement**

`apps/router/src/scheduled.ts`:

```ts
import type { Env } from './env';

/** Daily cron: wake the portal and run the dues notices job. */
export async function runDuesNoticesTrigger(env: Env, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  if (!env.DUES_JOBS_SECRET) {
    console.warn('DUES_JOBS_SECRET is not set; skipping the dues notices job.');
    return null;
  }

  const response = await fetchImpl(`${env.PORTAL_ORIGIN}/api/jobs/dues-notices`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.DUES_JOBS_SECRET}`,
      'x-origin-auth': env.ORIGIN_AUTH,
    },
  });

  if (!response.ok) {
    console.error(`Dues notices job answered ${response.status}`);
  }

  return response;
}
```

In `index.ts`, add this to the default export object:

```ts
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDuesNoticesTrigger(env).then(() => undefined));
  },
```

Import `runDuesNoticesTrigger` at the top of `index.ts`.

- [ ] **Step 3: Write the runbook section**

In `docs/runbook/hosting.md`, add a "Dues notices" section with these steps, as short numbered lists:

1. **Resend**
   - Register the webhook at `https://<site>/api/webhooks/resend` for the events `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened` and `email.clicked`.
   - Copy its signing secret (`whsec_…`).
   - Confirm that open and click tracking are on for the domain.
2. **Secret Manager.** Create `resend-api-key`, `resend-webhook-secret` and `dues-jobs-secret`. Then add them to the `--set-secrets` line in `.github/workflows/deploy.yml`:

   ```
   RESEND_API_KEY=resend-api-key:latest,RESEND_WEBHOOK_SECRET=resend-webhook-secret:latest,DUES_JOBS_SECRET=dues-jobs-secret:latest
   ```

   Also add `DUES_NOTICES_MODE`, `DUES_NOTICES_FROM` and `DUES_NOTICES_REPLY_TO` to `--set-env-vars`.

   Only do this after the secrets exist: a missing secret fails the `main` deploy.
3. **Worker.** Run `wrangler secret put DUES_JOBS_SECRET`, using the same value as `dues-jobs-secret`. Then deploy the router. The cron `0 14 * * *` runs at 9 a.m. Central during daylight time and 8 a.m. in standard time.
4. **Going live**
   1. Start with `DUES_NOTICES_MODE=dry-run` for a week.
   2. Check `/home/dues-notices`.
   3. Switch to `live`.
   4. `off` stops everything.
5. **Deploy order.** Deploy the migration before or with the app. The pages show "Not available yet" until it has run.

- [ ] **Step 4: Run the tests and commit**

```bash
pnpm --filter router test:unit
pnpm typecheck
pnpm exec oxfmt --check apps/router docs/runbook
git add apps/router docs/runbook/hosting.md
git commit -m "feat(router): trigger the dues notices job daily"
```

(Adjust the filter name to match `apps/router/package.json`.)

---

### Task 6: End-to-end in dry-run mode

**Files:**
- Create: `apps/e2e/tests/dues-notices/dues-notices.spec.ts`, `dues-notices.po.ts`

**Interfaces:**
- Consumes:
  - the Task 3 job endpoint (through the stack at `http://localhost:3000`, with `DUES_JOBS_SECRET=local-jobs`);
  - the Task 4 hooks;
  - the administrator sign-in, dues and roster helpers in `apps/e2e/tests/dues/dues.po.ts` and `apps/e2e/tests/finance/finance.po.ts`.

- [ ] **Step 1: Write the specs**

1. **The job refuses a wrong secret.** `request.post('/api/jobs/dues-notices', { headers: { authorization: 'Bearer nope' } })` returns 401.
2. **A dry run records a due-date notice that shows everywhere.**
   1. As an administrator, seed a member through the roster import, as `dues.spec.ts` does, with a unique membership number and email.
   2. Set their accepted-on date to today (Chicago). They are now `due` with cycle date today, so they fall in the `due_date` window.
   3. POST the job with `Bearer local-jobs`. Expect 200 with `mode: 'dry_run'` and `candidates ≥ 1`.
   4. Open `/home/dues-notices`:
      - `dues-notices-status` contains "Dry run";
      - a `dues-notice-row` contains the member's name and a `tracking-badge` reading "Dry run".
   5. Open `/home?tab=overview`. The follow-up row for that member shows `[data-test="last-notice"]` containing "Due date".
   6. Open the member's page. `member-notices` lists one notice, and `member-notices-opt-out` is visible.
3. **A second run the same day adds nothing for that member.**
   1. POST the job again.
   2. On `/home/dues-notices`, the member still has exactly one row. Filter with `?kind=due_date` and count the rows that contain the member's name.
4. **A member without finance access can't open the page.** A freshly signed-up member opens `/home/dues-notices` and is redirected to `/home`. The sidebar has no "Dues notices" link.

- [ ] **Step 2: Run against the stack**

Run with the sandbox disabled. Never reset local Supabase. `pnpm stack:up` rebuilds the portal with the Task 3 `compose.yaml` environment (`DUES_NOTICES_MODE: dry-run`).

```bash
pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/dues-notices tests/finance tests/dues
pnpm stack:down
```

Expected results:
- all four dues-notices specs pass;
- finance and dues pass as before, with the hosting and Stripe specs skipped;
- no request to `api.resend.com` is made. Dry-run never calls it.

- [ ] **Step 3: Type-check and commit**

```bash
pnpm --filter web-e2e typecheck
pnpm exec oxfmt --check apps/e2e/tests/dues-notices
git add apps/e2e/tests/dues-notices
git commit -m "test(e2e): cover dues notices in dry-run mode"
```
