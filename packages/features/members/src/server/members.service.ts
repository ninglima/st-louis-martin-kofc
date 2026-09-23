import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { FILLABLE } from './roster-plan';
import type { ExistingMember, FillableField } from './roster-plan';

export interface MemberListRow {
  id: string;
  membershipNumber: string;
  userId: string | null;
  fullName: string;
  primaryEmail: string | null;
  city: string | null;
  state: string | null;
  badAddress: boolean;
  rosterLastSeenAt: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  phone: string | null;
}

type MemberColumn = keyof Database['public']['Tables']['members']['Row'];

/**
 * The planner's field names mapped to the column that holds each one.
 *
 * This mapping is the weakest link in fill-blanks-only: it is compared to
 * `FILLABLE` by string equality at runtime, and a name that drifts (`phoneCell`
 * written as `phone_cell`, or an entry simply left out) does not fail — it
 * silently makes that field look permanently blank, so every import overwrites
 * it. So the agreement is made a compile error instead of a convention:
 *
 *   - `satisfies Record<FillableField, MemberColumn>` rejects a missing key, an
 *     extra key, and a value that is not a real column of `members`;
 *   - `as const` keeps the column names as literals, so the lookup below
 *     (`row[FILLABLE_COLUMN[field]]`) only compiles while every mapped column
 *     is actually named in `EXISTING_SELECT`.
 *
 * Adding a field to `FILLABLE` therefore breaks the build here until it is
 * mapped and selected, which is the point.
 */
const FILLABLE_COLUMN = {
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
} as const satisfies Record<FillableField, MemberColumn>;

/**
 * Identity and decision columns, then every column named in `FILLABLE_COLUMN`.
 * Kept as a literal so postgrest types the row: that typing is what makes a
 * mapped-but-unselected column a compile error rather than a field that reads
 * as blank forever.
 */
const EXISTING_SELECT =
  'membership_number, primary_email, first_name, last_name, bad_address, prefix, middle_name, suffix, city, state, country, primary_type, address_line1_enc, address_line2_enc, postal_code_enc, phone_cell_enc, phone_residence_enc, phone_business_enc, email_secondary_enc, secondary_address_enc';

export class MembersService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Reads go through the `members_list` RPC rather than the table, because the
   * encrypted columns are only readable inside that security definer function
   * — the app never holds the key.
   */
  async list(
    search: string | null,
    limit = 50,
    offset = 0,
  ): Promise<MemberListRow[]> {
    const { data, error } = await this.client.rpc('members_list', {
      // The RPC's own default is null; `undefined` omits the argument and gets
      // it, whereas the generated Args type will not accept an explicit null.
      p_search: search ?? undefined,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      membershipNumber: row.membership_number,
      userId: row.user_id,
      fullName: row.full_name,
      primaryEmail: row.primary_email,
      city: row.city,
      state: row.state,
      badAddress: row.bad_address,
      rosterLastSeenAt: row.roster_last_seen_at,
      addressLine1: row.address_line1,
      postalCode: row.postal_code,
      phone: row.phone,
    }));
  }

  /**
   * The planner needs to know which fields already hold a value so it can
   * honour fill-blanks-only. Encrypted columns are reported as filled/empty
   * without being decrypted — `is not null` needs no key.
   *
   * `badAddress` is deliberately a value and not a `filledFields` entry: it is
   * the one field Supreme owns outright, so the planner compares it rather than
   * asking whether it is populated.
   */
  async existingForPlanning(): Promise<ExistingMember[]> {
    const { data, error } = await this.client
      .from('members')
      .select(EXISTING_SELECT);

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => {
      const filledFields: string[] = [];

      // Driven by FILLABLE itself, not by a hand-written list that has to be
      // kept in step with it.
      for (const field of FILLABLE) {
        const value = row[FILLABLE_COLUMN[field]];

        if (value !== null && value !== undefined && value !== '')
          filledFields.push(field);
      }

      return {
        membershipNumber: row.membership_number,
        primaryEmail: row.primary_email,
        firstName: row.first_name,
        lastName: row.last_name,
        // `bad_address` is `not null default false` in the schema, so there is
        // no nullish case to absorb; swallowing one with `?? false` would only
        // hide the day that stopped being true.
        badAddress: row.bad_address,
        filledFields,
      };
    });
  }
}
