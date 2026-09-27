import type { RosterRecord } from '../types/roster';

export type PlanAction = 'create' | 'update' | 'nochange' | 'skip';

export interface ExistingMember {
  membershipNumber: string;
  primaryEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  /**
   * Supreme's bad-address marker as currently stored. Unlike every other
   * field this one is authoritative in the file rather than in the database —
   * the upsert writes `excluded.bad_address` rather than coalescing it — so
   * the planner needs its value, not merely whether it is filled.
   */
  badAddress: boolean;
  /** Field names that already hold a value, so must not be overwritten. */
  filledFields: string[];
}

/**
 * Why a field is being reported rather than written.
 *
 * `already-set` is by far the most common — a steady-state re-import of the
 * real roster emits thousands of them — and it is not a disagreement at all,
 * merely "this field already holds something, so nothing is written". The
 * other two are genuine and few. Without this discriminator the only way to
 * tell them apart is to string-match the sentinels in `stored`, which live in
 * this file and would break the preview's grouping the day someone reworded
 * them.
 */
export type PlanConflictKind =
  | 'already-set'
  | 'value-differs'
  | 'owned-by-another-member'
  /**
   * Two membership numbers in the file claimed this address and the planner
   * awarded it here on a tie-break it cannot verify. Reported on the WINNING
   * row: the officer knows which of their members transferred out, and this
   * is the only place that fact can enter the decision.
   */
  | 'awarded-contested-email';

export interface PlanConflict {
  field: string;
  kind: PlanConflictKind;
  incoming: string;
  stored: string;
}

