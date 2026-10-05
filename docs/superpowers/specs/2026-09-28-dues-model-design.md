# Dues Model — Design

**Date:** 2026-09-28
**Status:** Draft for review

## Goal

Give the portal a trustworthy record of what each member owes and has paid,
so the Financial Secretary can collect dues in it and a later financial
dashboard can report real numbers. This is the first of three pieces:

1. **Dues model** (this spec)
2. Hosting costs: `hosting_costs` table, manual entries, daily Cloudflare and
   GCP sync (own spec)
3. Financial dashboard: nine metrics computed by Postgres functions, gated by
   `finance.view` (own spec)

## Context

- The portal has no dues data today. `members` has no level, acceptance date
  or paid-through date, and the roster import deliberately never writes dues
  state (roster import spec, rule 2). `payments` records Stripe and Square
  transactions, but checkout accepts any client-supplied amount, and nothing
  links a payment to a period of membership.
- The WordPress build used fixed-date renewals ("next August 1"), recorded
  checks by hand in Airtable, and never shipped online checkout. Its known
  defect was inferring "lapsed" from a status flag that another process also
  rewrote.

## Decisions

| Decision | Choice |
| --- | --- |
| Dues cycle | Per member: 365 days from acceptance into the council, renewing on that anniversary |
| Renewal anchor | A renewal starts at the previous period's end, whether paid early or late |
| New members | The Financial Secretary (FS) sets `accepted_on`; the member is due at once until his first payment is recorded |
| Existing members | A one-off FS CSV load of paid-through dates (`opening_balance` rows). The roster import still never touches dues |
| Levels | Stored per member, set by the FS, default Regular ($58). Members choose among self-service levels at checkout |
| Amounts | Always priced on the server from the chosen level, picked from a dropdown. Only donations take a free amount |
| Manual payments | The FS records check, cash and waived payments in the portal; they extend paid-through exactly like online ones |
| Storage | A `dues_periods` ledger: one row per year covered; paid-through is derived, never stored |
| Access | A new RBAC section `finance`: view to see dues, manage to change them |
| Reporting year (later dashboard) | Fraternal year, July 1 – June 30 |

Future note: the roster import reconciles with Supreme Council, and dues dates
may one day need adjusting from that reconciliation. That is out of scope here,
and the import keeps its "never touch dues" rule until it is designed.

## Data model

### `public.dues_levels` (seeded reference table)

| slug | name | amount_cents | self_service |
| --- | --- | --- | --- |
| `regular_contrib` | Regular (with voluntary contribution) | 5800 | yes |
| `regular` | Regular | 5000 | yes |
| `student` | Student | 2500 | only when `members.is_student` |
| `public_service` | Public Service | 2000 | no — FS assigns |
| `honorary` | Honorary | 1900 | no — FS assigns |

Columns: `slug text primary key`, `name text`, `amount_cents integer check (amount_cents >= 0)`,
`self_service boolean`, `sort_order integer`, `active boolean default true`.
The FS changes a rate by updating `amount_cents`. Past ledger rows keep the
amount actually charged. Special assessments (KOVAR, PKD, VKCCI) are not dues
levels and do not appear here.

### New columns on `public.members`

- `dues_level text not null default 'regular_contrib' references dues_levels(slug)`
- `accepted_on date` — nullable. Members who predate the portal get their dates
  from the CSV load instead.
- `is_student boolean not null default false`

These are written only through `security definer` functions gated by
`finance.manage` (the existing `members_no_direct_write` policy stays).
`member_upsert_from_roster` is unchanged and still cannot write them.

### `public.dues_periods` (the ledger)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `member_id` | uuid not null → members(id) | `on delete restrict`: dues history is never lost |
| `level` | text not null → dues_levels(slug) | The level at the time |
| `amount_cents` | integer not null, ≥ 0 | 0 for `waived` and `opening_balance` |
| `method` | enum `dues_method`: `online`, `check`, `cash`, `waived`, `opening_balance` | |
| `check_number` | text | Required when `method = 'check'` |
| `received_on` | date not null | Date money was received (`opening_balance`: the load date) |
| `period_start` | date not null | |
| `period_end` | date not null | `= period_start + 365` (check constraint) |
| `payment_id` | uuid → payments(id), unique | Online only; unique makes webhook replays harmless |
| `recorded_by` | uuid → auth.users | Null for webhook-created rows |
| `created_at` | timestamptz default now() | |
| `voided_at`, `voided_by`, `void_reason` | | All null, or all set (check constraint) |

Enforced by the database:

- **No overlap:** an exclusion constraint on
  `(member_id, daterange(period_start, period_end))` where `voided_at is null`
  (`btree_gist`).
- **Chaining:** writes go through `kit.dues_next_period_start(member_id)`,
  which returns the latest active `period_end`, or `accepted_on` when there is
  none. The write functions compute `period_start` themselves and never accept
  it from the caller.
- **Immutable:** no updates except setting the void columns once; no deletes.
  A trigger enforces this.
- **Money rules:** `amount_cents = 0` for `waived` and `opening_balance`;
  `amount_cents = dues_levels.amount_cents` at write time for `check`, `cash`
  and `online` (the functions set it; callers cannot pass it).

### Derived (views and functions, never stored)

- `paid_through` = `max(period_end)` over active periods. `period_end` is
  **exclusive** (a period covers `[period_start, period_end)`, matching Postgres
  `daterange` defaults). A member paid through 2027-10-01 is current on
  2027-09-30 and lapsed on 2027-10-01.
