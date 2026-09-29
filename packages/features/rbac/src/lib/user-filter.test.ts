import { describe, expect, it } from 'vitest';

import type { ManagedUser } from '../server/users.service';
import { filterUsers, parseUserFilter } from './user-filter';

function user(overrides: Partial<ManagedUser>): ManagedUser {
  return {
    id: 'id',
    email: 'someone@example.com',
    created_at: '2026-09-01T00:00:00Z',
    is_active: true,
    role_id: 'member',
    role_name: 'Member',
    ...overrides,
  };
}

const USERS = [
  user({ id: 'a', email: 'Grand.Knight@Council.org', role_id: 'admin' }),
  user({ id: 'b', email: 'fs@council.org', is_active: false }),
  user({ id: 'c', email: 'member@example.com' }),
  user({ id: 'd', email: null, role_id: null, role_name: null }),
];

const ids = (users: ManagedUser[]) => users.map((u) => u.id);

describe('filterUsers', () => {
  it('returns everyone with no criteria', () => {
    expect(ids(filterUsers(USERS, parseUserFilter({})))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('matches any part of the email, ignoring case and surrounding spaces', () => {
    expect(
      ids(filterUsers(USERS, { q: '  KNIGHT@c ', role: '', status: 'all' })),
    ).toEqual(['a']);
    expect(
      ids(filterUsers(USERS, { q: 'council', role: '', status: 'all' })),
    ).toEqual(['a', 'b']);
  });

  it('never matches a user without an email on a search', () => {
    expect(
      ids(filterUsers(USERS, { q: 'null', role: '', status: 'all' })),
    ).toEqual([]);
  });

  it('filters by role, and by no role', () => {
    expect(
      ids(filterUsers(USERS, { q: '', role: 'admin', status: 'all' })),
    ).toEqual(['a']);
    expect(
      ids(filterUsers(USERS, { q: '', role: 'none', status: 'all' })),
    ).toEqual(['d']);
  });

  it('filters by status', () => {
    expect(
      ids(filterUsers(USERS, { q: '', role: '', status: 'inactive' })),
    ).toEqual(['b']);
    expect(
      ids(filterUsers(USERS, { q: '', role: '', status: 'active' })),
    ).toEqual(['a', 'c', 'd']);
  });

  it('combines every criterion', () => {
    expect(
      ids(
        filterUsers(USERS, {
          q: 'council',
          role: 'member',
          status: 'inactive',
        }),
      ),
    ).toEqual(['b']);
    expect(
      ids(
        filterUsers(USERS, { q: 'council', role: 'member', status: 'active' }),
      ),
    ).toEqual([]);
  });
});

describe('parseUserFilter', () => {
  it('reads the address bar, falling back on anything unknown', () => {
    expect(
      parseUserFilter({ q: 'fs', role: 'admin', status: 'inactive' }),
    ).toEqual({
      q: 'fs',
      role: 'admin',
      status: 'inactive',
    });
    expect(parseUserFilter({ status: 'banana' })).toEqual({
      q: '',
      role: '',
      status: 'all',
    });
    expect(parseUserFilter({ q: null, role: null, status: null })).toEqual({
      q: '',
      role: '',
      status: 'all',
    });
  });
});
