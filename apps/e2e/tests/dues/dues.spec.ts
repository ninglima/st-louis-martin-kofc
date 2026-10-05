/**
 * The dues ledger, end to end, against a real database: an FS records and
 * voids a check payment (Tasks 2 and 4's `MemberDuesCard`), a member without
 * `finance` sees none of it (Task 1's RBAC gate, read through Tasks 5-6's
 * screens), and -- only when Stripe test keys are configured -- a linked
 * member pays online through checkout (Task 4's priced checkout, Task 3's
 * online-payment trigger).
 *
 * TO RUN IT:
 *
 *   1. Start Docker.
 *   2. pnpm supabase:web:start
 *   3. pnpm stack:up
 *   4. pnpm --filter web-e2e exec playwright test tests/dues
 *   5. pnpm stack:down
 *
 * Spec 4 is skipped unless `E2E_STRIPE` is set in the environment -- it is
 * the only scenario here that would otherwise reach the real Stripe test
 * network via the app's checkout flow, and it has never been run: nothing in
 * this repository's e2e suite exercises the Stripe Payment Element yet, so
 * its selectors (a `<iframe title="Secure payment input frame">`, and the
 * card/expiry/cvc/postal field names) were confirmed against Stripe's own
 * publicly documented Payment Element markup, not observed in this app.
 * Treat a first `E2E_STRIPE=1` run as a debugging session for that one
 * scenario, the same way `rbac.spec.ts`'s header note asks for its suite.
 */
