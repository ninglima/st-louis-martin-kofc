import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Matches the theme class next-themes writes onto `<html>`. `attribute="class"`
 * in `root-providers.tsx`, so the theme is class-driven and the class attribute
 * also carries the font variables and the base utilities -- hence the word
 * boundaries rather than an equality check.
 */
const DARK_CLASS = /(^|\s)dark(\s|$)/;

const CATHOLIC_RESOURCES_MDX = join(
  __dirname,
  '..',
  '..',
  '..',
  'web',
  'app',
  '(marketing)',
  'catholic-resources',
  'page.mdx',
);

interface ResourceEntry {
  label: string;
  /** `null` when the source bullet is not a markdown link at all. */
  href: string | null;
}

/**
 * Every bullet in `/catholic-resources`, read off the page's own source.
 *
 * The expectation is deliberately derived from the content rather than from a
 * hardcoded table of fifteen URLs. A second copy of a list is the exact defect
 * this branch has already fixed twice (the footer's inline legal paths, the
 * per-file route lists), and a copy here would have to be updated by hand every
 * time the council adds a resource -- which is the failure mode that lets a
 * list rot.
 *
 * The subtlety is *which* part of the source is treated as the expectation. The
 * original defect was that a lossy WordPress export dropped the `href`s and
 * left the labels as plain text; a parser that only collected markdown links
 * would have happily expected fourteen links after one was flattened and passed.
 * So the label is taken from every bullet -- linked or not -- and the assertion
 * is that each one reaches the browser as an anchor with a real destination.
 * Flatten a bullet in the .mdx and this function still demands a link for it.
 *
 * The URL is captured only when the source has one, and is then asserted
 * verbatim, which catches an `href` that renders mangled rather than missing.
 */
