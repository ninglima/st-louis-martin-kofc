# Volunteer Events — Design (piece 1: events core)

**Date:** 2026-09-29
**Status:** Draft for review

## Goal

Members find volunteer events on a calendar and sign up for shifts. The
council gets volunteer hours it can trust, for recognising members and for
reporting to Supreme (totals by program category and fraternal year).

This is piece 1 of 3:

1. **Events core** (this spec): event types, events and shifts,
   recurrence, sign-ups, attendance and hours, the member dashboard and the
   officer report.
2. **Event emails** (later spec): sign-up confirmation with an `.ics`
   file, the day-before reminder, and change and cancel notices. These
   reuse Resend and the daily cron from dues notices.
3. **Public calendar** (later spec): the site's Master Calendar page,
   showing events flagged public.

## Decisions

| Decision | Choice |
| --- | --- |
| Hours purpose | Both recognition and reporting to Supreme |
| Recording | Signing up pre-fills hours. The event lead or an officer confirms attendance, and only confirmed hours count |
| Staffing | Events have one or more shifts, each with a number of volunteer slots |
| Recurrence | A repeat rule creates real, separately editable event rows up to an end date |
| Access | New `events` section (`view`: calendar and sign-up; `manage`: create and edit, types, report), plus a per-event lead who takes attendance for that event only |
| Public calendar | An opt-in `is_public` flag per event, stored now and used in piece 3 |
| Volunteers | Members with a linked portal sign-in only |
| Calendar UI | Built with existing components and `date-fns`; month grid and Upcoming list. No calendar library |
| Logic location | Postgres `security definer` functions, as for dues |

## Definitions

- **Today:** `kit.council_today()` (America/Chicago). All event times are stored as `timestamptz` and displayed in America/Chicago.
- **Fraternal year `Y`:** `[Y-07-01, (Y+1)-07-01)`, using the existing `kit.fraternal_year_of`, judged on the shift's start date in Chicago time.
- **Caller's member:** the `members` row whose `user_id = auth.uid()`.
- **Event lead:** the member named in `events.lead_member_id`. A caller is the lead when that member's `user_id = auth.uid()`.
- **Can take attendance:** holds `events.manage`, or is the event's lead.
- **Confirmed hours:** the sum of `hours` over sign-ups with status `attended` on events with status `scheduled`.

## Data

One migration adds the `events` section and these tables. All tables have RLS enabled, with `select` for `authenticated` gated on `events.view`, and no direct writes. Writes go through the functions below.

### Permission section

- `events`, with verbs `view` and `manage`. It is added to `SECTIONS` in `packages/features/rbac/src/types/sections.ts`.
- **Label:** "Volunteer Events".
- **Description:** "View: the event calendar; sign up for shifts. Manage: create, edit and cancel events; manage event types; confirm any attendance; the hours report".
- **Seeded grants:**
  - `administrator` gets view and manage;
  - `member` gets view.

### `public.event_types`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `name` | unique, not blank |
| `category` | `faith`, `family`, `community` or `life` (enum `public.program_category`) |
| `description` | optional |
| `active` | boolean, default true |

Seeded rows:

| Name | Category |
| --- | --- |
| Food Pantry | community |
| Handy Man Services | community |
| Honor Flights | community |
| Breakfast with Knights | family |
| Foster Children Support | family |
| Right to Life | life |

### `public.event_series`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `rule` | `jsonb` (see Recurrence) |
| `created_by` | `auth.users` |
| `created_at` | timestamp |

### `public.events`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `series_id` | the series, if created by one (nullable, `on delete set null`) |
| `type_id` | the event type |
| `title` | not blank, max 200 |
| `description` | optional, max 5000 |
| `location` | optional, max 300 |
| `starts_at`, `ends_at` | `ends_at > starts_at` |
| `lead_member_id` | the lead (nullable) |
| `is_public` | boolean, default false |
| `status` | `scheduled` or `cancelled` |
| `created_by`, `created_at`, `updated_at` | audit columns |

### `public.event_shifts`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `event_id` | `on delete cascade` |
| `starts_at`, `ends_at` | `ends_at > starts_at`; within 24 hours |
| `capacity` | 1 to 200 |
| `label` | optional, max 100 |

### `public.event_signups`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `shift_id` | the shift |
| `member_id` | the member |
| `status` | `signed_up`, `cancelled`, `attended` or `no_show` |
| `hours` | `numeric(4,2)`, null unless `attended`; 0 to 24 in 0.25 steps |
| `added_by` | who signed them up (the member or an officer) |
| `created_at` | timestamp |
| `cancelled_at` | timestamp |
| `confirmed_by` | `auth.users` |
| `confirmed_at` | timestamp |

