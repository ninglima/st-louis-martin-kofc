# Event Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email volunteers a sign-up confirmation (with an .ics), a day-before reminder, and change/cancel notices, through an outbox that the app drains immediately and the daily job retries, with delivery tracking shown to officers and leads.

**Architecture:**
- **Database:** Postgres AFTER triggers on `event_signups`, `events` and `event_shifts` write rows to an `event_emails` outbox in the same transaction. Service-role functions claim rows, queue reminders, and report tracking status.
- **`@kit/email`** (new shared package): the Resend client, Svix verification and small helpers, moved out of `@kit/dues-notices`.
- **`@kit/event-emails`** (new): config, `.ics` generation, templates, the dispatcher, the job and a webhook sink.
- **Server actions** trigger the dispatcher with `after()` from `next/server`.
- **Router cron** calls a new job endpoint.
- **Resend webhook** routes each event by tag to either the dues sink or the events sink.

**Tech Stack:** Supabase Postgres + pgTAP; Next.js 16 (`after`, route handlers, server actions); Resend REST (`/emails`, `/emails/batch`); Cloudflare Worker cron; Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-event-emails-design.md`

## Global Constraints

- **Mode:**
  - `EVENT_EMAILS_MODE` is `off` (the default), `dry-run` or `live`, parsed like `DUES_NOTICES_MODE`. `dry-run` and `dry_run` both mean dry run.
  - Off sends nothing and claims nothing. Dry-run claims rows and stamps them `dry_run`, which is final, and never calls Resend.
  - Live calls Resend only when nothing is missing: `RESEND_API_KEY`, `EVENT_EMAILS_FROM`, and an https, non-loopback site URL (reuse `siteUrlProblem`).
- **Env vars:**
  - New: `EVENT_EMAILS_MODE`, `EVENT_EMAILS_FROM`, `EVENT_EMAILS_REPLY_TO`.
  - Reused: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `DUES_JOBS_SECRET` (the jobs secret, shared).
  - Read `NEXT_PUBLIC_SITE_URL` literally, so Next inlines it.
- **Never send real email in tests.** Tests use fake `fetch` implementations, and the E2E runs only against the dry-run stack.
- **What triggers an email:**
  - **Confirmation:** a self sign-up only (`member_id = kit.my_member_id()`). Officer walk-ins (`event_add_volunteer`) send nothing.
  - **Change emails** (`update`/`cancel`):
    - when an event is cancelled or restored;
    - when the location changes;
    - when a shift's start or end time changes.
  - **Nothing:** title, description, lead, public-flag or type edits; officer removals.
  - Only active (`signed_up`) sign-ups on shifts that have not started are notified.
- **Merging:** at most one pending `update`/`cancel` row per sign-up. The latest change wins. An `update` queued for an event that is now cancelled becomes `cancel`.
- **Opt-out:** confirmations and change emails always send. Reminders skip members with `event_reminders_opt_out = true` and members with a blank `primary_email`.
- **Kill switch:** the setting `kit.suppress_event_emails = 'on'` disables every enqueue trigger.
- **Sending:**
  - Emails with an attachment (confirmation/update/cancel) go one at a time through `POST https://api.resend.com/emails` with `Idempotency-Key: event-email/<event_emails.id>`.
  - Reminders (no attachment) go through `sendBatch`.
  - Every email carries the tag `{name: 'event_email_id', value: <id>}`.
- **Retries:**
  - A failed send is retried while `attempts < 3`, at `next_attempt_at = now() + 15 min × attempts`.
  - HTTP 429 and 5xx are retryable (`failed`). Any other 4xx is permanent (`dead`).
  - A row stuck in `sending` for more than 10 minutes is reclaimed.
