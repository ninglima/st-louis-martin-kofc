# Finance Reports — Design

**Date:** 2026-10-12
**Status:** Draft for review

## Goal

Let the Financial Secretary produce two documents from the finance
dashboard, and email either one to himself:

1. A **monthly worksheet**: membership as the roster stands when he opens
   it, and dues received in the calendar month he picks.
2. A **payment packet**: the Supreme total and the state total he copies
   off those bills.

IDCS does not calculate per capita, does not file with Supreme or the
state, and does not pay either of them.

## Decisions

| Decision | Choice |
| --- | --- |
| Place | A Reports page beside the dashboard, not a fifth dashboard tab |
| Route | `/home/reports` |
| Who | Anyone who can open the finance dashboard |
| Worksheet | Computed when opened. Nothing is saved |
| Packets | Saved, editable, deletable. Newest first |
| Amounts on a packet | Typed from the bill. Stored in cents. Never computed |
| Email | Optional. To the signed-in account only. Body is the report |
| Provider | Resend, From `DUES_NOTICES_FROM`, same allowlist as other live mail |

## Page

`/home/reports` uses `requirePermission('dashboard_finance', 'view')`, the
same gate as `/home/dashboard`. The dashboard tab nav gains a Reports link
to this route. The four tabs stay Overview, Collection, Lapses, and
Retention.

The page has two parts.

### Monthly worksheet

A month picker. It defaults to the calendar month before the current one.
**Today** is the America/Chicago date, `kit.council_today()`, the same day
the rest of finance uses.

Both blocks are labeled with the chosen month:

- **Roster, as of today.** Total members, then counts for `current`,
  `due_soon`, `due`, `lapsed`, and `no_record`. The five counts add up to
  the total. These are the statuses the dashboard already uses, evaluated
  today, including when the chosen month is in the past. The roster has no
  history.
- **Dues received in the chosen month.** Total, then card, check, and cash.
  Card is the ledger method `online`.

There is no per-capita line.

If the reports migration has not been applied, the page shows "Not
available yet", the same way the dashboard tabs do before their migration.

### Payment packets

A list, newest first, and a form for a new packet. Fields:

| Field | Rule |
| --- | --- |
| Label | Required. A short name he chooses, such as "Supreme, January 2027" |
| Supreme total | Dollars and cents. May be blank |
| State total | Dollars and cents. May be blank |
| Note | Optional |

At least one of the two totals is required. A total of zero is allowed. A
negative total is not. More than two decimal places is refused. The page
stores the exact cent amount. Opening a saved packet shows the same form,
filled in, so he can correct it. He can delete a packet. Any user who can
open Reports can edit or delete any packet, not only the one who created
it.

## Data

Reads and writes go through `security definer` functions. Each one calls
`kit.assert_finance_dashboard()`, which allows `finance.view` or
`dashboard_finance.view`. Tables have RLS enabled, no policies, and every
privilege revoked from `anon` and `authenticated`.

### `public.finance_monthly_worksheet(p_month date)`

`p_month` is the first day of a month. The function refuses anything else,
a month before 2000-01-01, and a month after the first day of the current
calendar month. The error is `P0001`.

Returns jsonb:

```json
{
  "month": "2026-03-01",
  "asOf": "2026-10-12",
  "roster": 375,
  "statusCounts": {
    "current": 0,
    "due_soon": 0,
    "due": 0,
    "lapsed": 0,
    "no_record": 0
  },
  "receivedCents": 0,
  "onlineCents": 0,
  "checkCents": 0,
  "cashCents": 0
}
```

`receivedCents` is `onlineCents + checkCents + cashCents`.

Dues received are active `dues_periods` rows whose `received_on` falls in
the half-open month `[p_month, p_month + 1 month)`, and whose `method` is
`online`, `check`, or `cash`. Rows with `voided_at` set are excluded.
`waived` and `opening_balance` are excluded.

