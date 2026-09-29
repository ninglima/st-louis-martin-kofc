import { describe, expect, it } from 'vitest';

import {
  MEMBER_EDIT_FIELDS,
  MemberEditSchema,
  changedFields,
  toFormValues,
} from './member-edit';
import type { MemberEditValues } from './member-edit';

function values(overrides: Partial<MemberEditValues> = {}): MemberEditValues {
  return {
    ...toFormValues({ first_name: 'Ada', last_name: 'Lovelace' }),
    ...overrides,
  };
}

describe('toFormValues', () => {
  it('turns nulls into empty strings and keeps the flag a boolean', () => {
    const form = toFormValues({
      first_name: 'Ada',
      last_name: 'Lovelace',
      city: null,
      bad_address: true,
    });

    expect(form.city).toBe('');
    expect(form.phone_cell).toBe('');
    expect(form.bad_address).toBe(true);
    expect(Object.keys(form).sort()).toEqual([...MEMBER_EDIT_FIELDS].sort());
  });
});

describe('MemberEditSchema', () => {
  it('trims and accepts a valid member', () => {
    const parsed = MemberEditSchema.parse(values({ first_name: '  Ada ' }));

    expect(parsed.first_name).toBe('Ada');
  });

  it('requires first and last name', () => {
    const result = MemberEditSchema.safeParse(
      values({ first_name: '   ', last_name: '' }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).sort()).toEqual([
      'First name is required',
      'Last name is required',
    ]);
  });

  it('checks email shape but allows a blank email', () => {
    expect(
      MemberEditSchema.safeParse(values({ primary_email: '' })).success,
    ).toBe(true);
    expect(
      MemberEditSchema.safeParse(values({ email_secondary: 'a@b.co' })).success,
    ).toBe(true);

    const bad = MemberEditSchema.safeParse(
      values({ primary_email: 'not-an-email' }),
    );

    expect(bad.error?.issues[0]?.message).toBe(
      'Primary email is not a valid email address',
    );
  });

  it('enforces the length limits', () => {
    const bad = MemberEditSchema.safeParse(
      values({ postal_code: '9'.repeat(21) }),
    );

    expect(bad.error?.issues[0]?.message).toBe(
      'Postal code must be 20 characters or fewer',
    );
    expect(
      MemberEditSchema.safeParse(values({ postal_code: '9'.repeat(20) }))
        .success,
    ).toBe(true);
    expect(
      MemberEditSchema.safeParse(values({ secondary_address: 'x'.repeat(501) }))
        .error?.issues[0]?.message,
    ).toBe('Second address must be 500 characters or fewer');
  });
});

describe('changedFields', () => {
  it('returns nothing when nothing changed, ignoring surrounding spaces', () => {
    const initial = values({ city: 'Ashburn' });

    expect(changedFields(initial, { ...initial, city: ' Ashburn ' })).toEqual(
      {},
    );
  });

  it('returns only the changed fields, with a cleared one as null', () => {
    const initial = values({ city: 'Ashburn', phone_cell: '555-0101' });

    expect(
      changedFields(initial, {
        ...initial,
        city: 'Florissant',
        phone_cell: '',
        bad_address: true,
      }),
    ).toEqual({ city: 'Florissant', phone_cell: null, bad_address: true });
  });
});