function catholicResourceEntries(): ResourceEntry[] {
  const source = readFileSync(CATHOLIC_RESOURCES_MDX, 'utf8');

  return source
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const item = line.slice(2).trim();
      const linked = /^\[([^\]]+)\]\((\S+)\)$/.exec(item);

      if (linked) {
        return { label: linked[1] as string, href: linked[2] as string };
      }

      return { label: item, href: null };
    });
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

      // Exactly one `main` landmark, on every route rather than on a sample of
      // them: `@kit/ui`'s `Header` renders a `<div>`, so without the wrapper in
      // `app/(marketing)/layout.tsx` the footer is the only landmark on the
      // whole document and a screen reader cannot skip the navigation. Two
      // would be just as broken as none, so this is a count and not a
      // presence check -- a page that renders its own `<main>` inside the
      // layout's has to fail here.
      await expect(page.getByRole('main')).toHaveCount(1);

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

  test('every Catholic resource reaches the browser as a real link', async ({
    page,
  }) => {
    const entries = catholicResourceEntries();

    // A floor, not a copy of the list. The fifteen labels themselves are read
    // from the page source above; this only refuses the degenerate case where
    // the source has been gutted and every per-entry assertion below therefore
    // has nothing left to assert. It is deliberately `>=` so adding a resource
    // needs no edit here.
    expect(
      entries.length,
      '/catholic-resources lists fewer entries than the live council site',
    ).toBeGreaterThanOrEqual(15);

    const response = await page.goto('/catholic-resources');

    expect(response?.status(), '/catholic-resources did not return 200').toBe(
      200,
    );

    const main = page.getByRole('main');

    for (const entry of entries) {
      const link = main.getByRole('link', { name: entry.label, exact: true });

      // `toHaveCount(1)` rather than `toBeVisible()`: the defect being guarded
      // is the label rendering as plain text, which is visible -- it is the
      // anchor that is missing.
      await expect(
        link,
        `"${entry.label}" is not a link on /catholic-resources`,
      ).toHaveCount(1);

      const href = await link.getAttribute('href');

      // `#` is what `mdx-components.tsx` substitutes for a missing `href`, so
      // it is the shape a dead link takes once it is an anchor at all.
      expect(
        href,
        `"${entry.label}" is an anchor with no destination`,
      ).toBeTruthy();

      expect(href, `"${entry.label}" points at the placeholder "#"`).not.toBe(
        '#',
      );

      if (entry.href) {
        expect(
          href,
          `"${entry.label}" renders a different URL than its source`,
        ).toBe(entry.href);
      }
    }

    // One anchor per bullet and no more. The loop above proves every label is a
    // link; this proves nothing else in those lists is -- so a bullet flattened
    // into plain text while an unrelated anchor appears elsewhere in the lists
    // cannot net out to a pass. Last, so the loop's per-label message is what a
    // reader sees first when a link goes missing.
    await expect(main.locator('li a')).toHaveCount(entries.length);
  });

  test('Pay Dues sends a member to the council checkout', async ({ page }) => {
    // The one cross-feature dependency the site-copy spec names, and it
    // shipped pointing at a bare `/auth/sign-in`, which drops a member on
    // `/home` two navigations away from the checkout he came to reach.
    // Asserted on the rendered anchor rather than on the .mdx source: the link
    // passes through `mdx-components.tsx`'s `a` mapping, which rewrites
    // internal hrefs, so the source and the destination are not the same
    // thing.
    const response = await page.goto('/get-involved/pay-dues');

    expect(
      response?.status(),
      '/get-involved/pay-dues did not return 200',
    ).toBe(200);

    const duesLink = page.getByRole('main').getByRole('link', {
      name: /pay your dues/i,
    });

    await expect(duesLink).toHaveCount(1);

    const href = await duesLink.getAttribute('href');

    // The destination has to survive the sign-in bounce. `/home/checkout`
    // alone does not: the auth guard redirects an anonymous visitor to a
    // `next`-less `/auth/sign-in`.
    expect(
      href,
      'the Pay Dues link does not carry the checkout as its destination',
    ).toContain('/home/checkout');

    await duesLink.click();

    // Signed out, so this lands on the sign-in page -- but carrying the
    // checkout, which is what `sign-in-methods-container.tsx` replays after a
    // successful sign-in.
    await page.waitForURL('**/auth/sign-in**');

    expect(
      new URL(page.url()).searchParams.get('next'),
      'the sign-in page was reached without the checkout as its `next`',
    ).toBe('/home/checkout');
  });

  test('Sign In is reachable from a phone viewport', async ({ page }) => {
    // The live WordPress council site carries a permanent "Member Login", so
    // losing Sign In on a phone is a regression against the site being
    // replaced, not merely a missing nicety. Below `md` the header has room
    // for the logo, the hamburger and Sign Up only, so Sign In moved into the
    // navigation dropdown rather than off the phone entirely.
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');

    await page.getByLabel('Open Menu').click();

    const mobileMenu = page.locator('[data-test="site-nav-mobile"]');

    await expect(mobileMenu).toBeVisible();

    const signIn = mobileMenu.locator('[data-test="mobile-sign-in"]');

    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('href', '/auth/sign-in');

    // Following it, not just reading the attribute: an item that is present and
    // correctly addressed but that the menu swallows the click on is exactly as
    // unreachable as one that is absent.
    await signIn.click();

    await page.waitForURL('**/auth/sign-in');
  });

  test('the mobile menu theme toggle really switches the theme', async ({
    page,
  }) => {
    // `DEFAULT_THEME_MODE` is `light` and the header's icon toggle is `md:`-only,
    // so before this control existed a phone visitor could not reach dark mode
    // at all.
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');

    const html = page.locator('html');

    await expect(html).not.toHaveClass(DARK_CLASS);

    await page.getByLabel('Open Menu').click();

    const mobileMenu = page.locator('[data-test="site-nav-mobile"]');

    await expect(mobileMenu).toBeVisible();

    // `SubMenuModeToggle` renders its three modes inline below `lg` (the
    // submenu trigger is `hidden lg:flex`), so at 390px the modes are direct
    // items of this menu. Asserted before it is clicked so that a missing
    // control fails as an assertion rather than as a click timeout.
    const darkMode = mobileMenu.getByRole('menuitem', {
      name: 'Dark',
      exact: true,
    });

    await expect(darkMode).toBeVisible();
    await darkMode.click();

    // The effect, not the affordance. Asserting only that a "Dark" item exists
    // would pass against a toggle wired to nothing; the theme is class-driven,
    // so the observable outcome is the class on `<html>`. (Emulating
    // `prefers-color-scheme` does not produce it -- `defaultTheme` is `light`,
    // not `system`.)
    await expect(html).toHaveClass(DARK_CLASS);

    // And back, so this covers a control that switches rather than one that
    // only ever sets dark.
    await page.getByLabel('Open Menu').click();
    await expect(mobileMenu).toBeVisible();

    const lightMode = mobileMenu.getByRole('menuitem', {
      name: 'Light',
      exact: true,
    });

    await expect(lightMode).toBeVisible();
    await lightMode.click();

    await expect(html).not.toHaveClass(DARK_CLASS);
  });

  test('the skip link is the first tab stop and moves focus to the main content', async ({
    page,
  }) => {
    await page.goto('/');

    const skipLink = page.locator('[data-test="skip-to-content"]');

    // One `Tab` from a fresh load, with nothing clicked first: a skip link that
    // is only reachable after some other element has been focused is not a skip
    // link.
    await page.keyboard.press('Tab');

    await expect(skipLink).toBeFocused();

    // `toBeVisible()` does not cover this and neither does a bounding box.
    // Tailwind's `sr-only` hides the link with `clip-path: inset(50%)` on a 1px
    // box, but the focus styles add `px-4 py-2`, and with `box-sizing:
    // border-box` that padding alone gives the still-hidden link a 32x16
    // bounding box -- so "bigger than a pixel" passes on the broken rendering.
    // Measured instead: the link is not clipped, and its box is big enough to
    // hold its own label rather than scrolling it out of sight. Both flip when
    // `focus:not-sr-only` is removed (146x40 unclipped -> 32x16 with
    // `inset(50%)`), which is the whole point of the class.
    const rendering = await skipLink.evaluate((element) => {
      return {
        clipPath: getComputedStyle(element).clipPath,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      };
    });

    expect(
      rendering.clipPath,
      'the focused skip link is still clipped away',
    ).toBe('none');

    expect(
      rendering.clientWidth,
      'the focused skip link is too narrow to show its label',
    ).toBeGreaterThanOrEqual(rendering.scrollWidth);

    expect(
      rendering.clientHeight,
      'the focused skip link is too short to show its label',
    ).toBeGreaterThanOrEqual(rendering.scrollHeight);

    await page.keyboard.press('Enter');

    // Focus has to *move*, not just the scroll position: without `tabIndex={-1}`
    // on the `<main>` the browser scrolls to the fragment and leaves focus on
    // the link, so the next `Tab` walks back into the navigation the user just
    // asked to skip.
    await expect(page.locator('#main-content')).toBeFocused();
  });
});
