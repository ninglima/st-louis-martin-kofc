# Dues Insights Dashboard — Design

**Date:** 2026-09-29
**Status:** Draft for review

## Goal

Keep the Financial Secretary (FS) and the Recruitment & Retention committee
focused on dues. The dashboard on `/home` should answer four questions:

- How far along is collection this year?
- What is coming due?
- How long have lapsed members gone unpaid?
- Are we keeping members?

This builds on the dues model (`2026-09-28-dues-model-design.md`) and the
financial dashboard (`2026-09-28-financial-dashboard-design.md`). Hosting
costs stay hidden behind `NEXT_PUBLIC_ENABLE_HOSTING_COSTS`, which is off.
Dues notice emails are the next spec, and they will add a "last notice"
column to the lapsed-member list.

## Decisions

| Decision | Choice |
| --- | --- |
| Views | All four: collection progress, coming due, lapse aging, retention |
| Layout | Tabs on `/home`: Overview, Collection, Lapses, Retention |
| Grace period | 90 days after `paid_through`. A renewal within it counts as kept; after it, a new lapse |
| Honorary members | Left out of every count and rate (collection progress, retention); included in dollar figures only where noted |
| Access | `finance.view`, as for the existing dashboard |

## Definitions

These terms apply throughout:
- **Today:** the America/Chicago date (`kit.council_today()`).
- **Fraternal year `Y`:** `[Y-07-01, (Y+1)-07-01)`.
- **`paid_through`:** exclusive. A member paid through 2027-03-01 is covered through 2027-02-28.
- **Active period:** a `dues_periods` row that is not voided.

### Collection progress (Collection tab; follows the year picker)

- **Expected member for year `Y`:** a non-honorary member with either:
  - an active period whose `period_end` falls in year `Y`, or
  - no active period and an `accepted_on` in year `Y` or earlier (their first dues are owed).

  A member counts once per year. With several such periods, the latest one is used.
- **Renewed:** an expected member who has an active period starting on or after the `period_end` above. For a first-dues member, any active period counts.
- **Progress:** renewed ÷ expected, shown as a bar with both counts. When expected is 0, show "—".
- **Dollars expected:** the sum of each expected member's current level `amount_cents`.
- **Dollars collected:**
  - Only dues received in year `Y` count: the sum of `amount_cents` over active periods whose `received_on` falls in `Y`.
  - Honorary members are included here, because this is cash in.
  - The figure matches the Overview's "Dues collected".
- **Running total:** dollars collected, added up month by month from July to June.
  - It is shown against a flat "dollars expected" line.
  - For the current year, months after today are left empty.

### Coming due (Collection tab; always from today)

- **Months:** the 12 calendar months starting with the current one.
- **Members per month:** members whose `paid_through` falls in that month, excluding members already lapsed.
- **Dollars per month:** their level amounts. Honorary members are included here, because they still pay the honorary rate.
- **Clicking a month** lists those members: name, membership number, paid through, level, amount, and a link to their page.

### Lapse aging (Lapses tab; always as of today)

- **Days unpaid:**
  - for members with a `paid_through`: `today − paid_through + 1`, counted when status is `lapsed`, meaning `paid_through ≤ today`;
  - for `due` members (no periods, `accepted_on` set): `today − accepted_on + 1`.

  A member whose `paid_through` is today has 1 day unpaid. A member whose
  `accepted_on` is in the future is not yet due or lapsed, and is left out
  of the list and the aging buckets entirely.
- **Buckets:** 1–30, 31–90, 91–180 and 181+ days.
  - Each bucket shows its member count and dollars owed, the sum of level amounts.
  - Honorary members are included and labelled, because they still owe.
- **Lapsed-member list:**
  - It lists every lapsed or due member, oldest first.
  - Columns:
    - name, with a link to `/home/members/<id>` when the viewer has `members.view`
    - membership number
    - days unpaid
    - bucket
    - level
    - owed
    - last payment date: the latest `received_on` among active periods paid with
      real money (`online`, `check` or `cash`), or "—". A waiver or an
      opening-balance import row is not a payment.
- **Overview's follow-up list:** from now on it shows only members who are `due` or whose `paid_through` is within 30 days. Lapsed members move to this tab.

### Retention (Retention tab; the last 5 fraternal years, ending with the current one)

