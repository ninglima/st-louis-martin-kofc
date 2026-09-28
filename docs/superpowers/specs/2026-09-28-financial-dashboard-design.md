# Financial Dashboard and Hosting Costs — Design

**Date:** 2026-09-28
**Status:** Draft for review

## Goal

Give the Financial Secretary (FS), and any officer with `finance.view`, one page
that answers "how are dues coming in, who needs a follow-up, and what does the
council spend on hosting?" with numbers computed from real data. This spec
combines pieces 2 (hosting costs) and 3 (the dashboard) of the financial
dashboard roadmap. Piece 1, the dues model, is in
`2026-09-28-dues-model-design.md` and is merged to `dev`.

## Context

- The dues model provides the `dues_periods` ledger, `dues_levels`, member dues
  status and the `finance` RBAC section (view, manage).
- `/home` still shows MakerKit's demo dashboard with sample data.
- The hosting spec expects Cloud Run and Cloudflare Workers to stay in their
  free tiers ($0). The real hosting bill is Supabase Pro (about $25 a month) and
  the domain.

## Decisions

| Decision | Choice |
| --- | --- |
| Hosting cost source | Entered by hand only. No billing API sync (it can be added later if usage costs appear) |
| Spec scope | Hosting costs and the dashboard in one spec |
| Recording a cost | One entry per bill, with the period it covers; spread evenly by day across that period |
| Repeat bills | A "Repeat last bill" action per provider, no scheduled recurring rows |
| Providers | Fixed, seeded list: Supabase, Cloudflare, Google Cloud, Domain, Other |
| Dashboard location | Replaces the demo on `/home` for `finance.view`; everyone else gets a member home |
| Hosting cost page | `/home/hosting-costs`, in the sidebar for `finance.view` |
| Reporting year | Fraternal year, July 1 – June 30, with a year picker |
| Access | The existing `finance` section: view to see, manage to change |

## Data model

### `public.hosting_providers` (seeded reference table)

| slug | name | sort_order |
| --- | --- | --- |
| `supabase` | Supabase | 1 |
| `cloudflare` | Cloudflare | 2 |
| `google_cloud` | Google Cloud | 3 |
| `domain` | Domain | 4 |
| `other` | Other | 5 |

Columns: `slug text primary key`, `name text not null`, `sort_order integer not null`,
`active boolean not null default true`. Readable by every authenticated user.

### `public.hosting_costs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `provider` | text not null → hosting_providers(slug) | |
| `amount_cents` | integer not null, ≥ 0 | |
| `paid_on` | date not null | |
| `period_start` | date not null | |
| `period_end` | date not null | Exclusive, as with dues; check `period_end > period_start` |
| `note` | text | Optional, at most 500 characters |
| `created_by`, `updated_by` | uuid → auth.users, `on delete restrict` | |
| `created_at`, `updated_at` | timestamptz | `updated_at` set by trigger |

Bills can be edited and deleted (bookkeeping, not member records). There is no
direct table access. Every read and write goes through `security definer`
functions with `set search_path = ''`. Default privileges for `anon` and
`authenticated` are revoked on both tables; `authenticated` keeps `select` on
`hosting_providers` only.

### Write functions (`finance.manage`)

- `hosting_cost_upsert(p_id uuid, p_provider text, p_amount_cents int, p_paid_on date, p_period_start date, p_period_end date, p_note text) returns public.hosting_costs`:
  insert when `p_id` is null, otherwise update. It validates the provider (active), the amount (≥ 0), the dates (`period_end > period_start`, span at most 3 years) and the note length. It raises P0001 with a readable message.
- `hosting_cost_delete(p_id uuid) returns void`
- `hosting_cost_repeat_last(p_provider text) returns public.hosting_costs`: copies that provider's bill with the latest `period_end`. The new period starts at that end and has the same length in days, and `paid_on` is today (America/Chicago). It raises P0001 if the provider has no bills.

### Read functions (`finance.view`)

- `hosting_costs_list(p_year int)`: bills overlapping the fraternal year (July 1 of `p_year` to July 1 of `p_year + 1`), newest first, with the recorder's email.
- `hosting_cost_overlaps(p_provider text, p_period_start date, p_period_end date, p_exclude_id uuid)`: ids of that provider's bills overlapping the range, for the overlap warning.

## Calculations

All dashboard figures come from `security definer` functions gated by
`finance.view`. They use America/Chicago as "today" and integer cents.
Fraternal year `Y` covers `[Y-07-01, (Y+1)-07-01)`.

### Spreading a bill across months

A bill covers `d = period_end - period_start` days. The part of it in calendar month
`M` is `amount_cents × (days of [period_start, period_end) inside M) ÷ d`.
Sums are rounded to whole cents only at the end, per month and provider, so a
$12.00 annual bill yields about $1.00 a month and the year's total stays exact
within a cent. Leap years need no special case, because the calculation counts days.

### Year-scoped figures (follow the year picker)

| Figure | Definition |
| --- | --- |
| Dues collected | Sum of `amount_cents` over active `dues_periods` with `received_on` in the year. Waived and opening-balance rows are $0 by definition |
| Dues per month by method | The same, grouped by calendar month and method (`online`, `check`, `cash`) |
| Hosting per month by provider | Spread amounts for each of the 12 months |
| Hosting so far | Spread amounts from July 1 through today. For a past year this is the whole year |
| Hosting projection | For the current year only. Spread amounts of bills already entered for the whole year, plus, for each provider, the days after its latest `period_end` up to the year's end at that bill's daily rate. A provider with no bill in the last 13 months is not projected |
| Net per year | Dues collected minus hosting (spread) for every fraternal year from the first year with any data to the current year |

