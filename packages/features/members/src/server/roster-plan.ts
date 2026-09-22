import type { RosterRecord } from '../types/roster';

export type PlanAction = 'create' | 'update' | 'nochange' | 'skip';

export interface ExistingMember {
  membershipNumber: string;
  primaryEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Field names that already hold a value, so must not be overwritten. */
  filledFields: string[];
}

export interface PlanConflict {
  field: string;
  incoming: string;
  stored: string;
}

export interface PlanRow {
  membershipNumber: string;
  displayName: string;
  action: PlanAction;
  reason?: string;
  conflicts: PlanConflict[];
  record?: RosterRecord;
}

export interface ImportPlan {
  rows: PlanRow[];
  counts: Record<PlanAction, number>;
  absentFromFile: string[];
}

/**
 * Contact fields an import may fill. Deliberately contains no dues field:
 * an import must never change a member's dues level, expiry or paid-through
 * date, whether or not they currently have one. "No active level" and
 * "lapsed non-payer" are indistinguishable from here, so treating the first
 * as a new member silently marks the second current and empties the list an
 * officer uses to chase them.
 *
 * Exported so the agreement with `ExistingMember.filledFields` — which is
 * string equality at runtime and nothing at all at compile time — can be
 * pinned by a test rather than assumed.
 */
export const FILLABLE: readonly (keyof RosterRecord)[] = [
  'prefix',
  'middleName',
  'suffix',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'primaryType',
  'phoneCell',
  'phoneResidence',
  'phoneBusiness',
  'emailSecondary',
  'secondaryAddress',
];

/** Fields whose change is always a conflict for a human, never an auto-write. */
const NEVER_AUTO_UPDATED: (keyof RosterRecord)[] = [
  'primaryEmail',
  'firstName',
  'lastName',
];

/**
 * Email identity is case-insensitive here even though the string is not:
 * Supabase auth lowercases, and so does the parser, but a row written by any
 * other path may not have. Comparing raw would report a case-only difference
 * as a changed email every month and would fail to recognize the member as
 * the owner of their own address.
 */
function emailKey(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();

  return trimmed === '' ? null : trimmed;
}

export function buildPlan(
  records: RosterRecord[],
  existing: ExistingMember[],
): ImportPlan {
  const byNumber = new Map(existing.map((m) => [m.membershipNumber, m]));
  const byEmail = new Map<string, ExistingMember>();

  for (const member of existing) {
    const key = emailKey(member.primaryEmail);

    if (key !== null && !byEmail.has(key)) byEmail.set(key, member);
  }

  const seenNumbers = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: PlanRow[] = [];

  for (const record of records) {
    const displayName = `${record.firstName} ${record.lastName}`.trim();
    const base = { membershipNumber: record.membershipNumber, displayName };
    const incomingEmail = emailKey(record.primaryEmail);

    // A skipped row deliberately carries no `record`: nothing downstream can
    // then apply it by filtering on anything other than the action.
    if (seenNumbers.has(record.membershipNumber)) {
      rows.push({
        ...base,
        action: 'skip',
        reason: 'Duplicate row in file',
        conflicts: [],
      });
      continue;
    }
    seenNumbers.add(record.membershipNumber);

    if (incomingEmail !== null) {
      if (seenEmails.has(incomingEmail)) {
        rows.push({
          ...base,
          action: 'skip',
          reason: 'Duplicate email in file',
          conflicts: [],
        });
        continue;
      }
      seenEmails.add(incomingEmail);
    }

    const match = byNumber.get(record.membershipNumber);
    const emailOwner =
      incomingEmail === null ? undefined : byEmail.get(incomingEmail);
    const collision =
      emailOwner && emailOwner.membershipNumber !== record.membershipNumber
        ? emailOwner
        : undefined;

    // An email belonging to a *different* member is a collision a human must
    // resolve: silently attaching it would merge two people.
    if (!match && collision) {
      rows.push({
        ...base,
        action: 'skip',
        reason: `That email already belongs to member ${collision.membershipNumber}`,
        conflicts: [],
      });
      continue;
    }

    if (!match) {
      rows.push({ ...base, action: 'create', conflicts: [], record });
      continue;
    }

    const conflicts: PlanConflict[] = [];

    for (const field of NEVER_AUTO_UPDATED) {
      const incoming = record[field];
      const stored =
        field === 'primaryEmail'
          ? match.primaryEmail
          : field === 'firstName'
            ? match.firstName
            : match.lastName;

      if (typeof incoming !== 'string' || !stored) continue;

      const differs =
        field === 'primaryEmail'
          ? emailKey(incoming) !== emailKey(stored)
          : incoming !== stored;

      if (differs) conflicts.push({ field, incoming, stored });
    }

    // The number is known, so the row is not skipped above -- but the email
    // in the file is somebody else's, and that must not be invisible in the
    // preview merely because the row is an update.
    if (collision && record.primaryEmail !== null) {
      conflicts.push({
        field: 'primaryEmail',
        incoming: record.primaryEmail,
        stored: `(already belongs to member ${collision.membershipNumber})`,
      });
    }

    const filled = new Set(match.filledFields);
    let hasSomethingToFill = false;

    for (const field of FILLABLE) {
      const incoming = record[field];
      if (incoming === null || incoming === undefined || incoming === '')
        continue;

      if (filled.has(field)) {
        // Fill blanks only: something is already stored, so nothing is
        // written. Reported so the officer can reconcile it deliberately.
        conflicts.push({
          field,
          incoming:
            typeof incoming === 'string' ? incoming : JSON.stringify(incoming),
          stored: '(already set)',
        });
        continue;
      }

      hasSomethingToFill = true;
    }

    rows.push({
      ...base,
      action: hasSomethingToFill ? 'update' : 'nochange',
      conflicts,
      record,
    });
  }

  const inFile = new Set(records.map((r) => r.membershipNumber));
  const absentFromFile = existing
    .map((m) => m.membershipNumber)
    .filter((number) => !inFile.has(number));

  const counts: Record<PlanAction, number> = {
    create: 0,
    update: 0,
    nochange: 0,
    skip: 0,
  };

  for (const row of rows) counts[row.action]++;

  return { rows, counts, absentFromFile };
}
