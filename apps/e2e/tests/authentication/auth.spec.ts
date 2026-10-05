import { expect, test } from '@playwright/test';

import { AuthPageObject } from './auth.po';

test.describe('Auth flow', () => {
  test.describe.configure({ mode: 'serial' });

  let email: string;

  test('will create a user via admin API and sign in', async ({ page }) => {
    const auth = new AuthPageObject(page);

    email = auth.createRandomEmail();

    await auth.createConfirmedUser({ email, password: 'password' });
    await auth.goToSignIn();
    await auth.signIn({ email, password: 'password' });

    await page.waitForURL('**/home');
    expect(page.url()).toContain('/home');
  });

  test('will sign-in with the correct credentials', async ({ page }) => {
    const auth = new AuthPageObject(page);
    await auth.goToSignIn();

    await auth.signIn({
      email,
      password: 'password',
    });

    await page.waitForURL('**/home');

    expect(page.url()).toContain('/home');

    await auth.signOut();

    expect(page.url()).toContain('/');
  });

  test('redirects /auth/sign-up to sign-in', async ({ page }) => {
    await page.goto('/auth/sign-up');
    await page.waitForURL('**/auth/sign-in');
    expect(page.url()).toContain('/auth/sign-in');
  });
});

test.describe('Protected routes', () => {
  test('will redirect to the sign-in page if not authenticated', async ({
    page,
  }) => {
    await page.goto('/home/settings');

    expect(page.url()).toContain('/auth/sign-in?next=/home/settings');
  });
});
