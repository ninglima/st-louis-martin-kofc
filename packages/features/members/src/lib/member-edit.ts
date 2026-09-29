import * as z from 'zod';

/** Every field the edit dialog can change, in the order it shows them. */
export const MEMBER_EDIT_FIELDS = [
  'prefix',
  'first_name',
  'middle_name',
  'last_name',
  'suffix',
  'primary_email',
  'email_secondary',
  'phone_cell',
  'phone_residence',
  'phone_business',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'country',
  'secondary_address',
  'bad_address',
] as const;

export type MemberEditField = (typeof MEMBER_EDIT_FIELDS)[number];

type TextField = Exclude<MemberEditField, 'bad_address'>;

export const MEMBER_EDIT_LABELS: Record<MemberEditField, string> = {
  prefix: 'Prefix',
  first_name: 'First name',
  middle_name: 'Middle name',
  last_name: 'Last name',
  suffix: 'Suffix',
  primary_email: 'Primary email',
  email_secondary: 'Secondary email',
  phone_cell: 'Cell phone',
  phone_residence: 'Home phone',
  phone_business: 'Business phone',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  city: 'City',
  state: 'State',
  postal_code: 'Postal code',
  country: 'Country',
  secondary_address: 'Second address',
  bad_address: 'Bad address',
};

/** What the form holds: '' for an empty field, never null. */
export type MemberEditValues = { [K in TextField]: string } & {
  bad_address: boolean;
};

/** What `member_update` receives: only changed fields, null for cleared. */
export type MemberEditChanges = Partial<
  { [K in TextField]: string | null } & { bad_address: boolean }
>;

export interface MemberForEdit {
  membershipNumber: string;
  values: MemberEditValues;
}

// Mirrors `public.member_update`, which stays the authority; this only
// saves the officer a round trip.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function text(field: TextField, max: number) {
  const label = MEMBER_EDIT_LABELS[field];

  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`);
}

function required(field: TextField, max: number) {
  return text(field, max).min(1, `${MEMBER_EDIT_LABELS[field]} is required`);
}

function email(field: TextField) {
  return text(field, 254).refine(
    (value) => value === '' || EMAIL.test(value),
    `${MEMBER_EDIT_LABELS[field]} is not a valid email address`,
  );
}

export const MemberEditSchema = z.object({
  prefix: text('prefix', 100),
  first_name: required('first_name', 100),
  middle_name: text('middle_name', 100),
  last_name: required('last_name', 100),
  suffix: text('suffix', 100),
  primary_email: email('primary_email'),
  email_secondary: email('email_secondary'),
  phone_cell: text('phone_cell', 40),
  phone_residence: text('phone_residence', 40),
  phone_business: text('phone_business', 40),
  address_line1: text('address_line1', 200),
  address_line2: text('address_line2', 200),
  city: text('city', 200),
  state: text('state', 200),
  postal_code: text('postal_code', 20),
  country: text('country', 200),
  secondary_address: text('secondary_address', 500),
  bad_address: z.boolean(),
});

/** A `member_for_edit` row (nulls and all) as form values. */
export function toFormValues(row: Record<string, unknown>): MemberEditValues {
  const form = {} as Record<string, string | boolean>;

  for (const field of MEMBER_EDIT_FIELDS) {
    form[field] =
      field === 'bad_address'
        ? row[field] === true
        : typeof row[field] === 'string'
          ? (row[field] as string)
          : '';
  }

  return form as MemberEditValues;
}

/**
 * The fields that differ, compared after trimming, so re-typing the same
 * value is not a change. A cleared field is sent as null.
 */
export function changedFields(
  initial: MemberEditValues,
  next: MemberEditValues,
): MemberEditChanges {
  const changes: Record<string, string | null | boolean> = {};

  for (const field of MEMBER_EDIT_FIELDS) {
    if (field === 'bad_address') {
      if (initial.bad_address !== next.bad_address) {
        changes.bad_address = next.bad_address;
      }
      continue;
    }

    const before = initial[field].trim();
    const after = next[field].trim();

    if (before !== after) {
      changes[field] = after === '' ? null : after;
    }
  }

  return changes as MemberEditChanges;
}
