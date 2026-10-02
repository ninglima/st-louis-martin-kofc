# Event Emails — Design (volunteer events, piece 2)

**Date:** 2026-10-03
**Status:** Approved

## Context

Piece 1 (merged to local dev at `203e270`) lets members sign up for volunteer shifts. Nobody hears about it by email yet. Piece 2 adds three emails, built on the Resend setup and daily cron already used for dues notices:
- a sign-up confirmation with a calendar file;
- a day-before reminder;
- a notice when an event they signed up for is cancelled or rescheduled.

**Your decisions:**

| Topic | Decision |
| --- | --- |
| Delivery | An outbox queue, written in the same database step as the sign-up or change. The app sends right away, and the daily 9am job retries failures and sends reminders. |
| Change emails | Event cancelled (including "this and all later"), date/time changed, location changed. Not: removals by an officer, title-only edits. |
| Recipients | The volunteer only. No lead emails. |
| Opt-out | Confirmations and change notices always send. Members can turn off reminders themselves, on My volunteering. |
| Tracking | Officers and leads see each volunteer's last email status (Delivered, Opened, Bounced…) in the event page's attendance panel. |

**Verified constraints:**
- Resend's **batch endpoint doesn't support attachments**, so emails that carry a calendar file go one at a time through `POST /emails`.
  - Attachments are sent as `[{filename, content (base64), content_type}]`.
  - The `Idempotency-Key` header blocks duplicates for 24 hours.
- Reminders have no attachment, so they can keep using the batch endpoint.

## Approach

### Mode and config
- **Mode:** a separate `EVENT_EMAILS_MODE`, with values `off` (the default), `dry-run` or `live`.
- **New settings:** `EVENT_EMAILS_FROM` and `EVENT_EMAILS_REPLY_TO`.
- **Reused from dues notices:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and the jobs secret.
- **Live guard:** live mode refuses to send unless the API key, the from address and a public https site URL are set. It reuses `siteUrlProblem` from `packages/features/dues-notices/src/config.ts`.
- **Mode is applied when a row is claimed for sending.** In dry-run, a claimed row is stamped `dry_run` and is final. Reminder rows are unique per mode, so a dry run never uses up a live slot.

### Database (new migration `20261003120000_event_emails.sql`)

**Tables**
- **`event_emails` (the outbox):**
  - `kind`: `confirmation`, `update`, `cancel` or `reminder`.
  - `status`: `pending`, `sending`, `sent`, `failed`, `dead`, `dry_run`, `superseded`, `expired` or `no_email`.
  - Other columns: `signup_id`, `member_id`, `sequence`, `reminder_for`, `mode`, `attempts`, `next_attempt_at`, `claimed_at`, `email`, `resend_email_id` (unique), `error`, and timestamps.
  - Indexes:
    - at most one pending `update` or `cancel` per sign-up (merges repeated edits);
    - reminders unique on `(signup_id, reminder_for, mode)`;
    - a work-queue index.
- **`event_email_events`** and **`event_email_runs`**, with the same shapes as the dues tables.
- **`members.event_reminders_opt_out`**, a boolean defaulting to false.
- **Access:** RLS on. Grants go to `service_role` only, the same as `20260930120000_dues_notices.sql`.

**Queuing uses AFTER triggers.** The hardened functions in `20261002120300_volunteer_events_hardening.sql` stay untouched, and every write path is covered.
- **`event_signups` insert:** queues a `confirmation` only for a self sign-up (`member_id = kit.my_member_id()`). Officer walk-ins get no email.
- **`events` update:** fires on `WHEN status/location/starts_at/ends_at IS DISTINCT FROM`.
  - Cancelled queues `cancel`.
  - Restored, or a location change, queues `update`.
  - A "following" edit fans out one row per event, because `event_update` updates each event row.
- **`event_shifts` update** (time changed): queues an `update` for that shift's active sign-ups.
- **"Time changed" means the volunteer's shift window moved.** A date change moves the shifts, so it is caught. Editing only the event's own times without moving a shift sends nothing, because the calendar file would be identical.
- **`kit.enqueue_event_change(signup_ids, kind)` merges changes:**
  - one pending row per sign-up;
  - `cancel` wins over `update`;
  - `sequence` increases with each change;
  - nothing is queued while the sign-up's confirmation is still unsent, since that confirmation is built from current data.
- **Safety valve:** the setting `kit.suppress_event_emails = 'on'` turns the triggers off, for bulk data fixes.

**Functions** (service_role, using the `kit.*_at` pattern)
- **`event_emails_claim(mode, limit)`:**
  - expires stale rows (the shift has started, or the row is older than 72h);
  - takes pending rows, failed rows due for a retry (fewer than 3 attempts), and rows stuck in `sending` for over 10 minutes, using `FOR UPDATE SKIP LOCKED`;
  - marks a row `superseded` if its sign-up is no longer active (except `cancel`), or `no_email` if the member has no address;
  - otherwise stamps the mode;
  - returns the data needed to render each email.
- **`event_reminders_enqueue(mode)`:** finds shifts starting tomorrow (Chicago date), skipping members who opted out or have no email. Running it twice is safe.
- **`event_email_status(event_id)`:** returns the latest live email status per sign-up. Gated on `kit.can_take_attendance`.
- **`my_event_reminders()`** and **`set_my_event_reminders(opt_out)`:** read and change the caller's own member row only.

