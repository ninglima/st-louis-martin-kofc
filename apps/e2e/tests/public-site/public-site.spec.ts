import { Page, expect, test } from '@playwright/test';

import { PUBLIC_ROUTES } from '../../../web/config/site-navigation.config';

/**
 * The public marketing site is not gated, so unlike the rbac and account
 * suites these tests need no Supabase user, no mailbox and no sign-in: a
 * running dev/prod server is the only dependency.
 *
 * The route list is imported from the same config the header and footer read
 * rather than copied, so a page added to the navigation, to the footer's legal
 * links or to the unlisted routes is covered here the moment it lands. Nothing
 * is appended by hand: `site-navigation.routes.test.ts` walks
 * `app/(marketing)` and fails on any page that list does not mention, so the
 * sweep below is complete by construction rather than by remembering.
 */

/**
 * A character reference that reached the user as literal text.
 *
 * Three branches, because the defect arrives in three shapes and a single
 * naive `&\w+;` would fire on ordinary prose:
 *
 * - `&#\d*` -- decimal references (`&#8217;`, `&#8211;`), the form the
 *   WordPress export is thickest with. Kept deliberately loose: a bare `&#`
 *   is already malformed, so there is nothing to gain by demanding digits.
 * - `&#x...;` -- the hexadecimal spelling of the same thing.
 * - `&<name>;` -- named references (`&rsquo;`, `&nbsp;`, `&mdash;`), which
 *   WordPress emits just as freely and which the earlier numeric-only pattern
 *   let through. Restricted to two-or-more lowercase alphanumerics so that
 *   real copy cannot trip it: the ampersand, the word and the semicolon all
 *   have to be adjacent with no space, which rules out "Faith & Family;" and
 *   the like, and the abbreviation case ("Q&A;", "R&D;") is a single
 *   uppercase letter and fails both halves of the character class. Verified
 *   against the rendered text of every route in `PUBLIC_ROUTES`: nothing on
 *   the site matches it today.
 *
 * Mixed-case names (`&Eacute;`) are out of scope on purpose -- allowing them
 * back would re-admit the acronym false positives for a shape this corpus
 * does not contain.
 */
const RAW_ENTITY = /&#\d*|&#x[0-9a-fA-F]+;|&[a-z][a-z0-9]{1,8};/;

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
  for (const path of PUBLIC_ROUTES) {
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
      const response = await page.goto(path);

      // Next's 404 document contains no entities either, so without this the
      // test would pass on a route that no longer exists and assert nothing.
      expect(response?.status(), `${path} did not return 200`).toBe(200);

      // The WordPress export is full of character references (`&#8217;`,
      // `&rsquo;`). Any that survive into the page as literal text rather than
      // as the character they encode are a porting defect. `innerText` rather
      // than `textContent`: it is the visible rendering, so an entity hidden
      // in a `<script>` or a `display: none` node is not a false alarm.
      const text = await page.locator('body').innerText();
      const match = RAW_ENTITY.exec(text);

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
