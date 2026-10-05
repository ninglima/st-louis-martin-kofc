import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AdminDuesLevel } from '../types';
import { DuesLevelsManager } from './dues-levels-manager';

vi.mock('../server/dues-level-actions', () => ({
  saveDuesLevelAction: vi.fn(),
  retireDuesLevelAction: vi.fn(),
  restoreDuesLevelAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const level = (overrides: Partial<AdminDuesLevel>): AdminDuesLevel => ({
  slug: 'regular',
  name: 'Regular',
  amountCents: 5000,
  selfService: true,
  sortOrder: 2,
  active: true,
  memberCount: 12,
  changedAt: null,
  changedByEmail: null,
  ...overrides,
});

describe('DuesLevelsManager', () => {
  const html = renderToStaticMarkup(
    <DuesLevelsManager
      levels={[
        level({}),
        level({
          slug: 'honorary',
          name: 'Honorary',
          amountCents: 1900,
          selfService: false,
          sortOrder: 5,
          active: false,
          memberCount: 0,
          changedAt: '2026-10-02T15:00:00Z',
          changedByEmail: 'fs@example.com',
        }),
      ]}
    />,
  );

  it('lists every level, retired ones included', () => {
    expect(html.split('data-test="dues-level-row"').length - 1).toBe(2);
    expect(html).toContain('data-slug="honorary"');
  });

  it('shows the price, who chooses it, the order and the members', () => {
    expect(html).toContain('$50.00');
    expect(html).toContain('$19.00');
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    expect(html).toContain('>12<');
  });

  it('marks retired levels and who last changed a level', () => {
    expect(html).toContain('Retired');
    expect(html).toContain('fs@example.com');
  });

  it('offers Retire on active levels and Restore only on retired ones', () => {
    expect(html.split('data-test="retire-dues-level"').length - 1).toBe(1);
    expect(html.split('data-test="restore-dues-level"').length - 1).toBe(1);
    expect(html).toContain('data-test="add-dues-level"');
  });
});
