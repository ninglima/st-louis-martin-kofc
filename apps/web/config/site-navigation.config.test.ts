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