- **Expiry:** pending or failed rows expire if the shift has started (all kinds except `cancel`) or if the row is more than 72 hours old.
- **`.ics` files:**
  - Times in UTC (`YYYYMMDDTHHMMSSZ`).
  - `UID:signup-<signup_id>@<site host>`, `SEQUENCE:<row.sequence>`.
  - `METHOD:PUBLISH` (and `STATUS:CONFIRMED`) for confirmation and update. `METHOD:CANCEL`, `STATUS:CANCELLED` and `ORGANIZER:mailto:<from address>` for cancel.
  - Escape `\`, `;`, `,` and newlines. CRLF line endings. Fold lines at 75 octets.
  - Filename `event.ics`. `content_type: text/calendar; method=<METHOD>; charset=UTF-8`.
- **Time:** all dates and times shown to people use America/Chicago, via the formatters in `packages/features/events/src/lib/format.ts`. "Tomorrow" for reminders is `kit.council_today() + 1`.
- **Database conventions:**
  - New tables have RLS enabled and no policies. Every privilege is revoked from `anon` and `authenticated`. `service_role` gets only what the job needs.
  - Public functions are `security definer` with `set search_path = ''`.
  - Do not edit earlier migrations. Never run `supabase db reset`. Apply with `migration up`.
- **DB types:** hand-add new objects to `packages/supabase/src/database.types.ts` and `apps/portal/lib/database.types.ts`, keeping the two files byte-identical. Never commit a regenerated file.

## Review Focus

1. **A member signs up, cancels and signs up again before the sender runs.** The second sign-up is a new row, so it gets its own confirmation. The first is marked `superseded` when claimed. Pinned in Task 1.
2. **An event is moved to another date.** `event_update` moves every shift, and each signed-up member gets exactly one `update` email. Pinned in Task 1.
3. **Switching from off to live after weeks of queued rows** must not send a flood of stale emails. Expiry handles it. Pinned in Task 1 (claim with a later `p_now`).
4. **A Resend outage during a sign-up** must not change the sign-up's success. The dispatcher never throws and runs after the response. Pinned in Task 4 (dispatcher) and Task 6 (the action still returns success).
5. **The existing dues-notice webhook must keep working unchanged.** Pinned in Task 5: the existing `webhook.test.ts` must pass without edits to its assertions.

---

### Task 1: Outbox schema, enqueue triggers, claim, reminders, status, opt-out

**Files:**
- Create: `apps/portal/supabase/migrations/20261003120000_event_emails.sql`
- Test: `apps/portal/supabase/tests/event_emails.test.sql`
- Modify: both `database.types.ts` files. Add the new tables, the `members.event_reminders_opt_out` column and the public functions, all by hand.

**Interfaces (produced):**
- **Tables:**
  - `public.event_emails(id, kind, signup_id, member_id, sequence, reminder_for, mode, status, attempts, next_attempt_at, claimed_at, email, resend_email_id, error, sent_at, created_at, updated_at)`
  - `public.event_email_events(id, email_id, type, occurred_at, svix_id, payload)`
  - `public.event_email_runs(id, ran_at, mode, candidates, sent, skipped, failed, error)`
- **`public.event_emails_claim(p_mode text, p_limit integer default 50)`** (service_role only) returns table `(email_id uuid, kind text, sequence integer, mode text, signup_id uuid, event_id uuid, first_name text, email text, title text, location text, description text, event_status text, shift_starts_at timestamptz, shift_ends_at timestamptz, shift_label text)`.
  - It returns every row it stamped, with `mode` set to `dry_run` or `live`.
  - The core is `kit.event_emails_claim_at(p_mode, p_limit, p_now timestamptz)`.
- **`public.event_reminders_enqueue(p_mode text) returns integer`** (service_role only). The core is `kit.event_reminders_enqueue_at(p_mode, p_today date)`.
- **`public.event_email_status(p_event_id uuid)`** returns table `(signup_id uuid, kind text, tracking text, at timestamptz)`. It is granted to authenticated and gated by `kit.can_take_attendance`, raising 42501 otherwise.
- **`public.my_event_reminders() returns boolean`**, which is null when the caller has no linked member.
- **`public.set_my_event_reminders(p_opt_out boolean) returns void`**. Both are granted to authenticated.

- [ ] **Step 1: Write the migration.** The SQL below is authoritative.

```sql
-- Volunteer events, piece 2: the event email outbox.
-- Spec: docs/superpowers/specs/2026-10-03-event-emails-design.md

alter table public.members add column event_reminders_opt_out boolean not null default false;

create table public.event_emails (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('confirmation', 'update', 'cancel', 'reminder')),
  signup_id       uuid not null references public.event_signups on delete cascade,
  member_id       uuid not null references public.members on delete cascade,
  sequence        integer not null default 0,
  reminder_for    timestamptz,
  mode            text check (mode in ('dry_run', 'live')),
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'dry_run', 'superseded', 'expired', 'no_email')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz,
  claimed_at      timestamptz,
  email           text,
  resend_email_id text unique,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'reminder') = (reminder_for is not null)),
  check (kind <> 'reminder' or mode is not null)
);
create unique index event_emails_confirmation_uk on public.event_emails (signup_id) where kind = 'confirmation';
create unique index event_emails_pending_change_uk on public.event_emails (signup_id)
  where status = 'pending' and kind in ('update', 'cancel');
create unique index event_emails_reminder_uk on public.event_emails (signup_id, reminder_for, mode) where kind = 'reminder';
create index event_emails_queue_idx on public.event_emails (status, next_attempt_at);
create index event_emails_signup_idx on public.event_emails (signup_id, created_at desc);

create table public.event_email_events (
  id          uuid primary key default gen_random_uuid(),
  email_id    uuid not null references public.event_emails on delete cascade,
  type        text not null check (type in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'suppressed', 'failed', 'opened', 'clicked')),
  occurred_at timestamptz not null,
  svix_id     text not null unique,
  payload     jsonb not null
);
create index event_email_events_email_idx on public.event_email_events (email_id);

create table public.event_email_runs (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  mode       text not null check (mode in ('off', 'dry_run', 'live')),
  candidates integer not null default 0,
  sent       integer not null default 0,
  skipped    integer not null default 0,
  failed     integer not null default 0,
  error      text
);

alter table public.event_emails       enable row level security;
alter table public.event_email_events enable row level security;
alter table public.event_email_runs   enable row level security;
revoke all on public.event_emails, public.event_email_events, public.event_email_runs from anon, authenticated, service_role;
grant select, update on public.event_emails to service_role;
grant select, insert on public.event_email_events, public.event_email_runs to service_role;

create or replace function kit.event_emails_suppressed()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('kit.suppress_event_emails', true), '') = 'on'
$$;

