import { describe, expect, it } from 'vitest';

import { fakeClient, fullMemberRow } from '../../test/fixtures/fake-supabase';
import { MembersService } from './members.service';
import { FILLABLE } from './roster-plan';

/**
 * The column each planner field is expected to be read from, stated here
 * independently of the service so that a mapping pointed at the WRONG (but
 * real) column is caught. The compiler already rejects a column that does not
 * exist; only a test can reject `city -> state`.
 */
const EXPECTED_COLUMN: Record<string, string> = {
  prefix: 'prefix',
  middleName: 'middle_name',
  suffix: 'suffix',
  addressLine1: 'address_line1_enc',
  addressLine2: 'address_line2_enc',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code_enc',
  country: 'country',
  primaryType: 'primary_type',
  phoneCell: 'phone_cell_enc',
  phoneResidence: 'phone_residence_enc',
  phoneBusiness: 'phone_business_enc',
  emailSecondary: 'email_secondary_enc',
  secondaryAddress: 'secondary_address_enc',
};

async function planningRows(rows: Record<string, unknown>[]) {
  const fake = fakeClient({ rows });
  const members = await new MembersService(fake.client).existingForPlanning();

  return { members, fake };
}

describe('MembersService.existingForPlanning', () => {
  it('reports exactly the field names the planner fills, and no others', async () => {
    // The agreement between `filledFields` and `FILLABLE` is string equality
    // at runtime and nothing at all at compile time. A name that drifts does
    // not fail anywhere: the planner asks `filled.has('phoneCell')` about a
    // set containing only `phone_cell`, gets false, and proposes a write over
    // a value the member typed themselves.
    const { members } = await planningRows([fullMemberRow()]);

    expect([...members[0]!.filledFields].sort()).toEqual([...FILLABLE].sort());
  });

  it('agrees with the independently stated field-to-column mapping', () => {
    expect(Object.keys(EXPECTED_COLUMN).sort()).toEqual([...FILLABLE].sort());
  });

  it.each(Object.entries(EXPECTED_COLUMN))(
    'reads %s from %s, so a blank there is the only field left unfilled',
    async (field, column) => {
      const { members } = await planningRows([
        fullMemberRow({ [column]: null }),
      ]);

      expect([...members[0]!.filledFields].sort()).toEqual(
        [...FILLABLE].filter((name) => name !== field).sort(),
      );
    },
  );

  it('treats an empty string as blank, not as a value to protect', async () => {
    // pgp_sym_encrypt('') is a non-null ciphertext, and a plaintext column can
    // hold ''. Counting either as filled would make the field unfillable for
    // ever.
    const { members } = await planningRows([
      fullMemberRow({ city: '', phone_cell_enc: '' }),
    ]);

    expect(members[0]!.filledFields).not.toContain('city');
    expect(members[0]!.filledFields).not.toContain('phoneCell');
  });

  it('carries bad_address as a value, not as a filled-field entry', async () => {
    // The planner compares this flag rather than asking whether it is
    // populated: Supreme owns it and a cleared flag matters as much as a set
    // one. Listing it in filledFields would say nothing about its value.
    const { members } = await planningRows([
      fullMemberRow({ membership_number: '1000001', bad_address: true }),
      fullMemberRow({ membership_number: '1000002', bad_address: false }),
    ]);

    expect(members[0]!.badAddress).toBe(true);
    expect(members[1]!.badAddress).toBe(false);
    expect(members[0]!.filledFields).not.toContain('badAddress');
    expect(members[1]!.filledFields).not.toContain('badAddress');
  });

  it('carries the identity fields the planner matches and compares on', async () => {
    const { members } = await planningRows([
      fullMemberRow({ primary_email: null }),
    ]);

    expect(members[0]).toMatchObject({
      membershipNumber: '1000001',
      primaryEmail: null,
      firstName: 'Stored',
      lastName: 'Member',
    });
  });

  it('asks for every column it reads', async () => {
    const { fake } = await planningRows([fullMemberRow()]);
    const requested = fake.selects[0]!.columns.split(',').map((c) => c.trim());

    expect(fake.selects[0]!.table).toBe('members');

    for (const column of [
      'membership_number',
      'primary_email',
      'first_name',
      'last_name',
      'bad_address',
      ...Object.values(EXPECTED_COLUMN),
    ])
      expect(requested).toContain(column);
  });

  it('throws rather than reporting an empty roster when the read fails', async () => {
    // A swallowed error here reads as "the council has no members", which the
    // planner would turn into a create for every single row.
    const fake = fakeClient({ selectError: { message: 'permission denied' } });

    await expect(
      new MembersService(fake.client).existingForPlanning(),
    ).rejects.toThrow('permission denied');
  });
});

describe('MembersService.list', () => {
  const listRow = {
    id: 'id-1',
    membership_number: '1000001',
    user_id: null,
    full_name: 'Mr Stored Q Member Jr',
    primary_email: 'stored@example.com',
    city: 'Saint Louis',
    state: 'MO',
    bad_address: true,
    roster_last_seen_at: '2026-09-01T00:00:00Z',
    address_line1: '1 Main St',
    postal_code: '63101',
    phone: '314-555-0100',
  };

  it('maps the RPC row onto the list shape', async () => {
    const fake = fakeClient({ rpcData: [listRow] });
    const rows = await new MembersService(fake.client).list(null);

    expect(fake.rpcs[0]!.name).toBe('members_list');
    expect(rows).toEqual([
      {
        id: 'id-1',
        membershipNumber: '1000001',
        userId: null,
        fullName: 'Mr Stored Q Member Jr',
        primaryEmail: 'stored@example.com',
        city: 'Saint Louis',
        state: 'MO',
        badAddress: true,
        rosterLastSeenAt: '2026-09-01T00:00:00Z',
        addressLine1: '1 Main St',
        postalCode: '63101',
        phone: '314-555-0100',
      },
    ]);
  });

  it('passes the search, limit and offset through', async () => {
    const fake = fakeClient({ rpcData: [] });

    await new MembersService(fake.client).list('smith', 25, 50);

    expect(fake.rpcs[0]!.args).toEqual({
      p_search: 'smith',
      p_limit: 25,
      p_offset: 50,
    });
  });

  it('omits the search argument rather than sending an explicit null', async () => {
    const fake = fakeClient({ rpcData: [] });

    await new MembersService(fake.client).list(null);

    expect(fake.rpcs[0]!.args.p_search).toBeUndefined();
    expect(fake.rpcs[0]!.args).toMatchObject({ p_limit: 50, p_offset: 0 });
  });

  it('throws when the RPC fails', async () => {
    const fake = fakeClient({ rpcError: () => ({ message: 'nope' }) });

    await expect(new MembersService(fake.client).list(null)).rejects.toThrow(
      'nope',
    );
  });
});
