import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SITE_NAV } from './site-navigation.config';

const MARKETING_DIR = join(__dirname, '..', 'app', '(marketing)');

/**
 * Routes that live outside the (marketing) group or are not .mdx pages.
 * Each needs its own existence check rather than the generic one below.
 */
const SPECIAL_CASES: Record<string, string> = {
  '/': join(MARKETING_DIR, 'page.tsx'),
  '/faq': join(MARKETING_DIR, 'faq', 'page.tsx'),
};

function routeFileFor(path: string): string {
  if (SPECIAL_CASES[path]) {
    return SPECIAL_CASES[path];
  }

  return join(MARKETING_DIR, ...path.slice(1).split('/'), 'page.mdx');
}

describe('navigation link integrity', () => {
  const paths = SITE_NAV.flatMap((item) => [
    ...(item.path ? [item.path] : []),
    ...(item.children ?? []).map((child) => child.path),
  ]);

  it.each(paths)('has a route file for %s', (path) => {
    expect(existsSync(routeFileFor(path))).toBe(true);
  });
});
