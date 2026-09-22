import { describe, expect, it } from 'vitest';

import { emptyPermissions, hasPermission } from './permissions';

describe('hasPermission', () => {
  it('grants view when can_view is set', () => {
    const perms = { payments: { canView: true, canManage: false } };
    expect(hasPermission(perms, 'payments', 'view')).toBe(true);
  });

  it('denies manage when only can_view is set', () => {
    const perms = { payments: { canView: true, canManage: false } };
    expect(hasPermission(perms, 'payments', 'manage')).toBe(false);
  });

  it('treats manage as implying view', () => {
    const perms = { payments: { canView: false, canManage: true } };
    expect(hasPermission(perms, 'payments', 'view')).toBe(true);
  });

  it('denies everything for an unknown section', () => {
    const perms = { payments: { canView: true, canManage: true } };
    expect(hasPermission(perms, 'roles', 'view')).toBe(false);
  });

  it('denies everything for an empty permission map', () => {
    expect(hasPermission(emptyPermissions(), 'home', 'view')).toBe(false);
  });
});
