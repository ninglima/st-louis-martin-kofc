import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberHome } from './member-home';

const duesCard = <section data-test="dues-slot" />;
const volunteerCard = <section data-test="volunteer-slot" />;

describe('MemberHome', () => {
  it('puts the dues card and the volunteering card side by side', () => {
    const { container } = render(
      <MemberHome
        duesDeployed
        linked
        duesCard={duesCard}
        volunteerCard={volunteerCard}
      />,
    );
    const grid = container.querySelector('[data-test="member-home-cards"]');

    expect(grid?.className).toContain('md:grid-cols-2');
    expect(
      grid?.querySelector(
        '[data-test="dues-slot"] + [data-test="volunteer-slot"]',
      ),
    ).not.toBeNull();
  });

  it('gives the dues card the full width when there is no volunteering card', () => {
    const { container } = render(
      <MemberHome duesDeployed linked duesCard={duesCard} />,
    );

    expect(
      container.querySelector('[data-test="member-home-cards"]')?.className,
    ).not.toContain('md:grid-cols-2');
  });

  it('has no separate Payments or Settings buttons', () => {
    const { container } = render(
      <MemberHome duesDeployed linked duesCard={duesCard} />,
    );

    expect(container.querySelector('a[href="/home/settings"]')).toBeNull();
    expect(container.querySelector('a[href="/home/payments"]')).toBeNull();
  });

  it('explains when the account has no member record', () => {
    const { container } = render(
      <MemberHome duesDeployed linked={false} duesCard={duesCard} />,
    );
    expect(
      container.querySelector('[data-test="member-home-no-member"]'),
    ).not.toBeNull();
  });

  it('says nothing about linking before dues are deployed', () => {
    const { container } = render(
      <MemberHome duesDeployed={false} linked={false} duesCard={duesCard} />,
    );
    expect(
      container.querySelector('[data-test="member-home-no-member"]'),
    ).toBeNull();
  });
});