import { BrowserContext, Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { RbacPageObject } from '../rbac/rbac.po';
import {
  DuesPageObject,
  addDaysIso,
  buildOneRowRosterFixture,
  chicagoToday,
} from './dues.po';

test.describe('Dues', () => {
  // Serial: scenario 2 voids the very period scenario 1 records, and
  // scenario 3 opens the member scenario 1 created.
  test.describe.configure({ mode: 'serial' });

  let officerPage: Page;
  let officerAuth: AuthPageObject;
  let officerRbac: RbacPageObject;
  let officerDues: DuesPageObject;

  let memberContext: BrowserContext;

  // Set by scenario 1, read by scenario 3.
  let seededMemberId: string;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    officerAuth = new AuthPageObject(officerPage);
    officerRbac = new RbacPageObject(officerPage);
    officerDues = new DuesPageObject(officerPage);

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
    await memberContext?.close();
  });

  test('1. the FS records a check', async () => {
    // The roster confirm step creates a GoTrue account via the admin API,
    // same as members.spec.ts scenario 4 -- give it room beyond the file
    // default.
    test.setTimeout(90_000);

    const fixture = buildOneRowRosterFixture();

    await officerDues.goToImport();
    await officerDues.uploadAndConfirmRoster(fixture);

    seededMemberId = await officerDues.openMember(fixture.membershipNumber);

    await expect(officerDues.duesCard()).toBeVisible();

    // Freshly imported: no accepted_on and no ledger, so `dues_status`
    // (kit.dues_status in 20260928120000_dues_model.sql) reads `no_record`.
    await expect(officerDues.duesStatus()).toHaveText('No record');

    const today = chicagoToday();
    await officerDues.setAcceptedOn(today);

    // accepted_on set, still nothing paid -> `due`.
    await expect(officerDues.duesStatus()).toHaveText('Due');

    await officerDues.recordCheckPayment({
      levelOptionName: 'Regular — $50.00',
      checkNumber: '1042',
    });

    // First period: start = accepted_on, end = start + 365 days (never "+1
    // year" -- see the doc comment on `addDaysIso` in dues.po.ts).
    const expectedPaidThrough = addDaysIso(today, 365);

    await expect(officerDues.duesStatus()).toHaveText('Current');
    await expect(officerDues.duesPaidThrough()).toHaveText(
      `Paid through ${expectedPaidThrough}`,
    );
    await expect(officerDues.ledgerRows()).toHaveCount(1);
  });

  test('2. voiding the period returns the status to Due', async () => {
    await officerDues.voidFirstPeriod('e2e');

    // No active periods left, but accepted_on is still set -- `due`, not
    // `no_record`.
    await expect(officerDues.duesStatus()).toHaveText('Due');
  });

  test('3. a member with members.view but no finance access sees no dues UI', async ({
    browser,
  }) => {
    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const memberAuth = new AuthPageObject(memberPage);
    const memberDues = new DuesPageObject(memberPage);

    // A plain signup lands on the `member` role, which has no `members`
    // section at all (see members.spec.ts scenario 1) -- so this needs a
    // purpose-built role, granted afterwards, rather than the default.
    const memberEmail = await memberAuth.signUpFlow('/home');

    await officerRbac.goToRoles();
    const roleName = await officerDues.createRoleWithMembersViewOnly();

    await officerRbac.goToUsers();
    await officerRbac.changeUserRole(memberEmail, roleName);

    // `changeUserRole`'s onValueChange kicks off `assignRoleAction` in a
    // transition (users-manager.tsx) -- the select visually updates
    // immediately, but the DB write it triggers is still in flight. Waiting
    // for its own success toast is what actually confirms the write landed,
    // so the member's navigation below can't race it.
    await expect(officerPage.getByText('Role updated.')).toBeVisible();

    // Permissions are read fresh from the database on every server render,
    // so the member merely has to navigate -- no sign-out/sign-in needed.
    await memberDues.goToMembers();

    await expect(
      memberPage.getByRole('heading', { name: 'Members', level: 1 }),
    ).toBeVisible();

    await expect(
      memberPage.locator('[data-test="member-dues-status"]'),
    ).toHaveCount(0);

    await memberPage.goto(`/home/members/${seededMemberId}`);

    await expect(
      memberPage.locator('[data-test="member-roster-details"]'),
    ).toBeVisible();

    await expect(memberDues.duesCard()).toHaveCount(0);
  });

  test('4. a linked member pays dues online through checkout', async ({
    browser,
  }) => {
    test.skip(
      !process.env.E2E_STRIPE,
      'Set E2E_STRIPE to run the online-dues checkout spec against Stripe test keys.',
    );

    test.setTimeout(90_000);

    const context = await browser.newContext();
    const page = await context.newPage();
    const auth = new AuthPageObject(page);
    const dues = new DuesPageObject(page);

    try {
      // A member row with an account this test can actually sign in as --
      // see the doc comment on `linkMemberToUser` for why the roster
      // import's own auto-created account can't be used directly.
      const email = await auth.signUpFlow('/home');

      const fixture = buildOneRowRosterFixture();
      await officerDues.goToImport();
      await officerDues.uploadAndConfirmRoster(fixture);
      await officerDues.linkMemberToUser(fixture.membershipNumber, email);

      await page.goto('/home/checkout');

      await dues.selectOption('[data-test="checkout-type"]', 'Dues');

      await expect(
        page.locator('[data-test="checkout-dues-level"]'),
      ).toBeVisible();

      await page.click('[data-test="checkout-submit"]');

      // Stripe's Payment Element renders inside its own iframe; field names
      // per Stripe's documented markup for the unified card element.
      const stripeFrame = page.frameLocator(
        'iframe[title="Secure payment input frame"]',
      );

      await stripeFrame
        .locator('input[name="number"]')
        .fill('4242424242424242');
      await stripeFrame.locator('input[name="expiry"]').fill('12/34');
      await stripeFrame.locator('input[name="cvc"]').fill('123');

      const postalCode = stripeFrame.locator('input[name="postalCode"]');
      if (await postalCode.count()) {
        await postalCode.fill('20147');
      }

      await page.getByRole('button', { name: 'Pay Now' }).click();

      await page.waitForURL('**/home/checkout/success', { timeout: 30_000 });

      await page.goto('/home/payments');

      // The online-payment trigger (kit.record_online_dues_period,
      // 20260928120200_dues_online_and_load.sql) runs off the webhook that
      // marks the payment succeeded, so this may lag the redirect slightly
      // -- `toPass` retries the whole read rather than asserting once.
      await expect(async () => {
        await page.reload();
        await expect(
          page.locator('[data-test="my-dues-paid-through"]'),
        ).toContainText('Paid through');
      }).toPass({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});
