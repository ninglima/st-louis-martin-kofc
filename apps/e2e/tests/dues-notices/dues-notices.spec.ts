/**
 * The daily dues notices job in dry-run mode, end to end against a real
 * database and through the router: the job endpoint's own bearer-secret
 * auth (Task 3), a dry run's effect on every UI surface that reads it --
 * the `/home/dues-notices` page (Task 5), the Overview follow-up list's
 * Last notice column (also Task 5, read through `@kit/finance`), and the
 * member page's notices card (Task 5) -- and the `finance.view` RBAC gate
 * applied to the new page (Task 1).
 *
 * TO RUN IT:
 *
 *   1. Start Docker.
 *   2. pnpm supabase:web:start
 *   3. pnpm stack:up
 *   4. pnpm --filter web-e2e exec playwright test tests/dues-notices
 *   5. pnpm stack:down
 *
 * The local stack runs the portal with `DUES_NOTICES_MODE: dry-run` and
 * `DUES_JOBS_SECRET: local-jobs` (`compose.yaml`) -- a dry run never calls
 * `sendBatch` (`runDuesNoticesJob` returns before it for `dry_run`), so this
 * suite never reaches `api.resend.com`, and no `RESEND_*` variable is set
 * anywhere in its setup.
 *
 * The local database is long-lived across runs, so scenario 2 seeds a
 * member with a unique membership number and email every run
 * (`buildOneRowRosterFixture`), and every assertion below is scoped to that
 * member's own name or id -- never a bare row count on a table that other
 * suites, and earlier runs of this same suite, also write to. Other members
 * left behind by earlier runs can freely fall inside today's notice windows
 * too, which is exactly why scenario 2 only asserts `candidates >= 1`
 * rather than `=== 1`.
 */
import { Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import {
  DuesPageObject,
  buildOneRowRosterFixture,
  chicagoToday,
} from '../dues/dues.po';
import { FinancePageObject } from '../finance/finance.po';
import { RbacPageObject } from '../rbac/rbac.po';
import { DuesNoticesPageObject, postDuesNoticesJob } from './dues-notices.po';

test.describe('Dues notices (dry run)', () => {
  // Serial: scenario 3 reruns the job against the very member scenario 2
  // seeds and expects no second row for them.
  test.describe.configure({ mode: 'serial' });

  let officerPage: Page;
  let officerAuth: AuthPageObject;
  let officerRbac: RbacPageObject;
  let officerDues: DuesPageObject;
  let officerFinance: FinancePageObject;
  let officerNotices: DuesNoticesPageObject;

  // Set by scenario 2, read by scenario 3.
  let memberName: string;
  let memberId: string;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    officerAuth = new AuthPageObject(officerPage);
    officerRbac = new RbacPageObject(officerPage);
    officerDues = new DuesPageObject(officerPage);
    officerFinance = new FinancePageObject(officerPage);
    officerNotices = new DuesNoticesPageObject(officerPage);

    // Fresh database => zero administrators -- see the doc comment on
    // `RbacPageObject.promoteToAdministrator` for why this goes straight to
    // the service-role key rather than through the UI.
    const officerEmail = await officerAuth.signUpFlow('/home');
    await officerRbac.promoteToAdministrator(officerEmail);

    // Permissions are read fresh from the database on every server render,
    // so a reload is enough to pick the promotion up.
    await officerPage.reload();
  });

  test.afterAll(async () => {
    await officerPage.close();
  });

  test('1. the job refuses a wrong secret', async ({ request }) => {
    const res = await postDuesNoticesJob(request, 'nope');

    expect(res.status()).toBe(401);
  });

  test('2. a dry run records a due-date notice that shows everywhere', async ({
    request,
  }) => {
    // The roster confirm step creates a GoTrue account via the admin API,
    // same allowance `dues.spec.ts` scenario 1 gives it.
    test.setTimeout(90_000);

    const fixture = buildOneRowRosterFixture();
    memberName = fixture.fullName;

    await officerDues.goToImport();
    await officerDues.uploadAndConfirmRoster(fixture);
    memberId = await officerDues.openMember(fixture.membershipNumber);

    // accepted_on = today, nothing paid, no paid_through -> cycle date is
    // today itself, which is `due` and lands inside the `due_date` window
    // (`c` … `c+7`, global-constraints.md) on the very day it is set.
    const today = chicagoToday();
    await officerDues.setAcceptedOn(today);
    await expect(officerDues.duesStatus()).toHaveText('Due');

    const res = await postDuesNoticesJob(request, 'local-jobs');
    expect(res.status()).toBe(200);

    const body = (await res.json()) as { mode: string; candidates: number };
    expect(body.mode).toBe('dry_run');
    expect(body.candidates).toBeGreaterThanOrEqual(1);

    await officerNotices.goTo();
    await expect(officerNotices.statusCard()).toContainText('Dry run');

    const row = officerNotices.rowsForMember(memberName);
    await expect(row).toHaveCount(1);
    await expect(officerNotices.trackingBadge(row)).toHaveText('Dry run');

    await officerFinance.goToHome('tab=overview');

    const followUpRow = officerNotices.followUpRow(memberName);
    await expect(followUpRow).toHaveCount(1);
    await expect(officerNotices.lastNoticeCell(followUpRow)).toContainText(
      'Due date',
    );

    await officerPage.goto(`/home/members/${memberId}`);
    await expect(officerNotices.memberNoticeItems()).toHaveCount(1);
    await expect(officerNotices.memberNoticesOptOut()).toBeVisible();
  });

  test('3. a second run the same day adds nothing for that member', async ({
    request,
  }) => {
    const res = await postDuesNoticesJob(request, 'local-jobs');
    expect(res.status()).toBe(200);

    await officerNotices.goTo();
    await expect(officerNotices.rowsForMember(memberName)).toHaveCount(1);

    await officerNotices.goTo('kind=due_date');
    await expect(officerNotices.rowsForMember(memberName)).toHaveCount(1);
  });

  test("4. a member without finance access can't open the page", async ({
    browser,
  }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const memberAuth = new AuthPageObject(memberPage);
    const memberRbac = new RbacPageObject(memberPage);

    try {
      // A plain signup lands on the `member` role, which grants no
      // `finance` section at all -- same starting point as
      // `finance.spec.ts` scenario 3 and `dues.spec.ts` scenario 3.
      await memberAuth.signUpFlow('/home');

      await memberPage.goto('/home/dues-notices');
      await memberPage.waitForURL('**/home');
      expect(memberPage.url()).not.toContain('/dues-notices');

      await memberRbac.expectSidebarToHide(['Dues notices']);
    } finally {
      await memberContext.close();
    }
  });
});
