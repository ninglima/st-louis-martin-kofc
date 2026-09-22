import { describe, expect, it } from 'vitest';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';

/**
 * `NavigationConfigSchema` uses `z.object()` (not `.passthrough()`), which
 * strips unknown keys in Zod 4. `section`/`verb` are how every nav entry is
 * gated -- if a future refactor of the schema drops those fields, every
 * route silently becomes ungated (nav filtering, and by extension the
 * cosmetic layer of RBAC, stops working) while CI stays green, because
 * nothing round-trips a fixture through the actual schema and checks what
 * survives.
 *
 * This imports the real, shipped `NavigationConfigSchema` -- not a copy --
 * so it fails the moment the schema itself regresses, independent of
 * `filter-navigation.test.ts` (which exercises `filterRoutesByPermission`
 * against plain object fixtures that never touch the schema at all).
 */
describe('NavigationConfigSchema', () => {
  it('keeps section and verb on a top-level route child after parsing', () => {
    const parsed = NavigationConfigSchema.parse({
      routes: [
        {
          label: 'Application',
          children: [
            {
              label: 'Payments',
              path: '/home/payments',
              section: 'payments',
              verb: 'view',
            },
          ],
        },
      ],
    });

    const group = parsed.routes[0];

    if (!group || !('children' in group)) {
      throw new Error('expected a route group, got a divider');
    }

    const child = group.children[0];

    expect(child?.section).toBe('payments');
    expect(child?.verb).toBe('view');
  });

  it('keeps section and verb on a nested route sub-child after parsing', () => {
    const parsed = NavigationConfigSchema.parse({
      routes: [
        {
          label: 'Application',
          children: [
            {
              label: 'Payments',
              path: '/home/payments',
              section: 'payments',
              verb: 'view',
              children: [
                {
                  label: 'Payment Detail',
                  path: '/home/payments/detail',
                  section: 'payments',
                  verb: 'manage',
                },
              ],
            },
          ],
        },
      ],
    });

    const group = parsed.routes[0];

    if (!group || !('children' in group)) {
      throw new Error('expected a route group, got a divider');
    }

    const subChild = group.children[0]?.children?.[0];

    expect(subChild?.section).toBe('payments');
    expect(subChild?.verb).toBe('manage');
  });
});
