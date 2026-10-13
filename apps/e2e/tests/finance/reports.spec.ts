import { expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { chicagoToday } from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';

function previousMonthLabel(today: string): string {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const previous =
    month === 1
      ? `${year - 1}-12-01`
      : `${year}-${String(month - 1).padStart(2, '0')}-01`;
  const monthStart = previous < '2000-01-01' ? '2000-01-01' : previous;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthStart}T00:00:00Z`));
}

test.describe('finance reports', () => {
  test('an officer saves a Supreme packet and a member is refused', async ({
    browser,
  }) => {
    const officerPage = await browser.newPage();
    const officerAuth = new AuthPageObject(officerPage);
    const officerRbac = new RbacPageObject(officerPage);
    const officerEmail = await officerAuth.signUpFlow('/home');
    await officerRbac.promoteToAdministrator(officerEmail);

    await officerPage
      .locator('[data-sidebar="content"]')
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect(officerPage.getByTestId('dashboard-tabs')).toHaveCount(0);
    await expect(officerPage.getByTestId('worksheet-month')).toHaveValue(
      /.*/,
    );
    await expect(officerPage.getByTestId('worksheet-month')).toContainText(
      previousMonthLabel(chicagoToday()),
    );
    await expect(officerPage.getByTestId('worksheet-roster')).toBeVisible();

    const label = `Supreme e2e ${Date.now()}`;
    await officerPage.getByTestId('packet-label').fill(label);
    await officerPage.getByTestId('packet-supreme').fill('10.00');
    await officerPage.getByTestId('packet-save').click();
    await expect(officerPage.getByText(label)).toBeVisible();

    const memberPage = await browser.newPage();
    const memberAuth = new AuthPageObject(memberPage);
    await memberAuth.signUpFlow('/home');
    await memberPage.goto('/home/reports');
    await expect(memberPage).toHaveURL(/\/home\/?$/);
    await expect(memberPage.getByTestId('worksheet-roster')).toHaveCount(0);

    await officerPage.close();
    await memberPage.close();
  });
});
