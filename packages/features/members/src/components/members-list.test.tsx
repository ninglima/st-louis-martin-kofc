import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { MemberDuesSummary } from '@kit/dues/types';

import type { MemberListRow } from '../server/members.service';
import { hrefFor, MembersList } from './members-list';
import type { AccountFilter } from './members-list';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/home/members',
}));

vi.mock('../server/members-actions', () => ({
  exportMembersAction: vi.fn(),
}));

function member(overrides: Partial<MemberListRow> = {}): MemberListRow {
  return {
    id: 'bd1d9c3a-1111-2222-3333-444455556666',
    membershipNumber: '1000001',
    userId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
    fullName: 'John Smith',
    primaryEmail: 'john@example.com',
    city: 'Ashburn',
    state: 'VA',
    badAddress: false,
    rosterLastSeenAt: '2026-09-23T00:00:00+00:00',
    addressLine1: '1 Oak St',
    postalCode: '20147',
    phone: '(703) 555-0002',
    ...overrides,
  };
}

function duesSummary(
  overrides: Partial<MemberDuesSummary> = {},
): MemberDuesSummary {
  return {
    memberId: 'bd1d9c3a-1111-2222-3333-444455556666',
    duesLevel: 'regular_full',
    levelName: 'Regular',
    amountCents: 5800,
    acceptedOn: '2026-01-01',
    isStudent: false,
    paidThrough: '2027-03-14',
    duesStatus: 'due',
    ...overrides,
  };
}

function render(
  options: {
    members?: MemberListRow[];
    search?: string;
    city?: string;
    account?: AccountFilter;
    cities?: string[];
    dues?: Map<string, MemberDuesSummary>;
  } = {},
) {
  return renderToStaticMarkup(
    <MembersList
      members={options.members ?? [member()]}
      search={options.search ?? ''}
      city={options.city ?? ''}
      account={options.account ?? 'all'}
      cities={options.cities ?? ['Ashburn', 'Saint Louis']}
      page={1}
      pageSize={50}
      hasMore={false}
      dues={options.dues}
    />,
  );
}

describe('MembersList', () => {
  it('marks a record that cannot receive mail', () => {
    const html = render({ members: [member({ primaryEmail: null })] });

    // The spec asks for a marker, not a dash: "no email on file" is why a
    // member never got the newsletter and why the import could not give them
    // a sign-in, whereas an em dash in a column of addresses reads as "not
    // loaded yet".
    expect(html).toContain('data-test="member-no-email"');
    expect(html).toContain('No email');
  });

  it('does not mark a member who has an address', () => {
    const html = render();

    expect(html).not.toContain('data-test="member-no-email"');
    expect(html).toContain('john@example.com');
  });

  it("links the member's name to their detail page", () => {
    const html = render({
      members: [member({ id: 'bd1d9c3a-1111-2222-3333-444455556666' })],
    });

    expect(html).toContain(
      'href="/home/members/bd1d9c3a-1111-2222-3333-444455556666"',
    );
    expect(html).toContain('data-test="member-name-link"');
    expect(html).toContain('>John Smith</a>');
  });

  it('keeps the no-email marker and the no-account badge apart', () => {
    // A member with an account and no address on file. The two facts are
    // different questions and a single badge cannot answer both: this member
    // can sign in and cannot be written to.
    const html = render({
      members: [
        member({
          primaryEmail: null,
          userId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
        }),
      ],
    });

    expect(html).toContain('data-test="member-no-email"');
    expect(html).toContain('data-test="member-has-account"');
    expect(html).not.toContain('data-test="member-no-account"');
  });

  it('offers both filters the spec asks for, unset, in words', () => {
    const html = render();

    expect(html).toContain('data-test="members-city"');
    expect(html).toContain('data-test="members-account"');

    // In words, not in values. A trigger reading `__any__` or `all` is what
    // this control does with no child on its `SelectValue`, and it shipped
    // that way until this test.
    expect(html).toContain('Every city');
    expect(html).toContain('Any account status');
    expect(html).not.toContain('__any__</span>');
  });

  it('shows the filters the URL is actually carrying', () => {
    // Controlled from the URL, so the back button and a shared link put the
    // controls where the rows below them came from.
    const html = render({ city: 'Saint Louis', account: 'no' });

    const city = html.slice(html.indexOf('data-test="members-city"'));
    const account = html.slice(html.indexOf('data-test="members-account"'));

    expect(city.slice(0, 2_000)).toContain('Saint Louis');
    expect(account.slice(0, 2_000)).toContain('No account');
    expect(html).not.toContain('>no</span>');
  });

  it('keeps both filters on the next-page link', () => {
    const html = render({ city: 'Saint Louis', account: 'no' });

    // Rendered rather than only unit-tested through `hrefFor`: the link is
    // what an officer clicks, and a filter dropped between the two is a
    // roster that silently widens on page 2.
    expect(html).toContain(
      'href="/home/members?city=Saint+Louis&amp;account=no&amp;page=2"',
    );
  });

  it('shows no dues columns without a dues map -- finance.view is the gate', () => {
    // No `dues` prop at all, the shape a caller without `finance.view` sends.
    // "Paid through" is the header text the column would carry if it were
    // there, so its absence is the whole test.
    const html = render();

    expect(html).not.toContain('Paid through');
    expect(html).not.toContain('data-test="member-dues-status"');
  });

  it('renders the status badge for a member the dues map covers', () => {
    const html = render({
      members: [member({ id: 'bd1d9c3a-1111-2222-3333-444455556666' })],
      dues: new Map([['bd1d9c3a-1111-2222-3333-444455556666', duesSummary()]]),
    });

    expect(html).toContain('Paid through');
    expect(html).toContain('data-test="member-dues-status"');
  });
});

describe('hrefFor', () => {
  const none = { search: '', city: '', account: 'all' as const };

  it('leaves the plain roster without a query string at all', () => {
    expect(hrefFor('/home/members', none, 1)).toBe('/home/members');
  });

  it('carries every filter into a page link', () => {
    // Page 2 of "Smith in Ashburn without an account" has to still be that
    // set. Dropping a filter here silently widens the roster under the
    // officer's feet while the controls above keep claiming otherwise.
    expect(
      hrefFor(
        '/home/members',
        { search: 'smith', city: 'Ashburn', account: 'no' },
        2,
      ),
    ).toBe('/home/members?q=smith&city=Ashburn&account=no&page=2');
  });

  it('omits a filter that is at its default', () => {
    expect(hrefFor('/home/members', { ...none, city: 'Ashburn' }, 1)).toBe(
      '/home/members?city=Ashburn',
    );

    expect(hrefFor('/home/members', { ...none, account: 'yes' }, 1)).toBe(
      '/home/members?account=yes',
    );
  });
});
