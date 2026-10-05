import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/notice-actions', () => ({
  setDuesNoticesOptOutAction: vi.fn(),
}));

import { LastNoticeCell } from './last-notice-cell';
import { TrackingBadge } from './tracking-badge';

describe('notice components', () => {
  it('labels tracking and marks problems', () => {
    const { container, rerender } = render(
      <TrackingBadge tracking="clicked" />,
    );
    expect(container.textContent).toBe('Clicked');
    rerender(<TrackingBadge tracking="bounced" />);
    expect(
      container
        .querySelector('[data-test="tracking-badge"]')
        ?.getAttribute('data-problem'),
    ).toBe('true');
  });

  it('shows the last notice or a dash', () => {
    const { container, rerender } = render(
      <LastNoticeCell notice={undefined} />,
    );
    expect(container.textContent).toBe('—');
    rerender(
      <LastNoticeCell
        notice={{
          memberId: 'm1',
          kind: 'after_30',
          sentAt: '2026-10-03T14:00:00Z',
          tracking: 'opened',
        }}
      />,
    );
    expect(container.textContent).toContain('30 days after');
    expect(container.textContent).toContain('Oct 3');
    expect(container.textContent).toContain('Opened');
  });
});
