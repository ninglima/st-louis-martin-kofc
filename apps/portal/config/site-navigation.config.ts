export interface NavChild {
  label: string;
  path: string;
}

export interface NavItem {
  label: string;
  path?: string;
  children?: readonly NavChild[];
}

export interface LegalLink {
  path: string;
  i18nKey: string;
}

/**
 * Single source of truth for the public site's navigation. The site header and
 * the footer's quick links both read from it, so there is only one copy of the
 * site map to keep current.
 *
 * `site-navigation.config.test.ts` covers the array itself: every item has a
 * `path` or `children`, every path is root-relative, no path appears twice,
 * and each dropdown's first child is the section landing page the footer links
 * for it -- so a re-order that puts a different child first fails a test
 * rather than quietly re-targeting a footer link. Link integrity for the
 * routes themselves is covered by `PUBLIC_ROUTES` below, not by this array
 * alone.
 *
 * Deliberate deviations from the WordPress site, all recorded in the spec:
 * "News" is omitted (no content, empty on the live site), "Grand Knight" is
 * omitted (its copy lives in the homepage welcome section), and "Pay Dues"
 * points at the working checkout rather than repeating the old
 * "coming soon" copy.
 */
export const SITE_NAV: readonly NavItem[] = [
  { label: 'Home', path: '/' },
  {
    label: 'Who We Are',
    children: [
      { label: 'About Our Council', path: '/who-we-are' },
      { label: 'Council Leadership', path: '/council-leadership' },
    ],
  },
  {
    label: 'Faith In Action',
    children: [
      { label: 'Our Faith in Action', path: '/faith-in-action' },
      { label: 'Right to Life', path: '/faith-in-action/right-to-life' },
      {
        label: 'Foster Children Support',
        path: '/faith-in-action/foster-children-support',
      },
      { label: 'Loudoun Food Pantry', path: '/faith-in-action/food-pantry' },
      {
        label: 'Breakfast with the Knights',
        path: '/faith-in-action/breakfast-with-knights',
      },
      {
        label: 'Handy Man Services',
        path: '/faith-in-action/handy-man-services',
      },
      { label: 'Honor Flights', path: '/faith-in-action/honor-flights' },
      { label: 'Seminarian Bios', path: '/faith-in-action/seminarian-bios' },
    ],
  },
  { label: 'Events', path: '/events' },
  { label: 'Catholic Resources', path: '/catholic-resources' },
  {
    label: 'Get Involved',
    children: [
      { label: 'Ways to Get Involved', path: '/get-involved' },
      { label: 'Membership', path: '/get-involved/membership' },
      { label: 'Fraternal Benefits', path: '/get-involved/fraternal-benefits' },
      { label: 'Pay Dues', path: '/get-involved/pay-dues' },
      { label: 'Shirt Order', path: '/get-involved/shirt-order' },
      { label: 'Contact', path: '/get-involved/contact' },
      { label: 'FAQs', path: '/faq' },
    ],
  },
] as const;

/**
 * The policy pages in the footer's bottom bar. They are not menu items, so
 * they are not in `SITE_NAV` -- but they are real routes rendered on every
 * public page, which is exactly why they live here rather than inline in
 * `site-footer.tsx`: a second hand-maintained path list inside a component is
 * a list nothing can test, and renaming one of these pages would otherwise
 * ship a broken link on every page of the site with a green suite.
 */
export const LEGAL_LINKS: readonly LegalLink[] = [
  { path: '/terms-of-service', i18nKey: 'marketing.termsOfService' },
  { path: '/privacy-policy', i18nKey: 'marketing.privacyPolicy' },
  { path: '/cookie-policy', i18nKey: 'marketing.cookiePolicy' },
] as const;

/**
 * Public routes that no menu links at all. `/master-calendar` is reached from
 * the body of the Events page; the live WordPress site leaves it out of the
 * navigation too, so it is recorded here rather than added to `SITE_NAV`.
 */
export const UNLISTED_ROUTES: readonly string[] = ['/master-calendar'] as const;

/**
 * Every route the public marketing site serves, in one place, so the
 * link-integrity checks have a single list to read instead of re-deriving one
 * per test file.
 *
 * `site-navigation.routes.test.ts` checks each of these against the
 * filesystem -- so a renamed or deleted page fails the unit suite instead of
 * 404ing silently -- and also walks `app/(marketing)` in the other direction,
 * so a page added on disk that no list here mentions fails too.
 * `apps/e2e/tests/public-site` loads every one of them in a browser.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  ...SITE_NAV.flatMap((item) => [
    ...(item.path ? [item.path] : []),
    ...(item.children ?? []).map((child) => child.path),
  ]),
  ...LEGAL_LINKS.map((link) => link.path),
  ...UNLISTED_ROUTES,
];

/**
 * What `app/sitemap.xml/route.ts` submits to search engines. Derived from
 * `PUBLIC_ROUTES` rather than listed again: the route handler shipped with a
 * hand-maintained array of five paths, so the nineteen content pages this site
 * exists to serve were advertised to no crawler while three unfinished legal
 * stubs were. A fourth copy of the site map is the same defect the footer's
 * inline legal paths already were.
 *
 * `LEGAL_LINKS` is subtracted because those three pages still render MakerKit
 * placeholder bodies and carry `robots: { index: false }` until the council
 * supplies real copy -- listing a `noindex` page in a sitemap asks a crawler to
 * fetch something it is then told to discard. They stay linked from the footer,
 * which is where a visitor looking for them expects them. Delete this filter
 * when the placeholder copy is replaced and the `noindex` comes off.
 */
export const SITEMAP_ROUTES: readonly string[] = PUBLIC_ROUTES.filter(
  (route) => !LEGAL_LINKS.some((link) => link.path === route),
);
