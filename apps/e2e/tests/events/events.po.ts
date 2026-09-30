import { Page, expect } from '@playwright/test';

import postgres from 'postgres';

import { HEADER, escapeCsv } from '../dues/dues.po';

/**
 * The local Supabase database (`supabase start`) -- same default and same
 * `E2E_DATABASE_URL` override as `utils/cleanup.ts`.
 */
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export interface VolunteerRosterPerson {
  number: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Membership numbers 9_999_000-9_999_899, clear of the dues
 * (9_950_000-9_998_999) and members (up to 9_900_008) fixtures.
 */
export function nextVolunteerNumbers(count: number): string[] {
  const base = 9_999_000 + (Date.now() % 300) * 3;
  return Array.from({ length: count }, (_, i) => String(base + i));
}

/**
 * A roster CSV that links each given person's email to a fresh member row.
 *
 * The email must already belong to a signed-up, email-confirmed account
 * (`AuthPageObject.signUpFlow`) -- not a synthetic address. `applyChunk`
 * (`packages/features/members/src/server/roster-import.service.ts`) always
 * brings an account for a `create` row, via `ensureAuthUser`: when the
 * address is already registered it does not error or create a duplicate, it
 * looks the existing account up and reuses its id (see the comment on
 * `ensureAuthUser`), so `member_upsert_from_roster` inserts the new member
 * row with `user_id` already pointing at that account. This is the supported
 * path for "a member who already has a portal sign-in shows up in the next
 * roster import" and it is the only way to end up with a member linked to an
 * account whose password the test actually knows: `public.members` grants
 * `service_role` `select` only (`20260922221437_members_fixes.sql`), so a
 * direct REST `PATCH` -- the approach `DuesPageObject.linkMemberToUser`
 * takes -- gets `42501 permission denied for table members`. That helper is
 * only ever exercised by the `E2E_STRIPE`-gated scenario 4 in
 * `dues.spec.ts`, which is why this was never caught there.
 */
export function buildVolunteerRosterCsv(people: VolunteerRosterPerson[]) {
  const rows = people.map((p) =>
    HEADER.map((_, index) => {
      switch (index) {
        case 0:
          return p.number;
        case 2:
          return p.firstName;
        case 4:
          return p.lastName;
        case 7:
          return 'Member';
        case 24:
          return p.email;
        default:
          return '';
      }
    }),
  );

  const csv = [HEADER, ...rows]
    .map((r) => r.map(escapeCsv).join(','))
    .join('\r\n');

  const first = people[0]!;

  return {
    filename: `volunteer-roster-${first.number}.csv`,
    buffer: Buffer.from(csv, 'utf8'),
    membershipNumber: first.number,
    fullName: `${first.firstName} ${first.lastName}`,
    email: first.email,
  };
}

/**
 * Moves every shift of an event to the given window, via a direct Postgres
 * connection -- like `cleanUpE2EData` (`utils/cleanup.ts`), not PostgREST.
 * `public.event_shifts` grants `service_role` neither `select` nor `update`
 * (`information_schema.role_table_grants` shows only `references`,
 * `trigger`, `truncate` -- every real write goes through the SECURITY
 * DEFINER RPCs in `20261002120100_volunteer_events_manage.sql`), so a
 * PostgREST `PATCH` with the service-role key -- the approach this test
 * originally took -- gets a bare `403` with zero rows touched. There is no
 * product RPC for moving a shift's time, rightly: nothing legitimate ever
 * needs one. This is test-only, same as the direct connection the global
 * teardown already uses to reach tables it has no business writing through
 * the API either.
 */
export async function simulateShiftStarted(
  eventId: string,
  params: { startsAt: string; endsAt: string },
): Promise<void> {
  const { hostname } = new URL(DATABASE_URL);

  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(
      `simulateShiftStarted refuses a non-local database (${hostname})`,
    );
  }

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    await sql`
      update public.event_shifts
      set starts_at = ${params.startsAt}, ends_at = ${params.endsAt}
      where event_id = ${eventId}`;
  } finally {
    await sql.end();
  }
}

export class EventsPageObject {
  constructor(readonly page: Page) {}

  goToEvents(query = '') {
    return this.page.goto(`/home/events${query}`);
  }

  async createWeeklyEvent(params: {
    title: string;
    date: string;
    until: string;
    weekday: number;
    capacity: number;
    leadSearch: string;
  }) {
    await this.page.goto('/home/events/new');
    await this.page.fill('[data-test="event-title"]', params.title);
    await this.page.fill('[data-test="event-date"]', params.date);
    await this.page.fill(
      '[data-test="shift-row-0-capacity"]',
      String(params.capacity),
    );
    await this.page.fill('[data-test="event-lead"]', params.leadSearch);
    // Scoped to the picker's `role="listbox"` results (member-picker.tsx):
    // an unscoped `getByRole('option')` also matches the native `<select>`
    // elements on this form (e.g. "Event type"), whose `<option>`s carry the
    // same implicit ARIA role and sit earlier in the DOM, so `.first()`
    // would resolve to one of those instead.
    await this.page.getByRole('listbox').getByRole('option').first().click();
    await this.page.selectOption('[data-test="repeat-freq"]', 'weekly');
    await this.page.click(`[data-test="repeat-weekday-${params.weekday}"]`);
    await this.page.fill('[data-test="repeat-until"]', params.until);
    await expect(
      this.page.locator('[data-test="repeat-preview"]'),
    ).toContainText('Creates');
    await this.page.click('[data-test="event-save"]');
    await this.page.waitForURL(/\/home\/events\/[0-9a-f-]{36}$/);

    return this.page.url().split('/').pop()!;
  }
}
