import { describe, expect, it } from 'vitest';

import { SITE_NAV } from './site-navigation.config';

describe('SITE_NAV', () => {
  it('gives every item either a path or children, never neither', () => {
    for (const item of SITE_NAV) {
      expect(Boolean(item.path) || Boolean(item.children?.length)).toBe(true);
    }
  });

  it('uses root-relative paths everywhere', () => {
    const paths = SITE_NAV.flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.children ?? []).map((child) => child.path),
    ]);

    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
    }
  });

  it('contains no duplicate paths', () => {
    const paths = SITE_NAV.flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.children ?? []).map((child) => child.path),
    ]);

    expect(new Set(paths).size).toBe(paths.length);
  });
});

/**
 * The footer (`app/(marketing)/_components/site-footer.tsx`) has no route of
 * its own for a dropdown trigger, so it links `item.children[0].path` and
 * relies on the first child being that section's landing page. Nothing in the
 * config's shape encodes that: `/who-we-are` and `/council-leadership` are both
 * single-segment routes, and `/faq` sits under "Get Involved" without sharing
 * its prefix, so no structural rule ("shortest path", "common prefix") can tell
 * a landing page from a sibling. The invariant is therefore pinned by naming
 * the expected landing page per section -- a deliberate restatement of intent
 * rather than a derived value, which is the only shape that makes re-ordering
 * a `children` array fail a test instead of silently re-targeting a footer
 * link.
 *
 * This is not a second copy of the site map: it lists the three dropdown
 * triggers only, and the coverage assertions below keep it in lockstep with
 * `SITE_NAV` so a new or renamed dropdown cannot skip the check.
 */
const SECTION_LANDING_PAGES: Record<string, string> = {
  'Who We Are': '/who-we-are',
  'Faith In Action': '/faith-in-action',
  'Get Involved': '/get-involved',
};

describe('footer quick links', () => {
  const dropdowns = SITE_NAV.filter((item) => item.children?.length);

  it('has an expected landing page recorded for every dropdown', () => {
    expect(dropdowns.map((item) => item.label).sort()).toEqual(
      Object.keys(SECTION_LANDING_PAGES).sort(),
    );
  });

  it.each(dropdowns.map((item) => item.label))(
    'links %s at its section landing page, so re-ordering children fails here',
    (label) => {
      const item = dropdowns.find((candidate) => candidate.label === label);

      // The exact expression the footer uses to build a quick link.
      const linked = item?.path ?? item?.children?.[0]?.path;

      expect(linked).toBe(SECTION_LANDING_PAGES[label]);
    },
  );
});