-- One pending change row per sign-up; the latest change wins, and an update
-- queued for an event that is now cancelled is a cancel. Skips sign-ups whose
-- confirmation has not gone out yet: it is rendered from current data.
create or replace function kit.enqueue_event_change(p_signup_ids uuid[], p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_emails (kind, signup_id, member_id, sequence)
  select case when p_kind = 'update' and e.status = 'cancelled' then 'cancel' else p_kind end,
         s.id, s.member_id,
         coalesce((select max(x.sequence) from public.event_emails x where x.signup_id = s.id), 0) + 1
  from public.event_signups s
  join public.event_shifts sh on sh.id = s.shift_id
  join public.events e on e.id = sh.event_id
  where s.id = any (coalesce(p_signup_ids, '{}'))
    and not exists (select 1 from public.event_emails c
                     where c.signup_id = s.id and c.kind = 'confirmation' and c.status in ('pending', 'sending'))
  on conflict (signup_id) where status = 'pending' and kind in ('update', 'cancel')
  do update set kind = excluded.kind, updated_at = now();
end $$;

create or replace function kit.event_signups_email_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if kit.event_emails_suppressed() then return null; end if;
  if new.status = 'signed_up' and new.member_id = kit.my_member_id() then
    insert into public.event_emails (kind, signup_id, member_id, sequence)
    values ('confirmation', new.id, new.member_id, 0)
    on conflict do nothing;
  end if;
  return null;
end $$;

create or replace function kit.events_email_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_ids  uuid[];
begin
  if kit.event_emails_suppressed() then return null; end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'cancel';
  elsif new.status = 'scheduled'
        and (old.status is distinct from 'scheduled' or new.location is distinct from old.location) then
    v_kind := 'update';
  else
    return null;
  end if;
  select array_agg(s.id) into v_ids
  from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
  where sh.event_id = new.id and s.status = 'signed_up' and sh.starts_at > now();
  perform kit.enqueue_event_change(v_ids, v_kind);
  return null;
end $$;

create or replace function kit.event_shifts_email_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if kit.event_emails_suppressed() then return null; end if;
  if (select status from public.events where id = new.event_id) <> 'scheduled' then return null; end if;
  select array_agg(s.id) into v_ids
  from public.event_signups s
  where s.shift_id = new.id and s.status = 'signed_up' and new.starts_at > now();
  perform kit.enqueue_event_change(v_ids, 'update');
  return null;
end $$;

create trigger event_signups_email after insert on public.event_signups
  for each row execute function kit.event_signups_email_trg();
create trigger events_email after update of status, location on public.events
  for each row when (old.status is distinct from new.status or old.location is distinct from new.location)
  execute function kit.events_email_trg();
create trigger event_shifts_email after update of starts_at, ends_at on public.event_shifts
  for each row when (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
  execute function kit.event_shifts_email_trg();

create or replace function kit.event_emails_claim_at(p_mode text, p_limit integer, p_now timestamptz)
returns table (email_id uuid, kind text, sequence integer, mode text, signup_id uuid, event_id uuid,
               first_name text, email text, title text, location text, description text, event_status text,
               shift_starts_at timestamptz, shift_ends_at timestamptz, shift_label text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r record;
begin
  if p_mode is null or p_mode not in ('dry_run', 'live') then
    raise exception 'unknown mode';
  end if;

  update public.event_emails x set status = 'expired', updated_at = p_now
  from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
  where x.signup_id = s.id and x.status in ('pending', 'failed')
    and ((x.kind <> 'cancel' and sh.starts_at <= p_now) or x.created_at < p_now - interval '72 hours');

  for r in
    select x.id, x.kind, x.sequence, x.signup_id, s.status as signup_status, s.member_id,
           m.first_name, nullif(btrim(m.primary_email), '') as email,
           e.id as event_id, e.title, e.location, e.description, e.status::text as event_status,
           sh.starts_at, sh.ends_at, sh.label
    from public.event_emails x
    join public.event_signups s on s.id = x.signup_id
    join public.event_shifts sh on sh.id = s.shift_id
    join public.events e on e.id = sh.event_id
    join public.members m on m.id = s.member_id
    where (x.status = 'pending' and (x.kind <> 'reminder' or x.mode = p_mode))
       or (x.status = 'failed' and x.mode = p_mode and x.attempts < 3 and x.next_attempt_at <= p_now)
       or (x.status = 'sending' and x.mode = p_mode and x.claimed_at < p_now - interval '10 minutes')
    order by x.created_at
    limit greatest(coalesce(p_limit, 50), 0)
    for update of x skip locked
  loop
    if r.kind <> 'cancel' and r.signup_status <> 'signed_up' then
      update public.event_emails set status = 'superseded', updated_at = p_now where id = r.id;
      continue;
    end if;
    if r.email is null then
      update public.event_emails set status = 'no_email', updated_at = p_now where id = r.id;
      continue;
    end if;
    if p_mode = 'dry_run' then
      update public.event_emails
         set status = 'dry_run', mode = 'dry_run', email = r.email, claimed_at = p_now, sent_at = p_now, updated_at = p_now
       where id = r.id;
    else
      update public.event_emails
         set status = 'sending', mode = 'live', email = r.email, claimed_at = p_now,
             attempts = attempts + 1, updated_at = p_now
       where id = r.id;
    end if;
    email_id := r.id; kind := r.kind; sequence := r.sequence; mode := p_mode; signup_id := r.signup_id;
    event_id := r.event_id; first_name := r.first_name; email := r.email; title := r.title;
    location := r.location; description := r.description; event_status := r.event_status;
    shift_starts_at := r.starts_at; shift_ends_at := r.ends_at; shift_label := r.label;
    return next;
  end loop;
end $$;

create or replace function public.event_emails_claim(p_mode text, p_limit integer default 50)
returns table (email_id uuid, kind text, sequence integer, mode text, signup_id uuid, event_id uuid,
               first_name text, email text, title text, location text, description text, event_status text,
               shift_starts_at timestamptz, shift_ends_at timestamptz, shift_label text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query select * from kit.event_emails_claim_at(p_mode, p_limit, now());
end $$;

create or replace function kit.event_reminders_enqueue_at(p_mode text, p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if p_mode is null or p_mode not in ('dry_run', 'live') then
    raise exception 'unknown mode';
  end if;
  if kit.event_emails_suppressed() then return 0; end if;
  insert into public.event_emails (kind, signup_id, member_id, sequence, reminder_for, mode)
  select 'reminder', s.id, s.member_id, 0, sh.starts_at, p_mode
  from public.event_signups s
  join public.event_shifts sh on sh.id = s.shift_id
  join public.events e on e.id = sh.event_id
  join public.members m on m.id = s.member_id
  where s.status = 'signed_up' and e.status = 'scheduled'
    and (sh.starts_at at time zone 'America/Chicago')::date = p_today + 1
    and not m.event_reminders_opt_out
    and nullif(btrim(m.primary_email), '') is not null
  on conflict (signup_id, reminder_for, mode) where kind = 'reminder' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.event_reminders_enqueue(p_mode text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
begin
  return kit.event_reminders_enqueue_at(p_mode, kit.council_today());
end $$;

-- Same precedence as kit.dues_notice_tracking.
create or replace function kit.event_email_tracking(p_email_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'complained') then 'complained'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'bounced') then 'bounced'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'suppressed') then 'suppressed'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'clicked') then 'clicked'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'opened') then 'opened'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'delivered') then 'delivered'
           when x.status in ('failed', 'dead') then 'failed'
           when x.status in ('pending', 'sending') then 'pending'
           when x.status = 'no_email' then 'no_email'
           else 'sent'
         end
    from public.event_emails x
   where x.id = p_email_id
$$;

create or replace function public.event_email_status(p_event_id uuid)
returns table (signup_id uuid, kind text, tracking text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not kit.can_take_attendance(p_event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select distinct on (x.signup_id) x.signup_id, x.kind, kit.event_email_tracking(x.id), coalesce(x.sent_at, x.created_at)
  from public.event_emails x
  join public.event_signups s on s.id = x.signup_id
  join public.event_shifts sh on sh.id = s.shift_id
  where sh.event_id = p_event_id
    and x.status not in ('dry_run', 'superseded', 'expired')
  order by x.signup_id, x.created_at desc;
end $$;

create or replace function public.my_event_reminders()
returns boolean language sql stable security definer set search_path = '' as $$
  select case when m.id is null then null else not m.event_reminders_opt_out end
  from (select kit.my_member_id() as id) me
  left join public.members m on m.id = me.id
$$;

create or replace function public.set_my_event_reminders(p_opt_out boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := kit.my_member_id();
begin
  if v_me is null then
    raise exception 'Your sign-in is not linked to a council member record.';
  end if;
  update public.members set event_reminders_opt_out = coalesce(p_opt_out, false) where id = v_me;
end $$;

revoke all on function kit.event_emails_suppressed()                         from public, anon, authenticated;
revoke all on function kit.enqueue_event_change(uuid[], text)                from public, anon, authenticated;
revoke all on function kit.event_signups_email_trg()                         from public, anon, authenticated;
revoke all on function kit.events_email_trg()                                from public, anon, authenticated;
revoke all on function kit.event_shifts_email_trg()                          from public, anon, authenticated;
revoke all on function kit.event_emails_claim_at(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function kit.event_reminders_enqueue_at(text, date)            from public, anon, authenticated;
revoke all on function kit.event_email_tracking(uuid)                        from public, anon, authenticated;

revoke all on function public.event_emails_claim(text, integer)  from public, anon, authenticated;
revoke all on function public.event_reminders_enqueue(text)      from public, anon, authenticated;
grant execute on function public.event_emails_claim(text, integer) to service_role;
grant execute on function public.event_reminders_enqueue(text)     to service_role;

revoke all on function public.event_email_status(uuid)         from public, anon;
revoke all on function public.my_event_reminders()             from public, anon;
revoke all on function public.set_my_event_reminders(boolean)  from public, anon;
grant execute on function public.event_email_status(uuid)        to authenticated;
grant execute on function public.my_event_reminders()            to authenticated;
grant execute on function public.set_my_event_reminders(boolean) to authenticated;
```

`my_event_reminders()` returns **true when reminders are on**, which is the opposite of the column. The UI binds a switch labelled "Email me a reminder the day before" to it.

- [ ] **Step 2: Write the pgTAP test** `apps/portal/supabase/tests/event_emails.test.sql`.
  - Use `select no_plan();`, `\ir helpers/dues_fixtures.inc`, and a shift fixture like `tests.ev_shift` in `events_signups.test.sql`.
  - Every new user automatically gets the `member` role.
  - Read the outbox as service (`tests.act_as_service()`), because `authenticated` has no grant on it.

  Cover every item:
  - A member's self sign-up (`event_signup` as that member) creates exactly one `confirmation`, with status `pending` and sequence 0.
  - `event_add_volunteer` by a lead creates no email row.
  - With `select set_config('kit.suppress_event_emails','on',true)`, a self sign-up creates no row. Reset it afterwards.
  - **Title-only edit.** `event_update(e, '{"title":"x"}')` creates no row.
  - **Location change.** It gives one `update` per active sign-up. A cancelled sign-up gets none.
    - First mark the confirmation `sent` as service, so the change isn't skipped.
    - A second location change still leaves exactly one pending row per sign-up.
  - **Date move.** `event_update(e, '{"date":...}', 'this')` moves the shifts, leaving one pending row per sign-up.
  - **Cancel.** `event_update(e, '{"status":"cancelled"}')` turns the pending row's kind into `cancel`. A following `event_shifts_save` on the cancelled event adds no `update`.
  - **Series.** A series cancelled with scope `following` from the second date notifies only sign-ups on the second and later dates.
  - **Unsent confirmation.** A change while the sign-up's confirmation is still `pending` queues nothing.
  - **Claim, dry-run.** `kit.event_emails_claim_at('dry_run', 50, now())` stamps rows `dry_run` with mode `dry_run`, and returns them with first name, email and shift times.
  - **Claim, superseded.** A pending confirmation whose sign-up was cancelled is marked `superseded` and not returned.
  - **Claim, no email.** A member with a blank `primary_email` gives `no_email`.
  - **Claim, expiry.** `claim_at('live', 50, now() + interval '4 days')` expires a stale pending row, with status `expired`.
  - **Claim, live.** It stamps `sending`, `attempts = 1`, mode `live`.
  - **Reclaim.** A `sending` row with `claimed_at` older than 10 minutes is reclaimed, and `attempts` becomes 2.
  - **Reminders:**
    - `kit.event_reminders_enqueue_at('dry_run', d)` for a shift on `d + 1` (Chicago) inserts one row.
    - Calling it again inserts 0.
    - `'live'` inserts one more row.
    - An opted-out member and a member with no email are skipped.
    - A shift at 00:30 Chicago on `d + 1` is included, and 23:30 Chicago on `d` is excluded. Pick a date in the DST transition week, e.g. `d = '2040-11-03'`.
  - **`event_email_status`:**
    - a plain member gets 42501;
    - the lead gets one row per sign-up;
    - inserting an `event_email_events` row of type `delivered` for a live sent row makes `tracking = 'delivered'`.
  - **Reminder opt-out:**
    - `set_my_event_reminders(true)` changes only the caller's own member row;
    - `my_event_reminders()` returns false, and returns null for an unlinked user;
    - an unlinked user calling `set_my_event_reminders` gets the "not linked" message.
  - **Locked down for `authenticated`:**
    - `select count(*) from public.event_emails` raises 42501;
    - `public.event_emails_claim('dry_run')` raises 42501;
    - `public.event_reminders_enqueue('dry_run')` raises 42501.

- [ ] **Step 3: RED, then apply and GREEN.**
  - RED: `DO_NOT_TRACK=1 pnpm --filter portal exec supabase test db` fails on the new file.
  - Then run `DO_NOT_TRACK=1 pnpm --filter portal exec supabase migration up`. All files pass.

- [ ] **Step 4: Add the DB types by hand.** Generate to `$TMPDIR` and copy only the new objects into both type files, keeping them byte-identical. Run `pnpm --filter @kit/supabase typecheck && pnpm --filter portal typecheck`.

- [ ] **Step 5: Commit.** Message: `feat(event-emails): outbox, enqueue triggers, claim, reminders and status`.

---

### Task 2: Extract `@kit/email` (keep dues notices green)

**Files:**
- Create `packages/email`, with `package.json` name `@kit/email`. Exports:
  - `./resend`
  - `./svix`
  - `./html`
  - `./email-format`
  - `./mode`
  - `./tracking`
  - `./webhook`
- Modify `packages/features/dues-notices/src/{resend,svix,tracking}.ts` to re-export from `@kit/email/*`, keeping every exported name.
- Modify `config.ts`, `templates.ts` and `server/job.ts` to import the moved helpers. Add the dependency, `pnpm install`.

**Interfaces (produced):**
- **`@kit/email/resend`:**
  - `OutgoingEmail` (from dues, plus an optional `attachments?: {filename: string; content: string /*base64*/; contentType?: string}[]`);
  - `SendResult` and `sendBatch` (moved unchanged);
  - new `sendEmail(apiKey, email, {idempotencyKey?, fetchImpl?, timeoutMs?}): Promise<SendOneResult>`, where `SendOneResult = {ok: true; id: string} | {ok: false; error: string; retryable: boolean}`.

  `sendEmail` POSTs to `/emails` with `attachments: [{filename, content, content_type}]` and the `Idempotency-Key` header when given. 429 and 5xx, timeouts and network errors are `retryable: true`. Any other 4xx is `false`. It never throws, and it redacts the key in errors, as `sendBatch` does.
- **`@kit/email/svix`:** `verifySvixSignature`, moved.
- **`@kit/email/html`:** `escapeHtml`, exported now.
- **`@kit/email/email-format`:** `isPlausibleEmail`, moved from `job.ts`.
- **`@kit/email/mode`:** `EmailMode = 'off' | 'dry_run' | 'live'`, `parseMode(raw)` and `siteUrlProblem(url)`. Moved from `config.ts`, where dues keeps using them.
- **`@kit/email/tracking`:** the `Tracking` type and `TRACKING_LABELS`, plus `no_email: 'No email'`, and `isProblem`.
- **`@kit/email/webhook`:** `handleResendWebhookWithSinks({secret, headers, body, nowSeconds, sinks}): Promise<{status: number; stored: boolean}>`.
  - It does Svix verification and parsing.
  - It strips the `email.` prefix and filters to the tracked types.
  - It reads the tags: either an array of `{name, value}` or an object.
  - For each sink in order it calls `sink.match({tags, emailId})`, which returns `{id} | null`. The first match gets `sink.store({id, type, occurredAt, svixId, payload})`.
  - Unknown events return 200 with `stored: false`.

Dues' `handleResendWebhook({client, secret, headers, body, nowSeconds})` keeps its signature. Internally it calls the core with a single dues sink, whose match uses the `notice_id` tag and falls back to the `resend_email_id` lookup in `dues_notices`.

- [ ] Steps:
  - **RED** — write `packages/email` tests:
    - `sendEmail`: payload with attachments, the idempotency header, 200 to ok, 429/500 retryable, 422 permanent, a thrown fetch retryable, the key redacted;
    - a webhook core test with two fake sinks: routes to the first match, unknown gives 200 not stored, a bad signature gives 400.
  - **GREEN:** move the code.
  - **Verify:** every existing `@kit/dues-notices` test passes with **no assertion changes**: `pnpm --filter @kit/dues-notices exec vitest run`, `pnpm --filter @kit/email exec vitest run`, typecheck for both packages plus portal.
  - **Commit:** `refactor(email): shared Resend client, Svix and helpers in @kit/email`.

---

### Task 3: `@kit/event-emails` — config, `.ics`, templates

**Files:** create `packages/features/event-emails` (model the package on `packages/features/dues-notices`), containing:
- `src/config.ts`
- `src/ics.ts`
- `src/templates.ts`
- `src/types.ts`
- tests beside each

**Interfaces (produced):**
- **`readEventEmailsConfig(env = {...process.env literal reads})`** returns `{mode: EmailMode; apiKey; webhookSecret; jobsSecret; from; replyTo; siteUrl; missingForLive: string[]}`.
  - It reads `EVENT_EMAILS_MODE`, `EVENT_EMAILS_FROM` and `EVENT_EMAILS_REPLY_TO`, plus the shared `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `DUES_JOBS_SECRET`.
  - It reads `NEXT_PUBLIC_SITE_URL` literally, as dues `config.ts` does.
- **`ClaimedEventEmail`** mirrors the `event_emails_claim` columns in camelCase.
- **`buildIcs(e: ClaimedEventEmail, {siteUrl, from}): string`** follows the Global Constraints rules exactly:
  - `PRODID:-//St Louis Martin KofC//Portal//EN`;
  - `DTSTAMP` set to the current UTC time;
  - `SUMMARY` is the title, plus ` — <shift label>` when there is one;
  - `LOCATION` when present;
  - `DESCRIPTION` holds the description plus the event URL `<siteUrl>/home/events/<eventId>`;
  - `URL` is that same event URL.
- **`renderEventEmail(e, {siteUrl}): {subject, html, text, ics?: {filename, content (base64), contentType}}`**. Reminders have no `ics`. Subjects:
  - confirmation: `You're signed up: <title>`
  - update: `Updated: <title>`
  - cancel: `Cancelled: <title>`
  - reminder: `Reminder: <title> tomorrow`

  The body has:
  - the member's first name;
  - the shift date and time in Chicago time, using `formatDay` and `formatTimeRange` from `@kit/events/lib/format`;
  - the location;
  - an event link;
  - for update, "The details have changed — the new details are below.";
  - for cancel, "This event has been cancelled. No action is needed.";
  - for reminder, a footer: "Don't want reminders? Turn them off on My volunteering: <siteUrl>/home/volunteering".

  All values are HTML-escaped with `escapeHtml`.

- [ ] Steps:
  - **RED tests:**
    - `ics`: CRLF line endings; folding of a 200-character title (no line over 75 octets, continuation lines start with a space, multibyte characters not split); escaping of `,;\` and newlines; a UTC `DTSTART` from a Chicago-evening instant; `METHOD:CANCEL` with `STATUS:CANCELLED` and `ORGANIZER`; `METHOD:PUBLISH` for confirmation; a UID stable for the same signup; `SEQUENCE` taken from the input;
    - templates for each kind (subjects, escaping of `<script>` in the title, Chicago time shown, the reminder footer link, no `ics` on a reminder);
    - config (mode parsing, `missingForLive` for each missing item, a localhost site URL refused).
  - **Then GREEN.** Typecheck, lint changed files.
  - **Commit:** `feat(event-emails): config, calendar files and templates`.

---

### Task 4: Dispatcher, job route, router

**Files:**
- Create `packages/features/event-emails/src/server/dispatch.ts` (+ test).
- Create `src/server/job.ts` (+ test).
- Create `apps/portal/app/api/jobs/event-emails/route.ts`.
- Modify `apps/router/src/scheduled.ts`, `apps/router/src/index.ts` and the router test.
- Modify `compose.yaml` (portal env: `EVENT_EMAILS_MODE: dry-run`, `EVENT_EMAILS_FROM: 'Council Events <events@localhost>'`).
- Add `@kit/event-emails` to `apps/portal/package.json`.

**Interfaces (produced):**
- **`dispatchEventEmails({client, config, fetchImpl = fetch, budgetMs = 45_000, gapMs = 600, now = () => Date.now(), sleep}): Promise<DispatchResult>`**, where `DispatchResult` is `{candidates, sent, skipped, failed, error: string | null}`.
  - **Off:** returns zeros and makes no RPC.
  - **Live with `missingForLive`:** sets `error`, makes no RPC.
  - **Claiming:** calls `client.rpc('event_emails_claim', {p_mode, p_limit: 50})` in a loop until no rows come back or the budget runs out.
  - **Dry-run:** the rows count as `skipped`, and `fetch` is never called.
  - **Live:**
    - rows failing `isPlausibleEmail` are marked `dead` with error `invalid email address`;
    - reminders go in one `sendBatch`;
    - confirmation, update and cancel go one at a time through `sendEmail` with `idempotencyKey: 'event-email/<id>'`, waiting `gapMs` between calls.
  - **After each result**, it updates `event_emails` through the service-role client:
    - **Success:** `status='sent'`, `resend_email_id`, `sent_at`, `error=null`.
    - **Retryable failure:** `status = attempts >= 3 ? 'dead' : 'failed'`, `next_attempt_at = now + 15min × attempts`, `error`.
    - **Permanent failure:** `status='dead'`, `error`.
  - It never throws: a write error or RPC error goes into `error`.
  - Every email carries `tags: [{name:'event_email_id', value:id}]`, plus `from` and `replyTo` from config.
- **`runEventEmailsJob({client, config, fetchImpl}): Promise<JobResult>`** does three things:
  - In dry-run or live, it calls `client.rpc('event_reminders_enqueue', {p_mode})`.
  - It runs `dispatchEventEmails` with `budgetMs: 240_000`.
  - It inserts a row into `event_email_runs` with mode `off`, `dry_run` or `live`, and the counts.
- **Route `POST /api/jobs/event-emails`:** a copy of `apps/portal/app/api/jobs/dues-notices/route.ts`. It uses the same bearer `timingSafeEqual` check against `readEventEmailsConfig().jobsSecret` and the admin client. It returns 401 without auth, and 200 with the result JSON even when some sends failed.
- **Router:**
  - Generalize `runDuesNoticesTrigger` into `runJobTrigger(env, path, label, fetchImpl)` and keep `runDuesNoticesTrigger` as a wrapper.
  - Add `runEventEmailsTrigger`.
  - `scheduled()` waits on both with `ctx.waitUntil(Promise.all([...]))`. The cron does not change.

- [ ] Steps:
  - **RED tests**, using a fake Supabase client that records rpc and update calls plus fake fetch/sleep/now:
    - off makes no rpc;
    - dry-run never calls fetch, counts skipped, records nothing as sent;
    - live sends one attachment email via `/emails` with the idempotency header and marks it `sent` with the id;
    - a reminder goes through `/emails/batch`;
    - 429 gives `failed` with a backoff `next_attempt_at`, and a third attempt gives `dead`;
    - 422 gives `dead`;
    - an invalid address gives `dead` with no fetch;
    - the budget stops the claim loop;
    - an RPC error lands in `error` without throwing;
    - the job records a run with the right mode and counts;
    - the router test asserts both URLs and their headers (bearer + `x-origin-auth`).
  - **Then GREEN.** Typecheck the packages, portal and router.
  - **Commit:** `feat(event-emails): dispatcher, daily job and cron trigger`.

---

### Task 5: Webhook routing and the event sink

**Files:**
- Create `packages/features/event-emails/src/server/webhook-sink.ts` (+ test).
- Modify `apps/portal/app/api/webhooks/resend/route.ts`.
- Modify `packages/features/dues-notices/src/server/webhook.ts`: export a `duesNoticesSink(client)` alongside the unchanged `handleResendWebhook`.

**Interfaces:**
- **`eventEmailsSink(client)`:**
  - `match` returns `{id}` when the tags carry an `event_email_id` holding a UUID that exists in `event_emails`. Otherwise it looks up `resend_email_id` in `event_emails`, and returns null when that fails.
  - `store` upserts into `event_email_events` on `svix_id` (ignore duplicates).
- **Route:** call `handleResendWebhookWithSinks({…, sinks: [duesNoticesSink(admin), eventEmailsSink(admin)]})`, using the dues config's webhook secret, which is shared.

- [ ] Steps:
  - **RED tests:**
    - the event tag routes to the event sink and stores the event;
    - a dues `notice_id` still goes to the dues sink;
    - an untagged email id is found in `event_emails` and stored there;
    - an unknown id gets 200 and is not stored;
    - a replayed `svix_id` is stored once.
  - **The existing dues `webhook.test.ts` must pass with no assertion edits.**
  - **Then GREEN.**
  - **Commit:** `feat(event-emails): route Resend webhooks to dues or event emails`.

---

### Task 6: Send after actions, reminder switch, tracking badge

**Files:**
- Modify `packages/features/events/src/server/events-actions.ts`.
- Modify `packages/features/events/src/server/events.service.ts`.
- Modify `packages/features/events/src/components/my-volunteering.tsx` and `attendance-panel.tsx`.
- Modify `packages/features/events/src/types.ts`.
- Modify the pages `apps/portal/app/home/volunteering/page.tsx` and `apps/portal/app/home/events/[id]/page.tsx`.
- Add `@kit/event-emails` and `@kit/email` to `packages/features/events` devDependencies.

**Interfaces:**
- **`EventsService`:**
  - `myEventReminders(): Promise<boolean | null>`;
  - `setMyEventReminders(optOut: boolean)`;
  - `emailStatus(eventId): Promise<Record<signupId, {kind, tracking, at}>>`, which returns `{}` on a 42501 or on a missing-schema error.
- **Actions:**
  - After a successful `signupAction`, `updateEventAction` or `cancelEventAction`, call `after(() => dispatchEventEmails({client: getSupabaseServerAdminClient(), config: readEventEmailsConfig()}).catch((e) => console.error('event email dispatch failed', e)))`, importing `after` from `next/server`. The action's result must not depend on it.
  - New `setEventRemindersAction({enabled: boolean})` calls `set_my_event_reminders(!enabled)`.
- **UI:**
  - `MyVolunteeringView` gets the props `remindersEnabled: boolean | null`. When it's not null, it shows a Switch labelled `Email me a reminder the day before` with `data-test="volunteering-reminders"`. It calls the action, toasts `Reminder setting saved.`, and refreshes.
  - `AttendancePanel` gets `emailStatus` (from `/home/events/[id]/page.tsx`, loaded only when `canTakeAttendance`). Each row shows a small badge `<Kind> · <TRACKING_LABELS[tracking]>`, with `data-test="email-status-<signupId>"`. Problem statuses (`isProblem`) use the destructive style. Kind labels are Confirmation, Update, Cancellation and Reminder.

- [ ] Steps:
  - **RED tests:**
    - the switch renders from `remindersEnabled` and calls the action with the flipped value;
    - it is hidden when the value is null;
    - the attendance row shows "Confirmation · Delivered";
    - an action test: `signupAction` still returns `{success: true}` when the dispatch (mocked through `next/server`'s `after` invoking the callback) rejects.
  - **Then GREEN.** Typecheck, lint.
  - **Commit:** `feat(event-emails): send after sign-ups and changes, reminder switch, delivery badges`.

---

### Task 7: E2E (dry-run), runbook, env examples

**Files:**
- Create `apps/e2e/tests/event-emails/event-emails.spec.ts`.
- Modify `apps/e2e/tests/utils/cleanup.ts`. Delete `event_emails` for test members' sign-ups before deleting `event_signups` (or rely on the cascade), and delete `event_email_runs` with `ran_at >= startedAt`.
- Modify `docs/runbook/hosting.md` (a new section "8. Event emails") and `apps/portal/.env.development` (commented examples).

**Spec scenarios** (reuse `apps/e2e/tests/events/events.po.ts`: `buildVolunteerRoster`, `createWeeklyEvent`, and its direct local-Postgres helper pattern for reading the outbox):
1. An officer creates an event. A member signs up. The outbox has one `confirmation` row for that sign-up, and after the immediate dispatch its status becomes `dry_run`. Poll for up to 10 seconds.
2. The officer changes the location. One `update` row exists for that sign-up, and it reaches `dry_run`.
3. `POST /api/jobs/event-emails` with `Authorization: Bearer local-jobs` returns 200 with JSON containing `skipped`. A wrong secret gets 401.
4. The member turns off reminders on `/home/volunteering`. After a reload the switch stays off.
5. The lead opens the event page and sees `email-status-<signupId>`. Dry-run rows are hidden from status, so the badge is absent in dry-run. Assert that the attendance panel renders without error, and assert the badge only after inserting, through the direct DB helper, one live `sent` row plus a `delivered` event. The badge then reads "Confirmation · Delivered".

**Runbook section:** what each email is, the env vars, rollout (off, then dry-run for a week, then live with your own address first), the shared webhook, `kit.suppress_event_emails` for bulk fixes, how to read `event_email_runs`, and the Resend rate-limit note.

- [ ] Steps:
  - `pnpm stack:up`, then `pnpm --filter web-e2e exec playwright test tests/event-emails tests/events tests/dues-notices --reporter=line`.
  - Confirm the teardown leaves no test rows, and that the real member and role counts are unchanged.
  - **Commit:** `test(e2e): event emails in dry-run; runbook and env examples`.
