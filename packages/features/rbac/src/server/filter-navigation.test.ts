import { describe, expect, it } from 'vitest';

import { filterRoutesByPermission } from './filter-navigation';

const routes = [
  {
    label: 'Application',
    children: [
      { label: 'Home', path: '/home', section: 'home', verb: 'view' as const },
      {
        label: 'Payments',
        path: '/home/payments',
        section: 'payments',
        verb: 'view' as const,
      },
    ],
  },
  {
    label: 'Settings',
    children: [
      { label: 'Profile', path: '/home/settings' },
      {
        label: 'Payment Settings',
        path: '/home/settings/payments',
        section: 'payment_settings',
        verb: 'manage' as const,
      },
    ],
  },
];

describe('filterRoutesByPermission', () => {
  it('keeps entries the user is allowed to see', () => {
    const perms = { home: { canView: true, canManage: false } };
    const result = filterRoutesByPermission(routes, perms);

    expect(result[0]?.children.map((c) => c.label)).toEqual(['Home']);
  });

  it('keeps ungated entries regardless of permissions', () => {
    const result = filterRoutesByPermission(routes, {});
    const settings = result.find((g) => g.label === 'Settings');

    expect(settings?.children.map((c) => c.label)).toEqual(['Profile']);
  });

  it('drops groups whose children are all filtered out', () => {
    const routesAllGated = [
      {
        label: 'Admin',
        children: [
          {
            label: 'Roles',
            path: '/home/settings/roles',
            section: 'roles',
            verb: 'manage' as const,
          },
        ],
      },
    ];

    expect(filterRoutesByPermission(routesAllGated, {})).toEqual([]);
  });

  it('preserves dividers', () => {
    const withDivider = [{ divider: true as const }, ...routes];
    const result = filterRoutesByPermission(withDivider, {});

    expect(result[0]).toEqual({ divider: true });
  });

  it('filters gated sub-children nested under a route child', () => {
    const routesWithSubChildren = [
      {
        label: 'Application',
        children: [
          {
            label: 'Payments',
            path: '/home/payments',
            section: 'payments',
            verb: 'view' as const,
            children: [
              {
                label: 'History',
                path: '/home/payments/history',
                section: 'payments',
                verb: 'view' as const,
              },
              {
                label: 'All Members',
                path: '/home/payments/all',
                section: 'payments',
                verb: 'manage' as const,
              },
              { label: 'Export', path: '/home/payments/export' },
            ],
          },
        ],
      },
    ];

    const perms = { payments: { canView: true, canManage: false } };
    const result = filterRoutesByPermission(routesWithSubChildren, perms);

    const payments = result[0]?.children.find((c) => c.label === 'Payments');
    const paymentsChildren = payments?.children;

    expect(paymentsChildren).toBeDefined();

    expect(
      (paymentsChildren as Array<{ label: string }>).map((c) => c.label),
    ).toEqual(['History', 'Export']);
  });
});
