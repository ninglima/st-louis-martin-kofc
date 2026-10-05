import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/hosting-actions', () => ({
  saveHostingCostAction: vi.fn(),
  hostingOverlapsAction: vi.fn(),
}));

import { Button } from '@kit/ui/button';

import { HostingCostFormDialog } from './hosting-cost-form-dialog';

const providers = [
  { slug: 'supabase', name: 'Supabase' },
  { slug: 'google_cloud', name: 'Google Cloud' },
];

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

describe('HostingCostFormDialog', () => {
  it('shows the provider name, not the slug, when opened for edit, with the Select closed', async () => {
    render(
      <HostingCostFormDialog
        providers={providers}
        cost={cost}
        trigger={<Button>Edit</Button>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Supabase')).toBeTruthy();
    expect(screen.queryByText('supabase')).toBeNull();
  });
});
