import type {
  ImportPlan,
  PlanConflict,
  PlanConflictKind,
  PlanRow,
} from '../server/roster-plan';

/** One conflict together with the row it was reported on. */
export interface ConflictEntry {
  row: PlanRow;
  conflict: PlanConflict;
}

/**
 * A membership number the file will not import at all, with every row that
 * mentions it.
 */
export interface BlockedMember {
  membershipNumber: string;
  displayName: string;
  rows: { sourceRow?: number; reason: string }[];
}

export interface PlanSummary {
  /**
   * The planner guessed. Kept first and kept separate because it is the only
   * thing on this screen that can quietly give one member another member's
   * sign-in identity, and the officer is the only party who knows which of the
   * two claimants actually transferred out.
   */
  awarded: ConflictEntry[];
  /**
   * `value-differs` and `owned-by-another-member`: few, genuine, and each one
   * a human decision. Shown inline and never collapsed.
   */
  attention: ConflictEntry[];
  /**
   * `already-set`: "this field is filled, so nothing was written". A
   * steady-state re-import of the real roster emits these in the thousands
   * while changing nothing, so they go behind a disclosure with a count.
   * Hiding them entirely would be wrong -- an officer reconciling a member's
   * address needs them -- but showing them inline buries the four lines above.
   */
  alreadySet: ConflictEntry[];
  skips: PlanRow[];
  /**
   * Members no row in this file will import. Not a skip count: a skipped
   * duplicate row is harmless when the member is imported by another row,
   * whereas these people are absent from the council's records today, will
   * still be absent after this import, and will still be absent next month.
   * Only correcting the spreadsheet changes that, so it is a task for a human.
   */
  blocked: BlockedMember[];
  /**
   * Rows that will hand a member an account they can sign in with. At go-live
   * the email IS the auth identity, so this is the number that says how many
   * people this import lets through the front door.
   */
  newAccounts: number;
  /** Rows the apply step will actually write. */
  writableRows: number;
}

function conflictsOfKind(
  entries: ConflictEntry[],
  ...kinds: PlanConflictKind[]
): ConflictEntry[] {
  return entries.filter((entry) => kinds.includes(entry.conflict.kind));
}

/**
 * Turns a plan into the groups the preview renders.
 *
 * Grouped by `kind` and never by field name. The kinds mean entirely different
 * things -- one is noise, three are decisions -- and only the discriminator
 * says which is which. Grouping by field would file an `already-set` middle
 * name beside an `awarded-contested-email` under "primaryEmail" and lose both.
 */
export function summarizePlan(plan: ImportPlan): PlanSummary {
  const entries: ConflictEntry[] = plan.rows.flatMap((row) =>
    row.conflicts.map((conflict) => ({ row, conflict })),
  );

  const skips = plan.rows.filter((row) => row.action === 'skip');

  // A number is only blocked if NOTHING imports it. The planner skips a
  // member's repeat listing by design, and reporting that member as blocked
  // -- when their own good row imports them two lines earlier -- would send an
  // officer to fix a file that is already right.
  const imported = new Set(
    plan.rows
      .filter((row) => row.action !== 'skip')
      .map((row) => row.membershipNumber),
  );

  const blocked = new Map<string, BlockedMember>();

  for (const row of skips) {
    if (imported.has(row.membershipNumber)) continue;

    const entry = blocked.get(row.membershipNumber) ?? {
      membershipNumber: row.membershipNumber,
      displayName: row.displayName,
      rows: [],
    };

    entry.rows.push({
      sourceRow: row.sourceRow,
      reason: row.reason ?? 'Skipped',
    });

    blocked.set(row.membershipNumber, entry);
  }

  // A create only becomes an account if the row carries an address; a member
  // imported without one gets a record and no way in.
  const newAccounts = plan.rows.filter(
    (row) =>
      (row.action === 'create' &&
        row.record?.primaryEmail != null &&
        row.record.primaryEmail !== '') ||
      row.fillsPrimaryEmail === true,
  ).length;

  return {
    awarded: conflictsOfKind(entries, 'awarded-contested-email'),
    attention: conflictsOfKind(
      entries,
      'value-differs',
      'owned-by-another-member',
    ),
    alreadySet: conflictsOfKind(entries, 'already-set'),
    skips,
    blocked: [...blocked.values()],
    newAccounts,
    writableRows: plan.counts.create + plan.counts.update,
  };
}

/** Human wording for a conflict kind, for the one-line label on each entry. */
export const CONFLICT_LABELS: Record<PlanConflictKind, string> = {
  'already-set': 'Already set — nothing will be written',
  'value-differs': 'The file disagrees with the record',
  'owned-by-another-member': 'That address belongs to another member',
  'awarded-contested-email': 'Awarded on a guess — check this',
};
