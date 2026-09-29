import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(),
}));

import { FollowUpTable } from './follow-up-table';
import type { FollowUpRow } from '../types';

const row: FollowUpRow = {
  memberId: 'm1',
  firstName: 'A',
  lastName: 'B',
  membershipNumber: '1',
  duesStatus: 'due',
  paidThrough: null,
  levelName: 'Regular',
  amountCents: 5000,
};

describe('FollowUpTable', () => {
  it('says nobody is due, not that everyone is paid up, when the list is empty', () => {
    const { container } = render(
      <FollowUpTable rows={[]} canOpenMembers={false} />,
    );

    expect(container.textContent).toContain(
      'Nobody is due in the next 30 days.',
    );
    expect(container.textContent).not.toContain('Everyone is paid up');
  });

  it('does not mention lapsed members when there are none', () => {
    const { container } = render(
      <FollowUpTable rows={[]} canOpenMembers={false} lapsedCount={0} />,
    );

    expect(
      container.querySelector('[data-test="follow-up-lapsed-link"]'),
    ).toBeNull();
  });

  it('points to Lapses when lapsed members exist, even with an empty list', () => {
    const { container } = render(
      <FollowUpTable rows={[]} canOpenMembers={false} lapsedCount={3} />,
    );

    expect(container.textContent).toContain('3 lapsed members');
    const link = container.querySelector('[data-test="follow-up-lapsed-link"]');
    expect(link?.getAttribute('href')).toBe('/home?tab=lapses');
  });

  it('uses the singular for exactly one lapsed member', () => {
    const { container } = render(
      <FollowUpTable rows={[]} canOpenMembers={false} lapsedCount={1} />,
    );

    expect(container.textContent).toContain('1 lapsed member —');
  });

  it('shows the lapsed pointer alongside a non-empty follow-up list', () => {
    const { container } = render(
      <FollowUpTable rows={[row]} canOpenMembers={false} lapsedCount={2} />,
    );

    expect(
      container.querySelectorAll('[data-test="finance-follow-up-row"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-test="follow-up-lapsed-link"]'),
    ).not.toBeNull();
  });

  it('shows the last notice when one is given for the row', () => {
    const { container } = render(
      <FollowUpTable
        rows={[row]}
        canOpenMembers={false}
        lastNotices={{
          m1: {
            memberId: 'm1',
            kind: 'after_30',
            sentAt: '2026-10-03T14:00:00Z',
            tracking: 'opened',
          },
        }}
      />,
    );

    const cell = container.querySelector('[data-test="last-notice"]');
    expect(cell?.textContent).toContain('Opened');
  });
});
