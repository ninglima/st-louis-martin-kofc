import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/hosting-actions', () => ({
  saveHostingCostAction: vi.fn(),
  deleteHostingCostAction: vi.fn(),
  repeatLastHostingCostAction: vi.fn(),
  hostingOverlapsAction: vi.fn(),
}));

import { HostingCostsTable } from './hosting-costs-table';

const providers = [{ slug: 'supabase', name: 'Supabase' }];
const cost = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'supabase',
  providerName: 'Supabase',
  amountCents: 2500,
  paidOn: '2026-10-01',
  periodStart: '2026-10-01',
  periodEnd: '2026-11-01',
  note: null,
  recordedByEmail: 'fs@example.com',
  updatedAt: '2026-10-01T12:00:00Z',
};

describe('HostingCostsTable', () => {
  it('shows the covered period inclusively and the amount', () => {
    render(
      <HostingCostsTable
        costs={[cost]}
        providers={providers}
        latest={[]}
        canManage={false}
      />,
    );
    expect(screen.getByText('$25.00')).toBeTruthy();
    expect(screen.getByText('2026-10-01 – 2026-10-31')).toBeTruthy();
  });

  it('hides management controls without finance.manage', () => {
    const { container } = render(
      <HostingCostsTable
        costs={[cost]}
        providers={providers}
        latest={[]}
        canManage={false}
      />,
    );
    expect(
      container.querySelector('[data-test="hosting-cost-add"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-test="hosting-cost-edit"]'),
    ).toBeNull();
  });

  it('shows controls with finance.manage', () => {
    const { container } = render(
      <HostingCostsTable
        costs={[cost]}
        providers={providers}
        latest={[]}
        canManage
      />,
    );
    expect(
      container.querySelector('[data-test="hosting-cost-add"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-test="hosting-cost-edit"]'),
    ).not.toBeNull();
  });

  it('shows an empty state', () => {
    const { container } = render(
      <HostingCostsTable
        costs={[]}
        providers={providers}
        latest={[]}
        canManage={false}
      />,
    );
    expect(
      container.querySelector('[data-test="hosting-costs-empty"]'),
    ).not.toBeNull();
  });
});
