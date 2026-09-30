/**
 * Volunteer events end to end: an officer creates a weekly event led by a
 * member; two members fill its two-person shift and a third is refused; once
 * the shift has started the lead takes attendance; the hours reach the
 * member's page and the officer's report. Run against `pnpm stack:up`.
 */
import { Browser, BrowserContext, Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { DuesPageObject } from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';
import {
  EventsPageObject,
  buildVolunteerRosterCsv,
  nextVolunteerNumbers,
  simulateShiftStarted,
  type VolunteerRosterPerson,
} from './events.po';

function chicagoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

test.describe('Volunteer events', () => {
  test.describe.configure({ mode: 'serial' });

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  let officer: Page;
  let eventId: string;
  // Populated in beforeAll: three "Volunteer Tester<number>" members, each
  // linked to one of `pages` in order (lead, second, third) -- see the
  // comment on `buildVolunteerRosterCsv` for why the roster is built from
  // already-signed-up accounts rather than `DuesPageObject.linkMemberToUser`.
  let roster: VolunteerRosterPerson[];

  async function member(browser: Browser) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    return { page, email: await new AuthPageObject(page).signUpFlow('/home') };
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    officer = await browser.newPage();
    const officerEmail = await new AuthPageObject(officer).signUpFlow('/home');
    await new RbacPageObject(officer).promoteToAdministrator(officerEmail);
    await officer.reload();

    roster = [];
    for (const number of nextVolunteerNumbers(3)) {
      const { email } = await member(browser);
      roster.push({
        number,
        email,
        firstName: 'Volunteer',
        lastName: `Tester${number}`,
      });
    }

    const dues = new DuesPageObject(officer);
    await dues.goToImport();
    await dues.uploadAndConfirmRoster(buildVolunteerRosterCsv(roster));
  });

  test.afterAll(async () => {
    await officer.close();
    await Promise.all(contexts.map((c) => c.close()));
  });

  test('1. an officer creates a weekly event with a two-person shift and a lead', async () => {
    const tomorrow = chicagoDate(1);
    const weekday = new Date(`${tomorrow}T12:00:00Z`).getUTCDay();

    eventId = await new EventsPageObject(officer).createWeeklyEvent({
      title: `Pantry ${roster[0]!.number}`,
      date: tomorrow,
      until: chicagoDate(15),
      weekday,
      capacity: 2,
      leadSearch: roster[0]!.lastName,
    });

    await expect(
      officer.getByText(`Lead: Volunteer ${roster[0]!.lastName}`),
    ).toBeVisible();
  });

  test('2. two members fill the shift and a third is refused', async () => {
    const [lead, second, third] = pages;
    const shift = (page: Page) =>
      page.locator('[data-test^="shift-signup-"]').first();

    for (const page of [lead!, second!]) {
      await page.goto(`/home/events/${eventId}`);
      await shift(page).click();
      await expect(page.getByText('You are signed up.')).toBeVisible();
    }

    await third!.goto(`/home/events/${eventId}`);
    await expect(third!.locator('[data-test^="shift-full-"]')).toBeVisible();
    await expect(third!.locator('[data-test="event-edit"]')).toHaveCount(0);
    await expect(third!.locator('[data-test="attendance-panel"]')).toHaveCount(
      0,
    );
  });

  test('3. once the shift starts, the lead takes attendance', async () => {
    // Simulate time passing: move this event's shift to have started 3 hours ago.
    await simulateShiftStarted(eventId, {
      startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      endsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    const lead = pages[0]!;
    await lead.goto(`/home/events/${eventId}`);
    const panel = lead.locator('[data-test="attendance-panel"]');
    await expect(panel).toBeVisible();

    const rows = panel
      .locator('li')
      .filter({ has: lead.locator('[data-test^="attendance-status-"]') });
    const leadRow = rows.filter({ hasText: roster[0]!.lastName });
    const secondRow = rows.filter({ hasText: roster[1]!.lastName });

    await leadRow.locator('[data-test^="attendance-hours-"]').fill('2.5');
    await leadRow.locator('[data-test^="attendance-save-"]').click();
    await expect(lead.getByText('Attendance saved.').first()).toBeVisible();

    await secondRow
      .locator('[data-test^="attendance-status-"]')
      .selectOption('no_show');
    await secondRow.locator('[data-test^="attendance-save-"]').click();
    await expect(secondRow).not.toContainText('Confirmed');

    await lead.goto('/home/volunteering');
    await expect(
      lead.locator('[data-test="volunteering-year-hours"]'),
    ).toContainText('2.5');
  });

  test('4. the report shows the hours; a plain member has no report', async () => {
    await officer.goto('/home/events/report');
    await expect(
      officer.locator('[data-test="report-by-member"]'),
    ).toContainText(roster[0]!.lastName);
    await expect(
      officer.locator('[data-test="report-by-member"]'),
    ).toContainText('2.5');

    const plain = pages[2]!;
    await plain.goto('/home/events/report');
    await expect(plain).not.toHaveURL(/\/home\/events\/report/);
  });
});