### Code
- **New shared package `packages/email` (`@kit/email`).** It takes out of `packages/features/dues-notices/src`:
  - `resend.ts`: the existing `sendBatch`, plus a new `sendEmail` with attachments, an `Idempotency-Key` of `event-email/<id>`, and retryable versus permanent errors;
  - `svix.ts`;
  - `escapeHtml`, `isPlausibleEmail`, `parseMode` and `siteUrlProblem`;
  - the tracking badge;
  - a generic webhook core with "sinks".

  `@kit/dues-notices` re-exports these from its old paths, so its tests and imports don't change.
- **New `packages/features/event-emails` (`@kit/event-emails`):**
  - `config.ts`;
  - `ics.ts`: UTC times; UID `signup-<id>@<host>`; `SEQUENCE`; `METHOD:PUBLISH`, or `CANCEL` with an organizer for cancellations; escaping, CRLF line endings and 75-octet line folding;
  - `templates.ts`: Chicago times via `packages/features/events/src/lib/format.ts`. Reminders link to My volunteering for the opt-out;
  - `server/dispatch.ts`: claims rows, sends calendar-file emails one at a time about 600ms apart within a time budget and reminders by batch, records each result, retries with backoff and never throws;
  - `server/job.ts`, a webhook sink and a status service.
- **Sending right away:** in `packages/features/events/src/server/events-actions.ts`, after `signupAction`, `updateEventAction` and `cancelEventAction` succeed, run `after(() => dispatchEventEmails(...))` from `next/server` with the admin client. The user's action never waits on email or fails because of it.
- **Daily job:** `apps/portal/app/api/jobs/event-emails/route.ts` uses the same bearer check as dues. It queues reminders, sends, then records a run.
- **Router:** `apps/router/src/scheduled.ts` gets a shared `runJobTrigger`. `scheduled()` calls both jobs from the existing `0 14 * * *` cron.
- **Webhook:** `apps/portal/app/api/webhooks/resend/route.ts` routes by tag. `event_email_id` goes to the events sink and `notice_id` to the dues sink, with a fallback lookup by `resend_email_id`. Unknown events return 200. The dues webhook tests must pass unchanged.
- **UI:**
  - My volunteering gets an "Email me a reminder the day before" switch.
  - The attendance panel shows a tracking badge per volunteer, such as "Confirmation · Delivered".
- **Config and docs:**
  - `compose.yaml`: `EVENT_EMAILS_MODE: dry-run`, plus a from address.
  - `apps/portal/.env.development`: commented examples.
  - `docs/runbook/hosting.md`: a new "Event emails" section covering rollout (off, then dry-run, then live) and the suppress setting.

### Process
Same as piece 1:
1. Write the spec at `docs/superpowers/specs/2026-10-03-event-emails-design.md`, from this plan.
2. Write the task plan at `docs/superpowers/plans/2026-10-03-event-emails.md`. Expected tasks:
   1. migration and pgTAP;
   2. extract `@kit/email`, keeping dues green;
   3. `@kit/event-emails`: ics, templates and config;
   4. dispatch, the job route and the router;
   5. webhook routing;
   6. action hooks, the opt-out switch and the tracking badge;
   7. E2E, docs and compose.
3. Execute subagent-driven on `feat/event-emails` from dev, with a review per task and a final review.

## Verification
- **pgTAP:**
  - a self sign-up queues one confirmation; a walk-in queues none;
  - title-only edits queue nothing;
  - a location or time change gives exactly one pending row per active sign-up, even after repeated edits;
  - a cancel beats an update, and a "following" cancel fans out only to later events;
  - reminders: running twice gives one row; dry-run then live gives two rows; opted-out members and members with no email are skipped; the Chicago "tomorrow" is right across a DST change;
  - claim sets `superseded`, `expired` and `no_email` correctly;
  - the opt-out function changes only the caller's own row;
  - permission refusals, and the suppress setting.
- **Vitest:**
  - `ics`: escaping, line folding, UTC times, PUBLISH versus CANCEL, a stable UID;
  - templates;
  - `sendEmail`: payload with attachments, the idempotency header, error classes;
  - dispatch with a fake fetch:
    - off and dry-run never call fetch;
    - live records each result;
    - a 429 is retried and a 400 is marked dead;
    - the time budget stops it;
  - webhook routing, including the existing dues tests;
  - the router fires both jobs.
- **Playwright:** against the dry-run stack, with no `RESEND_*` variables set and no real email sent:
  - a member signs up and the outbox row appears as `dry_run`;
  - an officer changes the location and exactly one `update` row is queued;
  - the job endpoint returns `skipped >= 1`;
  - the opt-out switch keeps its setting;
  - the attendance panel shows the badge.
- **Full suites:** pgTAP, `pnpm turbo run typecheck test:unit`, and `pnpm stack:up` followed by the events and email E2E specs.

## Risks
- **Rate limit:** Resend allows about 2 requests per second by default, so a big cancellation fan-out may finish on the next run. Retries and the daily cron cover that.
- **Calendar apps differ** in how they apply a PUBLISH or CANCEL update. The email text always states the change, so the calendar file is a convenience.
- **The webhook refactor could break dues tracking.** The dues tests run first and must stay unchanged.
- **Interrupted sends:** a redeploy could cut off work running after a response. Reclaiming rows stuck in `sending` for over 10 minutes, plus the idempotency key, covers it.