A partial unique index on `(shift_id, member_id) where status <> 'cancelled'` allows one active sign-up per member per shift.

## Rules

### Signing up

`public.event_signup(p_shift_id)` enforces these:

- The caller needs `events.view` and a linked member (message: `Your sign-in is not linked to a council member record.`).
- The event must be `scheduled`, and the shift must start after `now()`.
- It locks the shift row, then counts active sign-ups (`signed_up` or `attended`). If the count has reached `capacity`, it refuses with `This shift is full.`
- It refuses a second active sign-up by the same member (`You are already signed up for this shift.`).

### Cancelling

`public.event_cancel_signup(p_signup_id)`:

- A member may cancel only their own sign-up, while its status is `signed_up` and the shift has not started.
- A caller who can take attendance may cancel any `signed_up` sign-up on that event at any time.

### Walk-ins

`public.event_add_volunteer(p_shift_id, p_member_id)`:

- Requires the ability to take attendance on that event.
- Ignores capacity and start time, and still refuses a duplicate.

### Attendance

`public.event_set_attendance(p_signup_id, p_status, p_hours)`:

- Requires the ability to take attendance, and the shift must have started.
- `p_status` must be `attended` or `no_show`.
  - `attended` sets `hours` to `p_hours`, or to the shift's length in hours rounded to 0.25 when `p_hours` is null.
  - `no_show` sets `hours` to null.
- It can be called again to correct a record.

### Events

- **Cancelling:** `events.status = 'cancelled'`. The sign-ups stay but count for nothing.
- **Deleting shifts:** a shift with any non-cancelled sign-up cannot be deleted.
- **Editing times:** shifts on an event can be edited freely. Hours already confirmed are not recalculated.

### Recurrence

The rule is `{ "freq": "weekly" | "monthly", ... }`.

| Field | Contents |
| --- | --- |
| `weekly` | `interval` (1–4) and `weekdays` (non-empty set of 0–6, Sunday = 0) |
| `monthly` | `weekday` (0–6) and `nth` (1–4, or −1 for the last) |
| `start_date` | the first date |
| `until` | a date, from `start_date` to `start_date + 1 year` |

- **Dates come from one function:** `kit.series_dates(rule jsonb) returns setof date`. It is the single source of dates, used both to create the series and for the preview.
- **Creating a series:** the event's time of day and its shift pattern (offsets from the event start) are copied onto each date, in America/Chicago local time, so DST is honoured.
- **Editing the series:** `public.event_update(p_event_id, p_fields, p_scope)`, with `p_scope` set to `this` or `following`.
  - `following` applies `type_id`, `title`, `description`, `location`, `lead_member_id` and `is_public` to this event and every later event in the same series.
  - `status = 'cancelled'` with `following` cancels this and every later event.
  - `following` never changes times or shifts.

## Functions

Every function is `security definer` with `search_path = ''`, is revoked from `public` and `anon`, and is granted to `authenticated`. Each checks its own permission.

| Function | Gate | Purpose |
| --- | --- | --- |
| `event_types_save(p jsonb)` | manage | Create or update a type |
| `event_create(p jsonb)` | manage | Creates an event and its shifts, or a series when `p.repeat` is present. Returns the ids created |
| `event_update(p_event_id, p_fields jsonb, p_scope text)` | manage | See Recurrence |
| `event_shifts_save(p_event_id, p_shifts jsonb)` | manage | Upsert and delete shifts, following the deletion rule |
| `event_series_preview(p_rule jsonb)` | manage | The dates a rule would create |
| `events_in_range(p_from date, p_to date, p_type_id uuid)` | view | Calendar rows: event, type, category, status, and total capacity and filled count across its shifts |
| `event_detail(p_event_id)` | view | Event, shifts, and each shift's volunteers (member name and status). Hours are included only for callers who can take attendance, and for the caller's own sign-ups |
| `event_signup`, `event_cancel_signup`, `event_add_volunteer`, `event_set_attendance` | see Rules | |
| `my_volunteering()` | a linked member | Hours this fraternal year and all-time, this year by category, upcoming sign-ups, and past sign-ups |
| `volunteer_report(p_year int)` | manage | Totals, rows by category, by type and by member, and "attendance not taken" rows |

