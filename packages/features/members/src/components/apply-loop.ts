import type { ApplyResult } from '../server/roster-actions';
import { CHUNK_SIZE } from '../types/roster';

export interface ApplyFailure {
  membershipNumber: string;
  error: string;
}

export interface ApplyProgress {
  /** Plan rows handed to the action so far. Not rows written -- see `applied`. */
  examined: number;
  /** Rows the database actually wrote, as reported by the action. */
  applied: number;
}

/**
 * How the loop ended.
 *
 * `denied` is kept apart from `halted` all the way to the screen. They are the
 * same shape and they mean opposite things: `denied` is "your grant was taken
 * away, ask for it back", `halted` is "the run broke, here is what the action
 * said". Collapsing them sends an officer to audit 372 spreadsheet rows when
 * what they need is a role.
 */
export type ApplyStatus = 'complete' | 'denied' | 'halted';

export interface ApplyOutcome {
  status: ApplyStatus;
  applied: number;
  failures: ApplyFailure[];
  /**
   * The action's message, verbatim, on the two stopping branches. Verbatim
   * because it is often better than anything this layer could say: the
   * "N rows were applied, but the import record could not be updated ...
   * applying it again is safe" message tells the officer the members landed
   * and a re-run is harmless, which a generic "the import failed" would
   * actively contradict.
   */
  error: string | null;
}

/**
 * Whether a failed row is one that will fail again on every future import.
 *
 * `members_user_id_uk` is the one-account-per-member index. A row trips it when
 * the account this member's address resolves to is already linked to a
 * different member -- so the fill can never succeed, the next monthly import
 * produces exactly the same failure, and no amount of re-running changes that.
 * Somebody has to reassign the account by hand.
 *
 * Matched on the constraint name rather than on the prose around it: Postgres
 * owns the sentence, we only own the index name, and the index name is in the
 * message on every Postgres version that reports 23505.
 */
export function needsAccountReassignment(failure: ApplyFailure): boolean {
  return failure.error.includes('members_user_id_uk');
}

/**
 * Applies a previewed plan, one chunk at a time, until the action says it is
 * done or refuses to continue.
 *
 * Extracted from the component and kept free of React so the four rules below
 * can be tested rather than eyeballed. Every one of them is a silent-data-loss
 * bug when broken, and none of them is visible in a screenshot.
 *
 *   1. The step is `CHUNK_SIZE`, imported from the same module the action
 *      slices by. A literal here that drifted from the action's slice would
 *      either skip members (step too big) or never terminate (step too small).
 *
 *   2. Chunks are strictly sequential -- one `await` per iteration, never a
 *      `Promise.all`. The action's running total is a read-modify-write on the
 *      import record, so two chunks in flight at once lose one chunk's counts,
 *      and the officer reads a total that never happened.
 *
 *   3. Any `success: false` ends the loop immediately. There is nothing to
 *      gain from feeding the remaining 340 rows to an import that cannot
 *      write, and on the denied branch there is something to lose: every
 *      refused chunk is another round trip that creates nothing and reports
 *      the same refusal.
 *
 *   4. Whatever was applied before the stop is still returned. A run that
 *      wrote 200 rows and then lost its grant has 200 members in the database;
 *      reporting zero would send somebody looking for them.
 */
export async function runApplyLoop(
  totalRows: number,
  applyChunk: (offset: number) => Promise<ApplyResult>,
  onProgress: (progress: ApplyProgress) => void,
): Promise<ApplyOutcome> {
  let offset = 0;
  let applied = 0;
  const failures: ApplyFailure[] = [];

  // Runs at least once, even for an empty plan: the action is what moves the
  // import record to `complete`, and an import stuck at `previewed` forever is
  // a row an officer will re-run looking for an ending.
  for (;;) {
    const result = await applyChunk(offset);

    if (!result.success) {
      return {
        status: result.denied ? 'denied' : 'halted',
        applied,
        failures,
        error: result.error,
      };
    }

    applied += result.applied;
    failures.push(...result.failures);
    offset += CHUNK_SIZE;

    onProgress({ examined: Math.min(offset, totalRows), applied });

    // `done` is the action's own answer and is authoritative. The offset test
    // beside it is a belt: a `done` that never arrives -- a plan that grew, a
    // bad offset -- would otherwise loop forever against a live database.
    if (result.done || offset >= totalRows) break;
  }

  return { status: 'complete', applied, failures, error: null };
}
