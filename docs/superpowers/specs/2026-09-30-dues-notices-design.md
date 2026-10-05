# Dues Notices by Email — Design

**Date:** 2026-09-30
**Status:** Draft for review

## Goal

Remind members about their dues automatically by email, and show the
Financial Secretary (FS) what happened to each email: sent, delivered,
opened, clicked, bounced or complained. The email is sent through Resend,
which also reports those tracking events. This builds on the dues model and
the dues insights dashboard.

## Decisions

| Decision | Choice |
| --- | --- |
| Sending | Fully automatic, once a day |
| Notices per cycle | 30 days before, on the due date, 30 days after |
| Excluded | Honorary members, members without an email address, members the FS opts out |
| Provider | Resend (the account and sending domain are already set up), with open and click tracking |
| Trigger | A Cloudflare cron trigger on the router Worker calls the portal at 14:00 UTC (9 a.m. Central in summer, 8 a.m. in winter) |
| Safety | `DUES_NOTICES_MODE` = `off` (the default), `dry-run` or `live` |
| Access | Reads need `finance.view`; the opt-out switch needs `finance.manage`; only the job and the webhook write notices and events |

## Rules

A notice is sent to a member only when all of these hold:

- the member is not on the `honorary` level;
- `members.dues_notices_opt_out` is false;
- `members.primary_email` is not blank.

Definitions:

- **Today** is the America/Chicago date.
- **Cycle date:**
  - the member's `paid_through` (the dues model's exclusive end date);
  - for a member who has never paid, their `accepted_on`;
  - a member with neither is never notified.

Each notice type has a sending window, measured from the cycle date `c`. The windows don't overlap, so a member gets at most one notice a day.

| Kind | Window (inclusive) | Also requires |
| --- | --- | --- |
| `before_30` | `c − 30` to `c − 1` | nothing |
| `due_date` | `c` to `c + 7` | nothing |
| `after_30` | `c + 30` to `c + 37` | still unpaid: status is `lapsed` or `due` |

Further rules:

- **Once only.** A notice of a given kind is sent only once for a given member and cycle date. A unique key on `(member_id, kind, cycle_date)` enforces this.
- **Paying stops later notices.** Paying moves `paid_through`, and with it the cycle date, so notices still pending for the old date never match again.
- **Catching up.** If the job misses a day, it sends whichever notice's window contains today on its next run. It never sends a notice whose window has already closed.
- **No launch-day blast.** Members more than 37 days past their cycle date fall outside every window, so they are never notified automatically. They stay on the Lapses list for the FS.

## Data

A new migration adds these objects.

### Member setting

- `members.dues_notices_opt_out boolean not null default false`.
- It is set through `public.set_member_dues_notices(p_member_id uuid, p_opt_out boolean)`, which requires `finance.manage`.

### `public.dues_notices`

One row per notice.

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `member_id` | the member (`on delete restrict`) |
| `kind` | `before_30`, `due_date` or `after_30` |
| `cycle_date` | the cycle date the notice was sent for |
| `email` | the address it went to |
| `mode` | `dry_run` or `live` |
| `status` | `pending`, `sent`, `failed` or `dry_run` |
| `resend_email_id` | Resend's ID for the email (unique) |
| `error` | the error, if sending failed |
| `created_at`, `sent_at` | timestamps |

`(member_id, kind, cycle_date)` is unique.

### `public.dues_notice_events`

One row per Resend event.

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `notice_id` | the notice the event belongs to |
| `type` | `sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened` or `clicked` |
| `occurred_at` | when the event happened |
| `svix_id` | Resend's webhook message ID (unique), so a replayed event is stored once |
| `payload` | the full event as `jsonb` |

### `public.dues_notice_runs`

One row per job run: `ran_at`, `mode`, `candidates`, `sent`, `skipped`, `failed` and `error`.

### Privileges

All three tables have RLS enabled, no policies, and every privilege revoked from `anon` and `authenticated`. Only the job and the webhook (service role) write to them.

### Tracking status

`kit.dues_notice_tracking(notice_id)` returns the furthest point an email reached, checked in this order:

1. `failed`, `dry_run` or `pending`, from the notice's own status;
2. `complained`;
3. `bounced`;
4. `clicked`;
5. `opened`;
6. `delivered`;
7. `sent`.

### Functions

| Function | Access | Purpose |
| --- | --- | --- |
| `public.dues_notices_claim(p_mode text)` | `service_role` only | Inserts a notice row for every current candidate and returns the new rows with the member's name, level and amount. Existing rows are skipped (`on conflict do nothing`). In dry-run mode, the rows are stored with status `dry_run`. |
| `public.dues_notices_list(p_kind text, p_tracking text, p_limit int)` | `finance.view` | The notice list, newest first, with member name, email and tracking status. |
| `public.dues_notice_events_for(p_notice_id uuid)` | `finance.view` | One notice's event timeline. |
| `public.dues_notices_last_run()` | `finance.view` | The latest job run. |
| `public.dues_notices_unreachable()` | `finance.view` | Members the FS must reach another way (see below). |
| `public.dues_last_notices(p_member_ids uuid[])` | `finance.view` | The latest notice per member, with its kind, sent date and tracking status. |
| `public.member_dues_notices(p_member_id uuid)` | `finance.view` | One member's full notice history. |