- **Report year:** `p_year` must be from 2000 to the current fraternal year + 1, or the function raises `P0001`.
- **Attendance not taken:** shifts that have ended and still have `signed_up` sign-ups, on scheduled events, listed with the event, the shift and the lead's name.

## Pages and UI

Code lives in a new `@kit/events` package, following `@kit/finance` and `@kit/members`: a service, server actions returning `{ success, error }`, components, and pure helpers in `lib/`.

### Sidebar

- **Events:** requires `events.view`.
- **My volunteering:** shown to any signed-in user with a linked member record.

### Pages

- **`/home/events`**
  - A month grid with `?month=YYYY-MM` and an **Upcoming** list with `?view=list`. On narrow screens the list is the default.
  - Each day shows its events: title, time, and "filled of capacity". Cancelled events are struck through.
  - A type filter (`?type=`).
  - Managers get **New event** and **Event types** buttons, and a **Report** link.
- **`/home/events/<id>`**
  - The details, the lead, and the shifts with their volunteers.
  - A **Sign up** or **Cancel my sign-up** button per shift, disabled when the shift is full or has started.
  - An **Attendance** panel for anyone who can take attendance: per sign-up, Attended or No-show with an hours field, plus **Add volunteer** (a member search).
  - For managers, **Edit** and **Cancel event**. For a series, these ask "This event" or "This and all later events".
- **`/home/events/new` and `/home/events/<id>/edit`**
  - The fields: type, title, description, location, date, lead (a member search), and the public switch.
  - Shift rows: start, end, volunteers needed and label. A new event starts with one shift matching the event times.
  - **Repeat** (new only): none, weekly (interval and weekdays) or monthly (nth weekday), with an end date and a live preview ("Creates 26 events, Oct 3 – Mar 27") from `event_series_preview`.
- **`/home/events/types`:** list, add, edit, deactivate, and set the category.
- **`/home/events/report`**
  - A fraternal year picker.
  - Totals: hours, volunteers and events held.
  - Tables by category, by type and by member, with **Export CSV** by member.
  - The attendance-not-taken list.
- **`/home/volunteering`**
  - Hours this year and all-time, with a category breakdown.
  - Upcoming shifts, with Cancel.
  - History: event, date, status and hours.
- **Member home:** a card showing this year's hours and the next shift, linking to My volunteering. It is hidden when the viewer has no linked member.

**Graceful absence:** before the migration runs, the events pages show "Not available yet" and the member-home card is hidden, using the `readDuesIfDeployed` pattern.

## Testing

- **pgTAP**
  - Every function is refused without its permission.
  - Signing up:
    - a full shift is refused;
    - concurrent sign-ups for the last slot are serialised by the row lock;
    - a duplicate is refused;
    - a past shift is refused;
    - a cancelled event is refused;
    - an unlinked user is refused.
  - Cancelling: refused after the shift starts for a member; allowed for a lead.
  - Attendance:
    - a lead can take it only on their own event;
    - it is refused before the shift starts;
    - default hours are the shift length rounded to 0.25;
    - `no_show` clears the hours.
  - Walk-ins can exceed capacity.
  - Hours count only `attended` on `scheduled` events.
  - `kit.series_dates`:
    - weekly every 2 weeks on Tuesday and Thursday;
    - the monthly 2nd Saturday and the last Saturday;
    - `until` beyond one year is refused;
    - a DST boundary keeps the local start time.
  - `event_update` with `following` touches only later events of the same series and never times.
  - Shift deletion is refused while it has sign-ups.
  - `volunteer_report` totals by category, type and member agree, and the attendance-not-taken rows are right.
  - Parameter validation.
- **Vitest**
  - The month-grid builder: a month starting on Saturday, 6-week months, and today's marker.
  - Month and view query parsing.
  - The event form schema: shift rows and repeat options.
  - The report CSV.
  - The actions' error mapping.
- **Playwright**
  - An officer creates a weekly event with one two-person shift.
  - Two members sign up, and a third is refused as full.
  - The lead (a member set as lead) marks one Attended with 2.5 hours and one No-show.
  - That member's My volunteering shows 2.5 hours.
  - The report shows the total.
  - A plain member sees no Edit, Attendance or Report controls.

## Out of scope (piece 1)

- Emails and reminders (piece 2); the public calendar page (piece 3)
- Non-member volunteers; named roles within shifts; waitlists
- Self-reported or "other service" hours
- Changing times across a whole series
- Week and day calendar views; drag-to-reschedule