### Snapshot figures (always today, labelled "as of today")

| Figure | Definition |
| --- | --- |
| Outstanding | Sum of the member's level `amount_cents` over members whose status is `due` or `lapsed` |
| Members by status | Count per status (`current`, `due_soon`, `due`, `lapsed`, `no_record`) |
| Collection rate | (current + due_soon) ÷ (current + due_soon + due + lapsed), excluding members at the `honorary` level and `no_record`; shown as "—" when the denominator is 0 |
| Follow-up list | Every `lapsed` member, plus `due` members and those whose `paid_through` is within 30 days. Columns: name, membership number, status, paid through, level, amount owed. Sorted lapsed first, then by paid through |
| Payments to check | `payments` with `payment_type = 'dues'` and `status = 'succeeded'` that have no `dues_periods` row with that `payment_id`. Columns: date, member, level from metadata, amount, provider |

### Functions

- `finance_dashboard(p_year int) returns jsonb`: headline figures, per-month series and status counts in one call.
- `finance_net_by_year() returns table(year int, dues_cents bigint, hosting_cents bigint)`
- `finance_follow_up() returns table(...)`
- `finance_payments_to_check() returns table(...)`

`p_year` outside 2000 to the current year + 1 raises P0001.

## Pages and UI

### `/home`

- **With `finance.view`:** the financial dashboard.
  - A year picker (`?year=2026` = July 2026 – June 2027), defaulting to the current fraternal year. An invalid value falls back to the default.
  - Four headline cards:
    - dues collected;
    - outstanding, as of today;
    - collection rate, as of today;
    - hosting so far, with the projection as a second line in the current year.
  - Four charts, using `@kit/ui/chart` (shadcn/Recharts):
    - dues per month, stacked by method;
    - members by status, as of today;
    - hosting per month, stacked by provider;
    - net dues minus hosting per year.
  - The follow-up table. The name links to `/home/members/<id>` (requires `members.view` to follow).
  - The payments-to-check table, hidden when empty.
- **Without `finance.view`:** a member home.
  - A "My dues" summary (status, paid through, level) with a Pay dues link when due, lapsed or due soon. This reuses the dues package.
  - Links to Payments and Settings.
  - A short note when the account has no linked member record.
- The MakerKit demo dashboard (`dashboard-demo*.tsx`) and its sample data are deleted.

### `/home/hosting-costs`

- A sidebar item under Application, with `section: 'finance'`, so it is visible with `finance.view`. The page calls `requirePermission('finance','view')`.
- A table of bills for the selected fraternal year: provider, amount, paid on, covers (start – end, shown inclusive as the day before `period_end`), note. It has the same year picker.
- With `finance.manage`:
  - **Add** and **Edit** open a dialog. The fields are:
    - the provider dropdown;
    - the amount in dollars, converted to cents without floating point;
    - paid on;
    - covers from and to, with to entered inclusive and stored as +1 day.
  - The form previews the monthly equivalent. It warns when the period overlaps another bill for the same provider, but still allows saving.
  - **Delete** asks for confirmation.
  - **Repeat last bill**, per provider, shows the new period before saving.

### Code layout

A new package `@kit/finance` (`packages/features/finance`), following
`@kit/dues`:
- types and schemas;
- `FinanceService`;
- actions returning `{ success: true } | { success: false; error }`;
- components.

The package depends on `@kit/dues` for the member home. Pages live in
`apps/portal/app/home`.

### Graceful absence

The deploy rule: migrations deploy before or with the app. The pages treat
missing functions or tables (42883, 42P01, PGRST202, PGRST205) as "no finance
data". `/home` then renders the member home, and `/home/hosting-costs`
renders an empty state. This reuses the dues package's schema-missing helper.

## Testing

- **pgTAP:**
  - spreading an annual bill, a monthly bill, a bill starting mid-month, a bill crossing the fraternal-year boundary, and a leap-year February;
  - dues collected on June 30 versus July 1;
  - dues by method;
  - hosting so far and the projection, including a provider with no recent bill;
  - collection rate excluding honorary members and returning "—" at 0;
  - the follow-up list membership and order;
  - payments to check;
  - every read refused without `finance.view`, and every write without `finance.manage`;
  - repeat last bill's period;
  - validation errors;
  - the revoked privileges.
- **Vitest:**
  - schemas (dollars to cents, the inclusive-to-exclusive date, date order, note length);
  - year-picker parsing;
  - overlap-warning display;
  - service error mapping and the action result shape;
  - the member home without a member record.
- **Playwright:**
  - an administrator adds a Supabase bill and the dashboard's hosting figure changes;
  - repeat last bill creates the next period;
  - a member without `finance.view` sees the member home, no dashboard and no Hosting costs link.

## Rollout order

1. Migration: `hosting_providers`, `hosting_costs`, the write and read functions, pgTAP.
2. Migration: the dashboard functions, pgTAP.
3. `@kit/finance` package: types, schemas, service, actions.
4. `/home/hosting-costs` page.
5. `/home` dashboard and member home; remove the demo.
6. E2E tests.

The migrations only add things, so they are backward-compatible.

## Out of scope

- Billing API sync for Cloudflare or Google Cloud
- Budgets, alerts and emailed reports
- The Recruitment & Retention view
- Exports (CSV or PDF) of dashboard figures
- Donations, event fees and special assessments in any figure
