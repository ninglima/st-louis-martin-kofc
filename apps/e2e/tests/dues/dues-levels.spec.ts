/**
 * Settings → Dues levels end to end: a finance officer adds a level, changes
 * its price, retires it while moving its one member to Regular, and restores
 * it; a plain member cannot open the page.
 *
 * Run with the stack up (see dues.spec.ts):
 *   pnpm --filter web-e2e exec playwright test tests/dues/dues-levels.spec.ts
 */
import { Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { RbacPageObject } from '../rbac/rbac.po';
import { DuesLevelsPageObject } from './dues-levels.po';

test.describe('Dues levels', () => {
  test.describe.configure({ mode: 'serial' });

  let officerPage: Page;
  let levels: DuesLevelsPageObject;
  const name = `E2E Level ${Date.now() % 100_000}`;
  let slug: string;
  let memberId: string;
  let officerEmail: string;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    const auth = new AuthPageObject(officerPage);
    const rbac = new RbacPageObject(officerPage);
    levels = new DuesLevelsPageObject(officerPage);

    officerEmail = await auth.signUpFlow('/home');
    await rbac.promoteToAdministrator(officerEmail);
    await officerPage.reload();
  });

  test.afterAll(async () => {
    await officerPage.close();
  });

  test('1. an officer adds a level', async () => {
    await levels.goTo();
    await levels.addLevel({ name, amount: '12.34', order: '50' });

    slug = await levels.slugOf(name);

    await expect(levels.row(slug)).toContainText('$12.34');
    await expect(levels.row(slug)).toContainText('No');
  });

  test('2. a price change says it applies from now on', async () => {
    await levels.row(slug).locator('[data-test="edit-dues-level"]').click();
    await levels.fillLevel({ amount: '15' });

    await expect(
      officerPage.locator('[data-test="dues-level-price-notice"]'),
    ).toHaveText(
      'Applies to payments made from now on. Recorded dues keep the amount paid.',
    );

    await officerPage.click('[data-test="dues-level-save"]');
    await expect(levels.row(slug)).toContainText('$15.00');
  });

  test("3. retiring moves the level's member to the chosen level", async () => {
    memberId = await levels.seedMemberOnLevel(
      { email: officerEmail, password: 'password' },
      slug,
    );
    await officerPage.reload();
    await expect(levels.row(slug)).toContainText('1');

    await levels.retire(slug, 'Regular');

    expect(await levels.memberLevel(memberId)).toBe('regular');
    await expect(
      levels.row(slug).locator('[data-test="restore-dues-level"]'),
    ).toBeVisible();
  });

  test('4. a retired level can be restored', async () => {
    await levels.row(slug).locator('[data-test="restore-dues-level"]').click();

    await expect(
      levels.row(slug).locator('[data-test="dues-level-status"]'),
    ).toHaveText('Active');
  });

  test('5. a plain member cannot open the page', async ({ browser }) => {
    const memberPage = await browser.newPage();
    await new AuthPageObject(memberPage).signUpFlow('/home');

    await memberPage.goto('/home/settings/dues-levels');

    await expect(memberPage).not.toHaveURL(/\/home\/settings\/dues-levels/);
    await expect(
      memberPage.locator('[data-test="dues-levels-table"]'),
    ).toHaveCount(0);

    await memberPage.close();
  });
});
