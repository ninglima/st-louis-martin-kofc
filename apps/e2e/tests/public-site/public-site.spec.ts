import { Page, expect, test } from '@playwright/test';

import { SITE_NAV } from '../../../web/config/site-navigation.config';

/**
 * The public marketing site is not gated, so unlike the rbac and account
 * suites these tests need no Supabase user, no mailbox and no sign-in: a
 * running dev/prod server is the only dependency.
 *
 * The route list is imported from the same config the header and footer read
 * rather than copied, so a page added to the navigation is covered here the
 * moment it lands. `/master-calendar` is the one exception: it is deliberately
 * absent from `SITE_NAV` (the live site does not put it in the menu either)
 * but it is a real route linked from the Events page, so it is appended by
 * hand.
 */
const NAV_PATHS = SITE_NAV.flatMap((item) => [
  ...(item.path ? [item.path] : []),
  ...(item.children ?? []).map((child) => child.path),
]);

const PUBLIC_PATHS = [...NAV_PATHS, '/master-calendar'];

/**
 * Every heading in document order, as a number. Used for the two structural
 * checks below; `h1`..`h6` is enough because the site uses no `role="heading"`
 * elements.
 */
function headingLevels(page: Page) {
  return page.$$eval('h1, h2, h3, h4, h5, h6', (elements) =>
    elements.map((element) => Number(element.tagName.slice(1))),
  );
}

test.describe('public site', () => {
  for (const path of PUBLIC_PATHS) {
    test(`renders ${path}`, async ({ page }) => {
      const response = await page.goto(path);

      // A missing route still renders Next's 404 document, which has headings
      // of its own -- so the status has to be asserted, not just the content.
      expect(response?.status(), `${path} did not return 200`).toBe(200);

      // Exactly one `h1` per route is a branch-wide invariant: every marketing
      // page's title comes from `SitePageHeader` or the homepage hero, never
      // from body copy.
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();

      // ...and no level is skipped (an `h2` followed by an `h4`), which is what
      // actually breaks screen-reader outline navigation. The footer's own
      // `h2`s sit at the end of every page, so this covers the full document,
      // not just the article body.
      const levels = await headingLevels(page);

      for (let index = 1; index < levels.length; index += 1) {
        const previous = levels[index - 1] as number;
        const current = levels[index] as number;

        expect(
          current - previous,
          `${path} skips from h${previous} to h${current}`,
        ).toBeLessThanOrEqual(1);
      }
    });

    test(`renders no raw HTML entity on ${path}`, async ({ page }) => {
      await page.goto(path);

      // The WordPress export is full of numeric character references
      // (`&#8217;`, `&#8211;`). Any that survive into the page as literal text
      // rather than as the character they encode are a porting defect, and
      // `&#` is the shortest fragment that catches all of them. `innerText`
      // rather than `textContent`: it is the visible rendering, so an entity
      // hidden in a `<script>` or a `display: none` node is not a false alarm.
      const text = await page.locator('body').innerText();
      const match = /&#\d*/.exec(text);

      expect(
        match?.[0] ?? null,
        `${path} renders a raw HTML entity`,
      ).toBeNull();
    });
  }

  test('mobile navigation reaches a nested child link', async ({ page }) => {
    // The header swaps to the dropdown at `md`, so anything under 768px wide
    // exercises `MobileDropdown` rather than `DesktopNavigation`.
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');

    // `[data-test=...]` rather than `getByTestId`: the repo's components use
    // `data-test`, and Playwright's default test-id attribute is `data-testid`.
    await expect(page.locator('[data-test="site-nav-desktop"]')).toBeHidden();

    await page.getByLabel('Open Menu').click();

    const mobileMenu = page.locator('[data-test="site-nav-mobile"]');

    await expect(mobileMenu).toBeVisible();

    // "Right to Life" is nested two levels down -- under the "Faith In Action"
    // trigger, which has no route of its own -- so reaching it proves the
    // dropdown renders children and not just the top level.
    const nestedLink = mobileMenu.getByRole('menuitem', {
      name: 'Right to Life',
    });

    await expect(nestedLink).toBeVisible();

    await nestedLink.click();

    await page.waitForURL('**/faith-in-action/right-to-life');

    // `getByRole` rather than `locator('h1')`: Next 16 keeps the page we
    // navigated away from mounted-but-hidden for instant back-navigation, so
    // after a soft navigation the homepage's `h1` is still in the DOM and a
    // plain tag locator matches two elements. The accessibility tree only ever
    // exposes the live one, which is the thing this assertion is about.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Right to Life' }),
    ).toBeVisible();
  });
});
