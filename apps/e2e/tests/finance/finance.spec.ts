/**
 * The financial dashboard and hosting-cost bookkeeping, end to end, against
 * a real database: an administrator books a hosting bill and watches the
 * `/home` dashboard move (Task 3's hosting-costs screen, Task 4's dashboard
 * figures), "Repeat last bill" adds the next period off whatever bill is
 * actually latest on file, and a member without `finance.view` gets the
 * plain member home instead (Task 5's gate, read through Task 1's RBAC).
 *
 * TO RUN IT:
 *
 *   1. Start Docker.
 *   2. pnpm supabase:web:start
 *   3. pnpm stack:up
 *   4. pnpm --filter web-e2e exec playwright test tests/finance
 *   5. pnpm stack:down
 *
 * The local database is long-lived across runs, and this suite books real
 * hosting-cost rows into it every time it runs -- scenario 1 uses a fixed,
 * distinctive amount ($25.00) precisely so a rerun's rows are recognisable
 * next to whatever earlier runs left behind, and every count this file
 * takes is a before/after delta rather than an assumption that a table
 * starts empty.
 */
import { Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import {
  DuesPageObject,
  addDaysIso,
  buildOneRowRosterFixture,
  chicagoToday,
} from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';
import { FinancePageObject } from './finance.po';

/**
 * Fraternal year Y runs July 1 of Y to June 30 of Y+1. Duplicated from
 * `packages/features/finance/src/lib/fraternal-year.ts` (`fraternalYearOf`)
 * for the same reason `dues.po.ts` duplicates `addDaysIso`/`chicagoToday`:
 * this test computes its own expectation of which fraternal year a date
 * falls in, independently of the code it is checking.
 */
function fraternalYearOf(isoDate: string): number {
  const [year, month] = isoDate.split('-').map(Number) as [number, number];

  return month < 7 ? year - 1 : year;
}

/**
 * Mirrors `fraternalYearLabel` in the same file, character for character
 * (including the en dash "–", not a hyphen) -- needed to pick the right
 * `year-picker` option by its visible text.
 */
function fraternalYearLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

test.describe('finance', () => {
  // Serial: scenario 2 repeats a bill off whatever "Supabase" row is
  // latest, which scenario 1 may have just added, and both share the same
  // signed-in administrator page/session as scenario 3's default-member
  // fixture is set up independently.
  test.describe.configure({ mode: 'serial' });

  let officerPage: Page;
  let officerAuth: AuthPageObject;
  let officerRbac: RbacPageObject;
  let officerFinance: FinancePageObject;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    officerAuth = new AuthPageObject(officerPage);
    officerRbac = new RbacPageObject(officerPage);
    officerFinance = new FinancePageObject(officerPage);

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

  test('1. an administrator adds a hosting bill and the dashboard moves', async () => {
    test.skip(
      process.env.NEXT_PUBLIC_ENABLE_HOSTING_COSTS !== 'true',
      'hosting costs are disabled',
    );

    const today = chicagoToday();

    await officerFinance.goToDashboard();
    const hostingBefore = await officerFinance.hostingToDateDollars();

    await officerFinance.goToHostingCosts();

    // A fixed, distinctive amount so this run's row is recognisable next to
    // whatever a previous run of this same spec already left in the table.
    const rowsWith25Before = await officerFinance
      .hostingCostRows()
      .filter({ hasText: '$25.00' })
      .count();

    await officerFinance.addHostingCost({
      providerName: 'Supabase',
      amount: '25.00',
      paidOn: today,
      coversFrom: addDaysIso(today, -5),
      coversTo: today,
    });

    // The dialog's own submit can round-trip fast enough that the toast
    // fires twice for a single logical save (see `finance.po.ts`'s doc
    // comment on `addHostingCost`) -- `.first()` keeps this from tripping
    // strict mode if that happens, without weakening what it actually
    // checks: the exact text `HostingCostFormDialog` uses on success.
    await expect(
      officerPage.getByText('Hosting cost saved').first(),
    ).toBeVisible();

    await expect(
      officerFinance.hostingCostRows().filter({ hasText: '$25.00' }),
    ).toHaveCount(rowsWith25Before + 1);

    await officerFinance.goToDashboard();
    const hostingAfter = await officerFinance.hostingToDateDollars();

    expect(hostingAfter).toBeGreaterThan(hostingBefore);
  });

  test('2. repeat last bill adds the next period', async () => {
    test.skip(
      process.env.NEXT_PUBLIC_ENABLE_HOSTING_COSTS !== 'true',
      'hosting costs are disabled',
    );

    await officerFinance.goToHostingCosts();

    const currentYear = fraternalYearOf(chicagoToday());
    const nextYear = currentYear + 1;
    const rowsBefore = await officerFinance.hostingCostRows().count();

    // The repeated period can only land in the current fraternal year or
    // the next one -- it advances the latest bill by that bill's own
    // length (a few days at most; see the file header), never further. The
    // year picker always offers `nextYear` (`yearOptions`), so its own
    // before-count is captured up front, in case the new period lands
    // there -- read before triggering the repeat below, since that action
    // is what changes the count.
    await officerFinance.selectYear(fraternalYearLabel(nextYear));
    const rowsInNextYearBefore = await officerFinance.hostingCostRows().count();
    await officerFinance.selectYear(fraternalYearLabel(currentYear));

    // "Repeat last bill" is keyed off whatever the provider's actual latest
    // bill is -- which may be scenario 1's row above, or a later-dated row
    // left behind by an earlier run of this same spec (see the file
    // header). Either way, the preview names the new period, and that is
    // read back rather than assumed.
    const newPeriodStart = await officerFinance.repeatLastBill('supabase');

    await expect(
      officerPage.getByText('Hosting cost saved').first(),
    ).toBeVisible();

    const newYear = fraternalYearOf(newPeriodStart);

    if (newYear === nextYear) {
      // The new period crossed into the next fraternal year -- switch the
      // year picker before counting, since the current year's row count
      // has nothing to do with the next year's table.
      await officerFinance.selectYear(fraternalYearLabel(nextYear));
      await expect(officerFinance.hostingCostRows()).toHaveCount(
        rowsInNextYearBefore + 1,
      );
    } else {
      await expect(officerFinance.hostingCostRows()).toHaveCount(
        rowsBefore + 1,
      );
    }
  });

  test('3. a member without finance access gets the member home', async ({
    browser,
  }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const memberAuth = new AuthPageObject(memberPage);
    const memberFinance = new FinancePageObject(memberPage);
    const memberRbac = new RbacPageObject(memberPage);

    try {
      // A plain signup lands on the `member` role, which
      // 20260922033217_rbac.sql grants no `finance` section at all -- same
      // starting point as `dues.spec.ts` scenario 3 and `members.spec.ts`
      // scenario 1's plain member.
      await memberAuth.signUpFlow('/home');

      await memberFinance.goToHome();

      await expect(
        memberPage.locator('[data-test="member-home"]'),
      ).toBeVisible();
      await expect(
        memberPage.locator('[data-test="finance-dashboard"]'),
      ).toHaveCount(0);
      await expect(
        memberPage.locator('[data-test="dashboard-tabs"]'),
      ).toHaveCount(0);

      // The link being absent is cosmetic. The redirect below is the part
      // that distinguishes a hidden door from a locked one -- same
      // reasoning as `members.spec.ts` scenario 1.
      await memberRbac.expectSidebarToHide(['Hosting costs', 'Dashboard']);

      await memberFinance.goToDashboard();

      await memberPage.waitForURL('**/home');
      expect(memberPage.url()).not.toContain('/dashboard');
      await expect(
        memberPage.locator('[data-test="finance-dashboard"]'),
      ).toHaveCount(0);

      await memberFinance.goToHostingCosts();

      await memberPage.waitForURL('**/home');
      expect(memberPage.url()).not.toContain('/hosting-costs');
      await expect(
        memberPage.locator('[data-test="hosting-costs-table"]'),
      ).toHaveCount(0);
    } finally {
      await memberContext.close();
    }
  });

  test('4. an administrator can open every dashboard tab', async () => {
    // Reuses the officer session `beforeAll` already signed up and
    // promoted -- the same administrator scenario 1 acts as, without
    // signing in again.

    // The roster import + GoTrue account creation below can be slow -- same
    // allowance `dues.spec.ts` scenario 1 gives it.
    test.setTimeout(90_000);

    // `ForecastChart`'s month `<select>` only renders once at least one of
    // the next 12 months has a member coming due -- and the persistent
    // local DB may have none: `dues.spec.ts`'s own fixture ends up voided
    // back to "Due" by its scenario 2, so it never counts as a forecasted
    // renewal. Importing one roster row here and backdating its
    // `accepted_on` so the resulting period's end lands a couple of months
    // out guarantees a renewal inside the forecast window on every run,
    // independent of whatever other specs left behind.
    const officerDues = new DuesPageObject(officerPage);
    const forecastFixture = buildOneRowRosterFixture();

    await officerDues.goToImport();
    await officerDues.uploadAndConfirmRoster(forecastFixture);
    await officerDues.openMember(forecastFixture.membershipNumber);

    // Backdated far enough that the resulting period's end (accepted_on +
    // 365 days) is more than 90 days out -- inside `due_soon`'s window
    // (`kit.dues_status_at`, `<= p_today + 90`) would leave the status
    // "Due soon" instead, which is beside the point here.
    const today = chicagoToday();
    await officerDues.setAcceptedOn(addDaysIso(today, -265));
    await officerDues.recordCheckPayment({
      levelOptionName: 'Regular — $50.00',
      checkNumber: 'E2E-forecast',
    });
    await expect(officerDues.duesStatus()).toHaveText('Current');

    await officerFinance.goToDashboard();

    await expect(
      officerPage.locator('[data-test="dashboard-tab-overview"]'),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      officerPage.locator('[data-test="finance-dues-collected"]'),
    ).toBeVisible();

    await officerPage.click('[data-test="dashboard-tab-collection"]');
    await expect(
      officerPage.locator('[data-test="collection-progress"]'),
    ).toBeVisible();
    await expect(
      officerPage.locator('[data-test="collection-running-total"]'),
    ).toBeVisible();
    await expect(
      officerPage.locator('[data-test="collection-forecast"]'),
    ).toBeVisible();

    await officerFinance.selectFirstForecastMonth();
    await expect(officerPage).toHaveURL(/month=/);
    await expect(
      officerPage.locator('[data-test="collection-forecast-members"]'),
    ).toBeVisible();

    await officerPage.click('[data-test="dashboard-tab-lapses"]');
    for (const bucket of ['1-30', '31-90', '91-180', '181+']) {
      await expect(
        officerPage.locator(`[data-test="lapses-bucket-${bucket}"]`),
      ).toBeVisible();
    }
    await expect(
      officerPage.locator('[data-test="lapsed-members"]'),
    ).toBeVisible();

    await officerPage.click('[data-test="dashboard-tab-retention"]');
    await expect(
      officerPage.locator('[data-test="retention-rate-chart"]'),
    ).toBeVisible();
    await expect(
      officerPage.locator('[data-test="retention-lapses-chart"]'),
    ).toBeVisible();
  });

  test('5. an unknown tab falls back to Overview', async () => {
    await officerFinance.goToDashboard('tab=bogus');

    await expect(
      officerPage.locator('[data-test="dashboard-tab-overview"]'),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      officerPage.locator('[data-test="finance-dues-collected"]'),
    ).toBeVisible();
  });
});