`dues_notices_unreachable()` lists two groups:

- members who are due a notice under the window rules but have no email address;
- members whose latest notice bounced or drew a complaint.

## Sending and tracking

### The daily job

`POST /api/jobs/dues-notices` handles each run:

1. **Authentication.** The request needs `Authorization: Bearer <DUES_JOBS_SECRET>`. Without it the endpoint answers 401.
2. **Mode off.** When the mode is `off`, the job only records a run with zero counts.
3. **Other modes.** The job calls `dues_notices_claim`.
   - **Dry-run:** no email is sent.
   - **Live:** the job sends the claimed rows through Resend's batch API (`POST https://api.resend.com/emails/batch`), 100 at a time, using `fetch` and no SDK. On success it stores each `resend_email_id` and sets the row to `sent`. On failure it sets the row to `failed` and stores the error.
4. **Result.** The job records the run and answers with the counts.

### The trigger

The router Worker gets a `scheduled` handler and the cron `0 14 * * *`. The handler posts to `${PORTAL_ORIGIN}/api/jobs/dues-notices` with:

- `x-origin-auth`, the same header the router already sends to reach the portal origin;
- the bearer secret.

It needs one new Worker secret, `DUES_JOBS_SECRET`. The operator deploys the Worker.

### The email

- **From and reply-to:** `DUES_NOTICES_FROM` and `DUES_NOTICES_REPLY_TO`.
- **Body:** each kind has its own subject line and wording. Every email includes:
  - the member's first name;
  - their level and amount;
  - the cycle date, displayed as the last day covered (`c − 1`);
  - a "Pay dues" link to `<site origin>/home/checkout`;
  - a line saying to reply to the Financial Secretary to stop reminders.
- **Formats:** both HTML and plain text.
- **Tags:** `notice_id` and `kind`.

### The webhook

`POST /api/webhooks/resend` handles each event:

1. **Signature.** It verifies the Svix signature (HMAC-SHA256 with `RESEND_WEBHOOK_SECRET`) and rejects timestamps more than 5 minutes old. A bad signature is refused with 400.
2. **Matching.** It finds the notice by `data.email_id`. An unknown ID is acknowledged with 200 and not stored, since it isn't a dues notice.
3. **Storing.** It stores the event, keyed on `svix_id` (`on conflict do nothing`), and answers 200.

## Pages and UI

### `/home/dues-notices`

The page appears in the sidebar under the `finance` section.

- **Status bar:** the mode, the last run, and its counts.
- **Filters:** by kind and by tracking status.
- **Notice table:**
  - Columns: member, kind, cycle date, sent, and a tracking badge.
  - Clicking a row expands its event timeline.
  - Bounced and complained badges show in red.
- **"Could not notify":** the list from `dues_notices_unreachable()`.

### Existing pages

- **Overview follow-up list and the Lapses list:** a "Last notice" column showing the kind, the date and the badge, or "—".
- **Member page dues card:** a notice history, plus a "No automatic dues notices" switch (`finance.manage`).

### Graceful absence

If the migration hasn't run yet, the Dues notices page shows "Not available yet". The "Last notice" columns show "—".

## Configuration

These values go in the portal environment and Secret Manager:

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `DUES_NOTICES_MODE` (defaults to `off`)
- `DUES_NOTICES_FROM`
- `DUES_NOTICES_REPLY_TO`
- `DUES_JOBS_SECRET`
- `NEXT_PUBLIC_SITE_URL`, which already exists and is used for the Pay dues link

The runbook documents:

- the Secret Manager entries, and adding them to `deploy.yml` once they exist. `deploy.yml` is not changed in this work, because referencing a secret that doesn't exist yet would break the `main` deploy.
- the Worker secret and deploy;
- registering the Resend webhook at `<site>/api/webhooks/resend`, with events `email.*`.

## Testing

- **pgTAP:**
  - Window edges for each kind: `c − 31` sends nothing, `c − 30` sends `before_30`, `c − 1` sends `before_30`, `c` sends `due_date`, `c + 7` sends `due_date`, `c + 8` sends nothing, `c + 29` sends nothing, `c + 30` sends `after_30`, `c + 37` sends `after_30`, `c + 38` sends nothing.
  - Exclusions: honorary members, no email, opted out, and a member who paid.
  - A second claim returns no rows.
  - Dry-run status.
  - Tracking order.
  - Grants and gates.
- **Vitest:**
  - config parsing;
  - templates for each kind;
  - the Resend client with a faked `fetch`: batching and error mapping;
  - Svix verification: a valid signature, a forged one, an expired one, and several signatures in the header;
  - the job in each mode, with a fake client and a fake Resend;
  - the webhook handler: an unknown ID and a replayed event;
  - the tracking badge.
- **Worker:** a `scheduled` test asserts the request it sends (URL and headers).
- **Playwright:** with `DUES_NOTICES_MODE=dry-run` in the stack, post to the job endpoint with the secret, then check the notice appears on `/home/dues-notices` and in the Last notice column. Also check that a wrong secret gets 401. No real email is ever sent.

## Out of scope

- Manual "send now" and custom messages
- SMS
- Notices for special assessments or events
- A per-member unsubscribe link (replies go to the FS)
