import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeadlineCards } from './headline-cards';

const empty = {
  year: 2026,
  yearStart: '2026-07-01',
  yearEnd: '2027-07-01',
  isCurrentYear: true,
  today: '2026-10-16',
  duesCollectedCents: 0,
  outstandingCents: 0,
  collection: { numerator: 0, denominator: 0 },
  statusCounts: { current: 0, due_soon: 0, due: 0, lapsed: 0, no_record: 0 },
  hostingToDateCents: 0,
  hostingProjectionCents: 0,
  duesByMonth: [],
  hostingByMonth: [],
};

const text = (c: HTMLElement, hook: string) =>
  c.querySelector(`[data-test="${hook}"]`)?.textContent ?? '';

describe('HeadlineCards', () => {
  it('shows zeros and a dash for a council with no data', () => {
    const { container } = render(<HeadlineCards dashboard={empty} />);
    expect(text(container, 'finance-dues-collected')).toContain('$0.00');
    expect(text(container, 'finance-collection-rate')).toContain('—');
    expect(text(container, 'finance-hosting-projection')).toContain('$0.00');
  });

  it('hides the projection for a past year', () => {
    const { container } = render(
      <HeadlineCards
        dashboard={{
          ...empty,
          isCurrentYear: false,
          hostingProjectionCents: null,
        }}
      />,
    );
    expect(
      container.querySelector('[data-test="finance-hosting-projection"]'),
    ).toBeNull();
  });

  it('labels the snapshot figures as of today', () => {
    const { container } = render(
      <HeadlineCards dashboard={{ ...empty, outstandingCents: 13500 }} />,
    );
    expect(text(container, 'finance-outstanding')).toContain('$135.00');
    expect(text(container, 'finance-outstanding')).toContain('as of today');
  });
});
