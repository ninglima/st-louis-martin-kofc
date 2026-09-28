import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { FILLABLE } from './roster-plan';
import type { ExistingMember, FillableField } from './roster-plan';

/**
 * What the officer has narrowed the roster to.
 *
 * One object rather than three positional arguments, because every one of
 * them is optional and `list(null, null, false, 50, 0)` is a line nobody can
 * read. Every field is nullable and null means "no filter" -- the RPC's own
 * convention, so the two agree by construction rather than by translation.
 */
export interface MemberListFilters {
  /** Matched against membership number, email and both name parts. */
  search?: string | null;
  /** An exact city, chosen from `cities()`. */
  city?: string | null;
  /** `true` has a sign-in account, `false` has none, null is both. */
  hasAccount?: boolean | null;
}

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

/**
 * The member detail page's roster half. Deliberately narrower than
 * `MemberListRow`: it carries only plaintext columns (see `getMember`
 * below), so there is no decrypted address or phone here.
 */
export interface MemberDetail {
  id: string;
  membershipNumber: string;
  userId: string | null;
  fullName: string;
  primaryEmail: string | null;
  city: string | null;
  state: string | null;
  badAddress: boolean;
  rosterLastSeenAt: string | null;
}

/** Columns `getMember` selects directly, all plaintext -- see its doc
 * comment for why decryption never enters into it. */
const DETAIL_SELECT =
  'id, membership_number, user_id, prefix, first_name, middle_name, last_name, suffix, primary_email, city, state, bad_address, roster_last_seen_at';

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
   *
   * `limit` and `offset` are always passed, never left to the RPC's defaults:
   * since 20260923084500 the RPC filters, sorts and limits in an inner query
   * and decrypts in an outer one, so `limit` is the number of rows that get
   * decrypted, not merely the number that come back.
   */
  async list(
    filters: MemberListFilters,
    limit = 50,
    offset = 0,
  ): Promise<MemberListRow[]> {
    const { data, error } = await this.client.rpc('members_list', {
      // The RPC's own default is null; `undefined` omits the argument and gets
      // it, whereas the generated Args type will not accept an explicit null.
      p_search: filters.search ?? undefined,
      p_limit: limit,
      p_offset: offset,
      p_city: filters.city ?? undefined,
      p_has_account: filters.hasAccount ?? undefined,
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
   * One member by id, for the member detail page.
   *
   * Reads `members` directly rather than through `members_list`: that RPC
   * decrypts a page of ciphertext columns and has no id filter, so bending
   * it to find one row would mean decrypting up to 200 rows -- most of them
   * thrown away -- to find the one that matches. `members_select_own`
   * already grants `members.view` holders (and a member their own row) read
   * access here, and every column this selects is plaintext, so there is
   * nothing to decrypt at all. It returns `null` rather than throwing on a
   * missing id -- the caller (the page) turns that into `notFound()`, which
   * is a normal outcome and not an error.
   */
  async getMember(id: string): Promise<MemberDetail | null> {
    const { data, error } = await this.client
      .from('members')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
      id: data.id,
      membershipNumber: data.membership_number,
      userId: data.user_id,
      fullName: [
        data.prefix,
        data.first_name,
        data.middle_name,
        data.last_name,
        data.suffix,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' '),
      primaryEmail: data.primary_email,
      city: data.city,
      state: data.state,
      badAddress: data.bad_address,
      rosterLastSeenAt: data.roster_last_seen_at,
    };
  }

  /**
   * The cities the council's members live in, for the list's city filter.
   *
   * Its own RPC rather than something derived from the rows on screen: the
   * screen holds 50 of 372, so a filter built from it could only ever offer
   * the places that happen to be on this page — and the one city the officer
   * is looking for is the one that is not.
   */
  async cities(): Promise<string[]> {
    const { data, error } = await this.client.rpc('members_cities');

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => row.city);
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
