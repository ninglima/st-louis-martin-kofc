/**
 * Event emails in dry-run, end to end: a self sign-up queues a confirmation
 * and a location change queues an update, both stamped `dry_run` by the
 * immediate dispatch; the jobs endpoint's bearer auth; the reminder switch;
 * and the lead's delivery badge. Run against `pnpm stack:up`, which sets
 * `EVENT_EMAILS_MODE: dry-run` and `DUES_JOBS_SECRET: local-jobs`
 * (`compose.yaml`); no `RESEND_*` variable is set, so nothing is ever sent.
 */
import { Browser, BrowserContext, Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { DuesPageObject } from '../dues/dues.po';
import {
  EventsPageObject,
  buildVolunteerRosterCsv,
  nextVolunteerNumbers,
  type VolunteerRosterPerson,
} from '../events/events.po';
import { RbacPageObject } from '../rbac/rbac.po';
import {
  outboxFor,
  postEventEmailsJob,
  signupIdFor,
  simulateLiveDelivered,
} from './event-emails.po';

function chicagoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

test.describe('Event emails (dry run)', () => {
  test.describe.configure({ mode: 'serial' });

  const contexts: BrowserContext[] = [];
  let officer: Page;
  let lead: Page;
  let volunteer: Page;
  let eventId: string;
  let signupId: string;
  let roster: VolunteerRosterPerson[];

  async function member(browser: Browser) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    return { page, email: await new AuthPageObject(page).signUpFlow('/home') };
  }

  async function waitForOutbox(
    predicate: (rows: Awaited<ReturnType<typeof outboxFor>>) => boolean,
  ) {
    await expect
      .poll(async () => predicate(await outboxFor(signupId)), {
        timeout: 10_000,
      })
      .toBe(true);
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    officer = await browser.newPage();
    const officerEmail = await new AuthPageObject(officer).signUpFlow('/home');
    await new RbacPageObject(officer).promoteToAdministrator(officerEmail);
    await officer.reload();

    roster = [];
    const pages: Page[] = [];
    for (const number of nextVolunteerNumbers(2)) {
      const { page, email } = await member(browser);
      pages.push(page);
      roster.push({
        number,
        email,
        firstName: 'Mailer',
        lastName: `Tester${number}`,
      });
    }
    [lead, volunteer] = pages as [Page, Page];

    const dues = new DuesPageObject(officer);
    await dues.goToImport();
    await dues.uploadAndConfirmRoster(buildVolunteerRosterCsv(roster));
  });

  test.afterAll(async () => {
    await officer.close();
    await Promise.all(contexts.map((c) => c.close()));
  });

  test('1. a sign-up queues a confirmation that the dispatch stamps dry_run', async () => {
    const tomorrow = chicagoDate(1);

    eventId = await new EventsPageObject(officer).createWeeklyEvent({
      title: `Mail ${roster[0]!.number}`,
      date: tomorrow,
      until: chicagoDate(15),
      weekday: new Date(`${tomorrow}T12:00:00Z`).getUTCDay(),
      capacity: 2,
      leadSearch: roster[0]!.lastName,
    });

    await volunteer.goto(`/home/events/${eventId}`);
    await volunteer.locator('[data-test^="shift-signup-"]').first().click();
    await expect(volunteer.getByText('You are signed up.')).toBeVisible();

    signupId = (await signupIdFor(eventId, roster[1]!.email))!;
    expect(signupId).toBeTruthy();

    await waitForOutbox((rows) =>
      rows.some((r) => r.kind === 'confirmation' && r.status === 'dry_run'),
    );
    const rows = await outboxFor(signupId);
    expect(rows.filter((r) => r.kind === 'confirmation')).toHaveLength(1);
  });

  test('2. a location change queues an update that reaches dry_run', async () => {
    await officer.goto(`/home/events/${eventId}/edit`);
    await officer.fill('[data-test="event-location"]', 'Council Hall, Room 2');
    await officer.click('[data-test="event-save"]');
    await officer.waitForURL(new RegExp(`/home/events/${eventId}$`));

    await waitForOutbox((rows) =>
      rows.some((r) => r.kind === 'update' && r.status === 'dry_run'),
    );
    const rows = await outboxFor(signupId);
    expect(rows.filter((r) => r.kind === 'update')).toHaveLength(1);
  });

  test('3. the jobs endpoint needs the bearer secret', async ({ request }) => {
    const ok = await postEventEmailsJob(request, 'local-jobs');
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toHaveProperty('skipped');

    const denied = await postEventEmailsJob(request, 'not-the-secret');
    expect(denied.status()).toBe(401);
  });

  test('4. turning reminders off sticks across a reload', async () => {
    await volunteer.goto('/home/volunteering');
    const toggle = volunteer.locator('[data-test="volunteering-reminders"]');
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await volunteer.reload();
    await expect(
      volunteer.locator('[data-test="volunteering-reminders"]'),
    ).not.toBeChecked();
  });

  test('5. the lead sees a delivery badge only for live emails', async () => {
    const badge = lead.locator(`[data-test="email-status-${signupId}"]`);

    await lead.goto(`/home/events/${eventId}`);
    await expect(lead.locator('[data-test="attendance-panel"]')).toBeVisible();
    await expect(badge).toHaveCount(0);

    await simulateLiveDelivered(signupId);
    await lead.reload();
    await expect(badge).toHaveText('Confirmation · Delivered');
  });
});
