export interface NavChild {
  label: string;
  path: string;
}

export interface NavItem {
  label: string;
  path?: string;
  children?: readonly NavChild[];
}

/**
 * Single source of truth for the public site's navigation. The site header and
 * the footer's quick links both read from it, so there is only one copy of the
 * site map to keep current.
 *
 * `site-navigation.config.test.ts` covers the array's shape only: every item
 * has a `path` or `children`, every path is root-relative, no path appears
 * twice. Nothing here is checked against the filesystem, so a renamed or
 * deleted page will still 404 silently; the footer's "first child is the
 * section landing page" assumption is likewise unenforced.
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
