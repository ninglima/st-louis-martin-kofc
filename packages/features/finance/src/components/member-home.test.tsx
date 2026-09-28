import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberHome } from './member-home';

const summary = {
  memberId: 'm1',
  duesLevel: 'regular',
  levelName: 'Regular',
  amountCents: 5000,
  acceptedOn: '2025-01-01',
  isStudent: false,
  paidThrough: '2026-01-01',
  duesStatus: 'lapsed' as const,
  levelSelfService: true,
  levelActive: true,
};

describe('MemberHome', () => {
  it('shows dues status and a pay link when lapsed', () => {
    const { container } = render(<MemberHome summary={summary} duesDeployed />);
    expect(
      container.querySelector('[data-test="member-home-dues-status"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-test="member-home-pay-link"]')
        ?.getAttribute('href'),
    ).toBe('/home/checkout');
  });

  it('has no pay link when current', () => {
    const { container } = render(
      <MemberHome
        summary={{
          ...summary,
          duesStatus: 'current',
          paidThrough: '2027-06-01',
        }}
        duesDeployed
      />,
    );
    expect(
      container.querySelector('[data-test="member-home-pay-link"]'),
    ).toBeNull();
  });

  it('explains when the account has no member record', () => {
    const { container } = render(<MemberHome summary={null} duesDeployed />);
    expect(
      container.querySelector('[data-test="member-home-no-member"]'),
    ).not.toBeNull();
  });

  it('shows only the links before dues are deployed', () => {
    const { container } = render(
      <MemberHome summary={null} duesDeployed={false} />,
    );
    expect(
      container.querySelector('[data-test="member-home-no-member"]'),
    ).toBeNull();
    expect(container.querySelector('a[href="/home/payments"]')).not.toBeNull();
  });
});