- **Renewal rate for year `Y`:**
  - **Denominator:** non-honorary members with an active period whose `period_end` falls in `Y`, counting each member's latest such period, picked before the closed-window filter below is applied.
  - **Numerator:** those with a later active period (`period_start ≥ period_end`) whose `received_on ≤ period_end + 90`. Periods are anchored at the previous end, so the received date, not the start date, tells a late payment from an on-time one. Early renewals count. A voided renewal does not count.
  - Only periods whose grace window has already closed (`period_end + 90 < today`) are counted, for every year, not only the current one.
  - An opening-balance row whose grace window had already closed before it was loaded (`period_end + 90 < received_on`) is excluded entirely, from both eligibility and lapses: the load date is not a real renewal event.
  - When the denominator is 0, show "—".
- **New lapses per month:** non-honorary members whose `paid_through + 90` falls in that calendar month without a renewal in the grace window, for each month of the last 5 years up to today. The same opening-balance exclusion applies here.

## Functions

The functions are:
- in one additive migration;
- `security definer` with `set search_path = ''`;
- revoked from `public` and `anon`, then granted to `authenticated`.

Each public function calls `kit.assert_finance_view()` and passes `kit.council_today()` to a `kit.*_at(p_today)` core. Tests call the core with fixed dates.

| Public function | Returns |
| --- | --- |
| `finance_collection_progress(p_year int)` | jsonb `{ expected, renewed, expectedCents, collectedCents, byMonth: [{ month, cents, cumulativeCents }] }` |
| `finance_renewals_forecast()` | table `(month date, members int, cents bigint)`, 12 rows |
| `finance_forecast_members(p_month date)` | table `(member_id, first_name, last_name, membership_number, paid_through, level_name, amount_cents)` |
| `finance_lapse_aging()` | table `(bucket text, members int, cents bigint)`, 4 rows in order |
| `finance_lapsed_members()` | table `(member_id, first_name, last_name, membership_number, days_unpaid int, bucket text, level_name, amount_cents, last_paid_on date)` |
| `finance_retention()` | jsonb `{ years: [{ year, eligible, renewed }], lapsesByMonth: [{ month, lapses }] }` |

Two further rules:
- `finance_follow_up()` and its core are replaced, with the same signature, to drop lapsed members.
- `p_year` and `p_month` are validated: the year must be from 2000 to the current year + 1, and the month must be the first of a month within the next 12 months. Anything else raises `P0001`.

## Pages and UI

- **`/home` for `finance.view`:** a tab list with Overview, Collection, Lapses and Retention.
  - The active tab is `?tab=<name>`; an invalid value falls back to Overview.
  - The year picker (`?year=`) shows on Collection only.
  - Only the active tab's data is fetched.
- **Overview:**
  - the existing headline cards (dues collected, outstanding, collection rate);
  - the members-by-status chart;
  - dues per month by method;
  - dues collected per year;
  - the follow-up list (due and due within 30 days);
  - payments to check.
- **Collection:**
  - a progress bar with "renewed of expected";
  - two cards, dollars collected and dollars expected;
  - the running total line chart;
  - the coming-due bar chart. Clicking a bar, or choosing the month from a list, shows that month's members below it (`?month=YYYY-MM-01`).
- **Lapses:**
  - four bucket cards;
  - a bar chart by bucket;
  - the lapsed-member list.
- **Retention:**
  - a renewal-rate line (percent per year) with the counts in its tooltip;
  - a new-lapses-per-month bar chart.
- **Components** live in `@kit/finance`, following its existing patterns: pure transforms in `lib/`, and charts in the client-only charts module.
- **Graceful absence:** before the migration lands, each new tab shows "Not available yet" through `readDuesIfDeployed`, and Overview keeps working.

## Testing

- **pgTAP:** fixtures in far-future years; snapshot-style figures as deltas against a baseline, as in `finance_dashboard.test.sql`.
  - Collection progress: expected and renewed; first-dues members; honorary members excluded from counts but included in collected dollars; a July 1 versus June 30 `received_on`.
  - Forecast month boundaries.
  - Aging bucket edges at 30/31, 90/91 and 180/181 days, for both a lapsed member and a due member.
  - Retention grace edges: renewal at +90 counts, at +91 does not; an early renewal counts; the current year only counts closed windows.
  - Lapses per month.
  - Follow-up no longer lists lapsed members.
  - Every public function is refused without `finance.view`.
  - Parameter validation.
- **Vitest:** tab and month parsing; the running-total, forecast, aging and retention chart transforms, including empty data.
- **Playwright:** an administrator opens each tab and sees its content; `?tab=bogus` shows Overview; a member still gets the member home.

## Out of scope

- Dues notice emails and their Resend tracking (next spec)
- Exporting lists or charts
- Per-level or per-cohort breakdowns
- Hosting costs, which stay behind the feature flag
