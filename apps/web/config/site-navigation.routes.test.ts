import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PUBLIC_ROUTES } from './site-navigation.config';

const MARKETING_DIR = join(__dirname, '..', 'app', '(marketing)');

/**
 * Routes that live outside the (marketing) group or are not .mdx pages.
 * Each needs its own existence check rather than the generic one below.
 */
const SPECIAL_CASES: Record<string, string> = {
  '/': join(MARKETING_DIR, 'page.tsx'),
  '/faq': join(MARKETING_DIR, 'faq', 'page.tsx'),
  '/terms-of-service': join(
    MARKETING_DIR,
    '(legal)',
    'terms-of-service',
    'page.tsx',
  ),
  '/privacy-policy': join(
    MARKETING_DIR,
    '(legal)',
    'privacy-policy',
    'page.tsx',
  ),
  '/cookie-policy': join(MARKETING_DIR, '(legal)', 'cookie-policy', 'page.tsx'),
};

function routeFileFor(path: string): string {
  if (SPECIAL_CASES[path]) {
    return SPECIAL_CASES[path];
  }

  return join(MARKETING_DIR, ...path.slice(1).split('/'), 'page.mdx');
}

/**
 * Every route `app/(marketing)` actually serves, read off the filesystem
 * rather than off any list. Route groups (`(legal)`) contribute no URL
 * segment, and `_`-prefixed directories are private folders Next never
 * routes, so both are skipped the way the router skips them.
 */
function routesOnDisk(directory = MARKETING_DIR, segments: string[] = []) {
  const routes: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_')) {
        continue;
      }

      const isRouteGroup =
        entry.name.startsWith('(') && entry.name.endsWith(')');

      routes.push(
        ...routesOnDisk(
          join(directory, entry.name),
          isRouteGroup ? segments : [...segments, entry.name],
        ),
      );

      continue;
    }

    if (/^page\.(tsx|mdx)$/.test(entry.name)) {
      routes.push(segments.length ? `/${segments.join('/')}` : '/');
    }
  }

  return routes;
}

describe('navigation link integrity', () => {
  it.each(PUBLIC_ROUTES)('has a route file for %s', (path) => {
    expect(existsSync(routeFileFor(path))).toBe(true);
  });

  /**
   * The reverse direction. The check above only ever walks from the lists in
   * `site-navigation.config.ts` to the filesystem, so a page that exists but
   * that no list mentions is invisible to it -- which is exactly how the three
   * legal pages went untested while being linked from every footer. This case
   * fails when a new page lands without being added to `SITE_NAV`,
   * `LEGAL_LINKS` or `UNLISTED_ROUTES`, which is also what keeps the browser
   * suite's route sweep complete, since it reads the same list.
   */
  it('covers every page in app/(marketing)', () => {
    const covered = new Set(PUBLIC_ROUTES);
    const uncovered = routesOnDisk().filter((route) => !covered.has(route));

    expect(uncovered).toEqual([]);
  });
});