export interface PlanRow {
  membershipNumber: string;
  displayName: string;
  /**
   * The row number the officer sees in Excel, so a reported row can actually
   * be found in a 372-row spreadsheet. Carried on every row and especially on
   * skips, which are the rows somebody has to go and look at: "two rows in
   * the file share this email" is unactionable without it.
   *
   * Optional because a `PlanRow` need not have a source file behind it.
   */
  sourceRow?: number;
  action: PlanAction;
  reason?: string;
  /**
   * This row will give a known member the address the council does not hold —
   * and therefore, for the first time, an account they can sign in with.
   *
   * Decided here rather than re-derived by the apply step, for three reasons.
   * It already requires `!collision`, so it can never hand a member an address
   * another member owns. It is persisted with the plan, so the preview can say
   * "will create an account" before anybody presses apply — which is the whole
   * point of a preview, and which asking "does this row have an email?" at
   * apply time cannot do. And it is narrow: the alternative fires a
   * `createUser` for all 372 rows into Supabase's auth rate limit every month,
   * 370 of them doomed.
   *
   * Absent on `create` rows, which acquire an account by being creates, and on
   * rows for members who already have an address on file.
   */
  fillsPrimaryEmail?: boolean;
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
 *
 * `as const satisfies` rather than a `readonly (keyof RosterRecord)[]`
 * annotation: the constraint is still checked, but the literal names survive
 * into the type, so whoever produces `filledFields` can key an exhaustive
 * mapping off this list and have the compiler reject a name that drifted.
 * Annotating it widened every entry to `keyof RosterRecord` and threw that
 * away.
 */
export const FILLABLE = [
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
] as const satisfies readonly (keyof RosterRecord)[];

/** A contact field an import may fill. */
export type FillableField = (typeof FILLABLE)[number];

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

interface EmailVerdict {
  /** The membership number allowed to keep the address, or null for nobody. */
  winner: string | null;
  /**
   * The rival claimants to disclose on the winning row — populated ONLY when
   * the winner was chosen by a tie-break this module cannot verify. Empty
   * when the council's own record decided it (nothing was guessed) and when
   * nobody won (nothing was awarded), so a non-empty list means exactly one
   * thing: a guess was made and the officer needs to see it.
   */
  disclose: string[];
}

/**
 * Emails claimed by more than one membership number in the same file, mapped
 * to the single number allowed to keep it — or `null` when nobody is.
 *
 * Deduplicating an email first-wins lets pure spreadsheet order decide who is
 * real. On a populated council the stored-owner check catches the impostor,
 * but the go-live import runs against an EMPTY council, where there is nothing
 * to check against and the real member is skipped whenever their row happens
 * to sort second. So: prefer the number the council already knows, and where
 * it knows neither, skip both and say so. Creating the wrong member is worse
 * than creating neither and telling the officer where to look.
 *
 * Rows sharing an email AND a membership number are not contested — that is
 * one member listed twice, which the membership-number check handles.
 *
 * Adjudicated in three steps, over EVERY listing rather than each number's
 * first one:
 *
 *   (a) if the council already knows an owner among the claimants, the owner
 *       wins — the stored roster outranks anything the file asserts;
 *   (b) otherwise the winner is the unique claimant for whom this is its ONLY
 *       address in the file. A member who appears once, giving one address, is
 *       making a coherent claim; a member listed twice under two different
 *       addresses is not, and must not cost the coherent one their import;
 *   (c) if two or more claimants are sole-address claimants, or none is, skip
 *       them all. Creating the wrong member is worse than creating neither.
 *
 * Every input is a set, so the verdict does not depend on row order at all —
 * which member ends up created is a property of the file's contents rather
 * than of how the spreadsheet happened to be sorted. Earlier attempts weighed
 * only each number's first listing, which fixed one injustice by creating
 * another: a promoted repeat listing could outrank another member's sole
 * listing and walk off with their address, and at go-live that address is the
 * auth identity.
 *
 * (a) and (c) are decisions. **(b) is a policy tie-break, and it can be
 * wrong.** It assumes a number listed once is likelier to own the address than
 * a number listed twice — but a stale row for a transferred-out member is
 * exactly the thing that appears once, and a current member with a typo'd
 * second listing is exactly the thing that appears twice. Those two have
 * IDENTICAL shape in the file, so no rule can separate them, and dropping (b)
 * simply moves the harm onto the honest single-listed member instead.
 *
 * So (b) guesses, deterministically, and then SAYS SO: every award under (b)
 * puts an `awarded-contested-email` conflict on the winning row naming the
 * rival claimant. The officer knows which of their members transferred out and
 * this module cannot; giving them the fact is the whole point of a preview.
 * Do not let this become silent again — a clean-looking `create` that quietly
 * handed one member's address to another is the exact failure this reports.
 *
 * What is genuinely undecidable, as a property of the data rather than of this
 * rule: the file does not say which of a twice-listed member's addresses is
 * the real one, nor which of two identically-shaped claimants is the live
 * member.
 */
function contestedEmails(
  records: RosterRecord[],
  byEmail: Map<string, ExistingMember>,
): Map<string, EmailVerdict> {
  const numbersByEmail = new Map<string, Set<string>>();
  const emailsByNumber = new Map<string, Set<string>>();

  for (const record of records) {
    const key = emailKey(record.primaryEmail);
    if (key === null) continue;

    const numbers = numbersByEmail.get(key) ?? new Set<string>();

    numbers.add(record.membershipNumber);
    numbersByEmail.set(key, numbers);

    const emails =
      emailsByNumber.get(record.membershipNumber) ?? new Set<string>();

    emails.add(key);
    emailsByNumber.set(record.membershipNumber, emails);
  }

  const contested = new Map<string, EmailVerdict>();

  for (const [key, claimants] of numbersByEmail) {
    if (claimants.size < 2) continue;

    // (a) The council already knows whose address this is. Established, not
    // guessed, so there is nothing to disclose on the winner.
    const owner = byEmail.get(key);

    if (owner && claimants.has(owner.membershipNumber)) {
      contested.set(key, { winner: owner.membershipNumber, disclose: [] });
      continue;
    }

    // (b) A claimant giving exactly one address is making a coherent claim.
    const soleAddress = [...claimants].filter(
      (number) => emailsByNumber.get(number)?.size === 1,
    );

    if (soleAddress.length === 1) {
      const winner = soleAddress[0]!;

      contested.set(key, {
        winner,
        // The tie-break cannot be verified from the file, so it is disclosed.
        disclose: [...claimants].filter((number) => number !== winner).sort(),
      });
      continue;
    }

    // (c) Two claimants qualify, or none does: nobody gets it, so nothing is
    // awarded and there is nothing to disclose.
    contested.set(key, { winner: null, disclose: [] });
  }

  return contested;
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

  const contested = contestedEmails(records, byEmail);

  const seenNumbers = new Set<string>();
  const rows: PlanRow[] = [];

  for (const record of records) {
    const displayName = `${record.firstName} ${record.lastName}`.trim();
    // Taken from the record under examination, not from the row being built,
    // so a skip points at the offending row rather than the one that kept the
    // membership number.
    const base = {
      membershipNumber: record.membershipNumber,
      displayName,
      sourceRow: record.sourceRow,
    };
    const incomingEmail = emailKey(record.primaryEmail);

    // A skipped row deliberately carries no `record`: nothing downstream can
    // then apply it by filtering on anything other than the action.
    //
    // Contested emails are resolved BEFORE the membership number is claimed.
    // A row skipped here was never planned, so it must not consume its number
    // -- otherwise the member's own good row, further down the file, is
    // skipped afterwards as a "duplicate" of a row that does not exist.
    // Set when this row WINS a contested address on a tie-break the planner
    // cannot verify, so the award travels with the row it benefits.
    let awarded: PlanConflict | null = null;

    if (incomingEmail !== null && contested.has(incomingEmail)) {
      const verdict = contested.get(incomingEmail)!;

      if (verdict.winner !== record.membershipNumber) {
        rows.push({
          ...base,
          action: 'skip',
          // A row whose number an earlier row already claimed is a repeat
          // listing first and an email loser second. The officer needs the
          // reason that tells them what to do with the row.
          reason: seenNumbers.has(record.membershipNumber)
            ? 'Duplicate row in file'
            : verdict.winner === null
              ? 'Two rows in the file share this email'
              : 'Duplicate email in file',
          conflicts: [],
        });
        continue;
      }

      if (verdict.disclose.length > 0 && record.primaryEmail !== null) {
        awarded = {
          field: 'primaryEmail',
          kind: 'awarded-contested-email',
          incoming: record.primaryEmail,
          stored: `(also claimed in this file by member ${verdict.disclose.join(', ')})`,
        };
      }
    }

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
      rows.push({
        ...base,
        action: 'create',
        conflicts: awarded ? [awarded] : [],
        record,
      });
      continue;
    }

    const conflicts: PlanConflict[] = awarded ? [awarded] : [];

    for (const field of NEVER_AUTO_UPDATED) {
      const incoming = record[field];
      const stored =
        field === 'primaryEmail'
          ? match.primaryEmail
          : field === 'firstName'
            ? match.firstName
            : match.lastName;

      if (typeof incoming !== 'string' || stored === null) continue;

      // A whitespace-only stored email is BLANK, not a disagreement -- the
      // fill below handles it. Guarding on `!stored` alone reports a member
      // as disagreeing with '   ' while simultaneously filling it.
      const blank =
        field === 'primaryEmail' ? emailKey(stored) === null : stored === '';

      if (blank) continue;

      const differs =
        field === 'primaryEmail'
          ? emailKey(incoming) !== emailKey(stored)
          : incoming !== stored;

      if (differs)
        conflicts.push({ field, kind: 'value-differs', incoming, stored });
    }

    // The number is known, so the row is not skipped above -- but the email
    // in the file is somebody else's, and that must not be invisible in the
    // preview merely because the row is an update.
    if (collision && record.primaryEmail !== null) {
      conflicts.push({
        field: 'primaryEmail',
        kind: 'owned-by-another-member',
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
          kind: 'already-set',
          incoming:
            typeof incoming === 'string' ? incoming : JSON.stringify(incoming),
          stored: '(already set)',
        });
        continue;
      }

      hasSomethingToFill = true;
    }