Status counts use the same derivation as the dashboard, as of
`kit.council_today()`, over the current roster.

### `public.finance_payment_packets`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `label` | text, not blank, at most 120 characters |
| `supreme_cents` | integer, null or `>= 0` |
| `state_cents` | integer, null or `>= 0` |
| `note` | text, null or at most 500 characters |
| `created_by` | `auth.users`, the account that created it |
| `created_at`, `updated_at` | timestamps |

A check requires `supreme_cents` and `state_cents` not both null.

### Packet functions

| Function | Purpose |
| --- | --- |
| `public.finance_payment_packets()` | The list, `created_at` descending, then `id` descending |
| `public.finance_payment_packet_save(p_id uuid, p_label text, p_supreme_cents int, p_state_cents int, p_note text)` | Insert when `p_id` is null. Update when `p_id` is set. Returns the row |
| `public.finance_payment_packet_delete(p_id uuid)` | Deletes that row |

Save rejects a blank label, a label over 120 characters, a note over 500
characters, a negative total, and both totals null. A blank note is stored
as null. Update or delete of an unknown id raises `P0001` with the message
`payment packet not found`. `created_by` is set on insert and left
unchanged on update. Update and delete do not check that the caller is
`created_by`.

## Email

A server action in `@kit/finance` sends one report. It does not write a
send log. Sending again sends another copy.

The message uses the branded council layout, HTML and plain text. There is
no attachment. The worksheet body contains the month, the as-of date, the
roster total, the five status counts, and the received total with card,
check, and cash. The packet body contains the label, both totals (a blank
total is shown as blank), and the note when there is one.

| Document | Subject |
| --- | --- |
| Worksheet | `Council worksheet, March 2026` (the chosen month) |
| Packet | `Payment packet: ` plus the saved label |

From is `DUES_NOTICES_FROM`. The API key is `RESEND_API_KEY`. When
`EMAIL_ALLOWLIST` is set, the recipient must be on it. An empty allowlist
means no allowlist, matching `parseEmailAllowlist`.

The recipient is the email on the signed-in account. The action refuses a
user who lacks `dashboard_finance.view`.

The Email to me button is disabled, with the reason on the page, when:

- `RESEND_API_KEY` or `DUES_NOTICES_FROM` is missing
- the signed-in account has no email address
- an allowlist is set and that address is not on it

On success the page says the report was sent to that address. On a Resend
failure the worksheet stays on screen, the packet stays saved, and the page
says it was not sent.

The form refuses an empty pair of totals and a negative total before the
request is sent. The database checks are the backstop.

## Testing

### pgTAP

`finance_monthly_worksheet`:

- card, check, and cash with `received_on` in the month are summed into
  the matching fields and into `receivedCents`
- a waiver, an opening-balance row, and a voided row in that month add
  nothing
- a payment on the first of the next month is excluded
- the five status counts equal `roster`
- a month before 2000-01-01, a month after the current one, and a date
  that is not the first of a month raise `P0001`
- a member without the dashboard permission gets `42501`

`finance_payment_packet_save` and delete:

- a Supreme total alone, and a state total alone, each save
- both totals null, a negative total, a blank label, and an oversized
  label or note are refused
- update changes the totals and leaves `created_by` as the original account
- the list is newest first
- update or delete of an unknown id raises `P0001` `payment packet not found`
- a member without the dashboard permission gets `42501`

### Unit

The mail builder, given a worksheet or a packet, produces the subject
above and both bodies, including the typed totals and the month's received
figures. The action refuses a missing From address, a missing account
email, and an allowlist that does not include the recipient. A Resend
failure returns the error and does not delete the packet.

### Browser

An officer who can open the dashboard opens Reports from the dashboard
nav, sees the worksheet for the month that just ended, saves a packet with
a Supreme total only, and sees that packet in the list. A member has no
Reports link, and opening `/home/reports` directly is refused.