- `dues_status`, evaluated in this order:
  - `no_record`: no active periods and no `accepted_on`
  - `due`: `accepted_on` set, no active periods yet (a new member's first dues are owed)
  - `lapsed`: `paid_through <= today`
  - `due_soon`: `paid_through` within the next 90 days
  - `current`: otherwise
- "Outstanding" in the later dashboard means `due` + `lapsed`, each owed at the
  member's `dues_level` amount.
- Exposed through `public.member_dues_summary()` (gated by `finance.view`) and
  `public.my_dues()` (the signed-in member's own row and ledger).

## Recording payments

All write paths are `security definer` functions that check
`kit.has_permission('finance','manage')`, except the webhook path (service role).

| Function | Purpose |
| --- | --- |
| `record_dues_payment(member_id, level, method, received_on, check_number)` | FS records a check, cash or waived payment. Computes period, amount, `recorded_by`. Updates `members.dues_level` when `level` differs. |
| `void_dues_period(period_id, reason)` | Sets the void columns once; reason required. |
| `set_member_accepted_on(member_id, date)` | Allowed only while the member has no active periods. |
| `set_member_dues_level(member_id, level)` / `set_member_student(member_id, bool)` | FS level management. |
| `dues_opening_balances_apply(rows jsonb)` | CSV load apply step (below). |
| `record_online_dues_period(payment_id)` | Called by the webhook handler when a `dues` payment reaches `succeeded`; idempotent through the unique `payment_id`. A refund calls `void_dues_period` for the linked row. |

### FS form (member page)

On `/home/members/[id]`, for `finance.manage`:

- Dues level dropdown of every active level, preset to the member's level.
  There is no amount field; the price shown is read-only from the level.
- Method: check (with check number), cash, waived. Date received defaults to today.
- Before saving, the form shows the period it will cover.
- Each ledger row has a Void action that requires a reason.

### Checkout (member)

`/home/checkout`:

- **Dues:** a dropdown of the levels the member may choose — `self_service`
  levels, plus Student when `is_student`. When the FS assigned a non-self-service
  level, only that level is offered. The server prices it.
  `CreatePaymentSchema` changes to a discriminated union: `{ payment_type: 'dues', level }`
  (no amount) or `{ payment_type: 'donation' | 'event_fee', amount }`.
- **Donations** keep a free amount and never touch the ledger.
- The Stripe and Square webhook handlers call `record_online_dues_period`
  after marking a dues payment `succeeded`.

### Paid-through CSV load

`/home/members/dues-import`, `finance.manage`. It follows the roster import's
preview-then-apply pattern but is a separate action.

- Columns: `membership_number, paid_through` (required), `dues_level` (optional).
- Preview lists unknown membership numbers, invalid dates, unknown levels, and
  members who already have periods (these are skipped, never overwritten).
- Apply writes one `opening_balance` row per member: `period_end = paid_through`,
  `period_start = paid_through − 365`, $0.

## Permissions and UI

- `finance` is added to `SECTIONS` (`packages/features/rbac/src/types/sections.ts`)
  with verbs `view` and `manage`, and seeded in `role_permissions`: administrator
  gets view and manage; member gets neither.
- Row-level rules: `dues_levels` is readable by every authenticated user.
  `dues_periods` has no direct access; reads go through the gated functions,
  and `my_dues()` returns only the caller's own member row.

| Surface | Gate | Content |
| --- | --- | --- |
| `/home/members` list | `members.view`; dues columns need `finance.view` | Level, paid through, status badge, status filter |
| `/home/members/[id]` | `finance.view` to see; `finance.manage` for actions | Dues card, ledger, record payment, void, accepted on, level, student |
| `/home/members/dues-import` | `finance.manage` | Upload, preview, apply |
| `/home/payments` | Any signed-in member, own record only | "Paid through", level, own ledger, Pay dues button when due, lapsed or due soon |

Dues rows are not encrypted, matching `payments`; the encryption in `members`
covers addresses and phone numbers.

## Testing

- **pgTAP** (new, `apps/portal/supabase/tests/`, run by `supabase:test`):
  - chaining from `accepted_on` and from the previous end, both early and late
  - the overlap rejection
  - void fallback of `paid_through`
  - each status (`no_record`, `due`, `lapsed`, `due_soon`, `current`) and its
    edges: the day before and the day of `paid_through`, and 90 days out
  - $0 rules for `opening_balance` and `waived`
  - write functions refused without `finance.manage`
  - members reading only their own dues
  - webhook replay idempotency, and refund voiding the linked period
  - server-side pricing
- **Vitest:** the checkout and record-payment schemas (dues need a level and
  reject an amount; donations need an amount), the CSV parser and preview
  rules, and the status badge.
- **Playwright** (Docker stack):
  - the FS records a check and the member turns current
  - a member pays dues online and sees his new paid-through date
  - a user without `finance.view` sees no dues columns

## Rollout order

1. `finance` section, `dues_levels`, member columns, `dues_periods`, functions, pgTAP.
2. FS dues card on the member page.
3. Paid-through CSV load.
4. Checkout level dropdown, server-side pricing, webhook → period.
5. Members list columns and filter, and the member's own dues view.
6. E2E tests.

The migrations only add things, so they are backward-compatible under the
deploy rule in the hosting spec.

## Out of scope

- The financial dashboard and hosting costs (their own specs)
- Renewal reminders at 90/60/30 days
- Proration and refunds beyond voiding
- Reconciling dues dates with Supreme Council via the roster import
- Special assessments
