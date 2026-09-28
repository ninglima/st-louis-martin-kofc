import { expect, test } from '@playwright/test';

/**
 * Needs `SIMULATE_COLD_START_MS=5000 pnpm stack:up` on a stack that has been
 * idle for over a minute (or was just started), and E2E_COLD_START=true.
 */
test('a cold portal shows Please wait..., then the requested page with its query', async ({
  page,
}) => {
  await page.goto('/auth/sign-in?next=/home/checkout');

  await expect(page.getByText('Please wait...')).toBeVisible();
  await expect(page.getByText('Please wait...')).toBeHidden({
    timeout: 20_000,
  });

  expect(page.url()).toContain('/auth/sign-in?next=/home/checkout');
  await expect(page.locator('input[type="email"]')).toBeVisible();
});
