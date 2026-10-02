import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberHome } from './member-home';

const TODAY = '2026-10-02';

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

function text(container: HTMLElement, test: string): string | null {
  return container.querySelector(`[data-test="${test}"]`)?.textContent ?? null;
}

describe('MemberHome', () => {
  it('says plainly that lapsed dues are past due, with a pay link', () => {
    const { container } = render(
      <MemberHome summary={summary} duesDeployed today={TODAY} />,
    );
    expect(
      container.querySelector('[data-test="member-home-dues-status"]'),
    ).not.toBeNull();
    expect(text(container, 'member-home-dues-headline')).toBe(
      'Your dues are past due',
    );
    expect(text(container, 'member-home-dues-detail')).toBe(
      'Expired January 1, 2026 (274 days ago) · $50.00',
    );
    expect(
      container
        .querySelector('[data-test="member-home-pay-link"]')
        ?.getAttribute('href'),
    ).toBe('/home/checkout');
    expect(
      container
        .querySelector('[data-test="member-home-dues"]')
        ?.getAttribute('data-tone'),
    ).toBe('owed');
  });

  it('says the dues are paid, with no pay link, when current', () => {
    const { container } = render(
      <MemberHome
        summary={{
          ...summary,
          duesStatus: 'current',
          paidThrough: '2027-06-01',
        }}
        duesDeployed
        today={TODAY}
      />,
    );
    expect(text(container, 'member-home-dues-headline')).toBe(
      'Your dues are paid',
    );
    expect(text(container, 'member-home-dues-detail')).toBe(
      'Paid until June 1, 2027',
    );
    expect(
      container.querySelector('[data-test="member-home-pay-link"]'),
    ).toBeNull();
  });

  it('offers payment, and allows for an unrecorded payment, when there is no record', () => {
    const { container } = render(
      <MemberHome
        summary={{
          ...summary,
          duesStatus: 'no_record',
          paidThrough: null,
          acceptedOn: null,
        }}
        duesDeployed
        today={TODAY}
      />,
    );
    expect(text(container, 'member-home-dues-headline')).toBe(
      'We have no record of your dues payment',
    );
    expect(text(container, 'member-home-dues-note')).toContain(
      'Financial Secretary',
    );
    expect(
      container.querySelector('[data-test="member-home-pay-link"]'),
    ).not.toBeNull();
  });

  it('links to the payment history', () => {
    const { container } = render(
      <MemberHome summary={summary} duesDeployed today={TODAY} />,
    );
    expect(
      container
        .querySelector('[data-test="member-home-dues-history"]')
        ?.getAttribute('href'),
    ).toBe('/home/payments');
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