    // A blank stored email is rule 1's business, not rule 3's. Rule 3 governs
    // a CHANGED email; nothing has changed here, there is simply nothing on
    // file. Left out of the decision entirely (as it was) the row lands in
    // `nochange`, which the apply step skips, so the member could never
    // acquire an address through an import and nothing anywhere said so --
    // structurally the same defect as the bad-address flag.
    //
    // Never when the address is somebody else's: filling a blank with an email
    // another member already holds is precisely the merge the collision check
    // above exists to prevent.
    const fillsPrimaryEmail =
      emailKey(match.primaryEmail) === null &&
      incomingEmail !== null &&
      !collision;

    // The bad-address flag is the council's signal that a member's mail
    // bounces, and it exists to be acted on. It is neither a fill-blanks
    // candidate nor a conflict: the file always wins, in both directions, and
    // a cleared flag matters as much as a set one because it means mail works
    // again. But the apply step skips `nochange` rows entirely, so without
    // this a changed flag on an otherwise fully-populated member would never
    // reach the upsert -- which is exactly what a steady-state monthly
    // re-import produces.
    const badAddressChanged = record.badAddress !== match.badAddress;

    rows.push({
      ...base,
      // Carried into the plan rather than recomputed downstream: this is the
      // only signal that says a member is about to become an account holder.
      fillsPrimaryEmail,
      action:
        hasSomethingToFill || badAddressChanged || fillsPrimaryEmail
          ? 'update'
          : 'nochange',
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
