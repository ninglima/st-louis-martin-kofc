import { describe, expect, it } from 'vitest';

import { resolvePayers } from './payers';

describe('resolvePayers', () => {
  it('names a payer from their member record, with a link target', () => {
    const payers = resolvePayers(
      ['u1'],
      [{ id: 'm1', user_id: 'u1', first_name: 'John', last_name: 'Smith' }],
      [{ id: 'u1', name: 'jsmith', email: 'john@example.com' }],
    );

    expect(payers).toEqual({ u1: { name: 'John Smith', memberId: 'm1' } });
  });

  it('falls back to the account name, then the email, with no link', () => {
    const payers = resolvePayers(
      ['u2', 'u3'],
      [],
      [
        { id: 'u2', name: 'admin', email: 'admin@example.org' },
        { id: 'u3', name: '', email: 'x@example.org' },
      ],
    );

    expect(payers).toEqual({
      u2: { name: 'admin', memberId: null },
      u3: { name: 'x@example.org', memberId: null },
    });
  });

  it('marks a payer whose sign-in no longer exists', () => {
    expect(resolvePayers(['gone'], [], [])).toEqual({
      gone: { name: 'Deleted user', memberId: null },
    });
  });
});
