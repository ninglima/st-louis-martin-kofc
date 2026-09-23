import { describe, expect, it, vi } from 'vitest';

import type { ApplyResult } from '../server/roster-actions';
import { CHUNK_SIZE } from '../types/roster';
import {
  needsAccountReassignment,
  runApplyLoop,
  type ApplyProgress,
} from './apply-loop';

function ok(
  applied: number,
  done: boolean,
  failures: { membershipNumber: string; error: string }[] = [],
): ApplyResult {
  return { success: true, applied, failures, done };
}

/** Collects the offsets the loop asked for, in the order it asked. */
function recorder(results: ApplyResult[]) {
  const offsets: number[] = [];
  let call = 0;

  const apply = (offset: number) => {
    offsets.push(offset);

    const result = results[call] ?? results.at(-1)!;

    call++;

    return Promise.resolve(result);
  };

  return { offsets, apply };
}

describe('runApplyLoop', () => {
  it('advances by the same constant the action slices by', async () => {
    const total = CHUNK_SIZE * 3;
    const { offsets, apply } = recorder([
      ok(CHUNK_SIZE, false),
      ok(CHUNK_SIZE, false),
      ok(CHUNK_SIZE, true),
    ]);

    const outcome = await runApplyLoop(total, apply, () => {});

    // Not [0, 25, 50]: the literal is what this test exists to forbid. A step
    // that disagreed with the action's slice would skip members or spin.
    expect(offsets).toEqual([0, CHUNK_SIZE, CHUNK_SIZE * 2]);
    expect(outcome.status).toBe('complete');
    expect(outcome.applied).toBe(total);
  });

  it('never has two chunks in flight at once', async () => {
    let inFlight = 0;
    let overlapped = false;
    let call = 0;

    const apply = async () => {
      inFlight++;
      if (inFlight > 1) overlapped = true;

      await Promise.resolve();
      await Promise.resolve();

      inFlight--;
      call++;

      // The action's running total is a read-modify-write on one import row,
      // so overlapping chunks lose counts rather than merely reordering them.
      return ok(1, call === 4);
    };

    await runApplyLoop(CHUNK_SIZE * 4, apply, () => {});

    expect(overlapped).toBe(false);
    expect(call).toBe(4);
  });

  it('stops feeding chunks to an import that refused to write', async () => {
    const apply = vi.fn(async (offset: number): Promise<ApplyResult> => {
      if (offset === 0) return ok(CHUNK_SIZE, false);

      return {
        success: false,
        error: 'Your permission to import the roster was withdrawn.',
        denied: true,
      };
    });

    const outcome = await runApplyLoop(CHUNK_SIZE * 10, apply, () => {});

    expect(apply).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe('denied');
    // Whatever landed before the refusal is still in the database.
    expect(outcome.applied).toBe(CHUNK_SIZE);
  });

  it('separates a withdrawn grant from a broken run', async () => {
    const halted = await runApplyLoop(
      CHUNK_SIZE,
      async () => ({
        success: false,
        error:
          '3 rows were applied, but the import record could not be updated',
        denied: false,
      }),
      () => {},
    );

    expect(halted.status).toBe('halted');
    // Verbatim: the action's own sentence tells the officer a re-run is safe.
    expect(halted.error).toContain('rows were applied');
  });

  it('applies an empty plan once, so the import record can complete', async () => {
    const { offsets, apply } = recorder([ok(0, true)]);

    const outcome = await runApplyLoop(0, apply, () => {});

    expect(offsets).toEqual([0]);
    expect(outcome.status).toBe('complete');
  });

  it('terminates even if the action never says it is done', async () => {
    const apply = vi.fn(async () => ok(0, false));

    const outcome = await runApplyLoop(CHUNK_SIZE * 2, apply, () => {});

    expect(apply).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe('complete');
  });

  it('accumulates failures and progress across chunks', async () => {
    const seen: ApplyProgress[] = [];
    const { apply } = recorder([
      ok(CHUNK_SIZE - 1, false, [{ membershipNumber: '1', error: 'boom' }]),
      ok(2, true, [{ membershipNumber: '2', error: 'bang' }]),
    ]);

    const outcome = await runApplyLoop(CHUNK_SIZE + 2, apply, (progress) =>
      seen.push(progress),
    );

    expect(outcome.failures.map((f) => f.membershipNumber)).toEqual(['1', '2']);
    expect(outcome.applied).toBe(CHUNK_SIZE + 1);
    expect(seen).toEqual([
      {
        examined: CHUNK_SIZE,
        applied: CHUNK_SIZE - 1,
        failures: [{ membershipNumber: '1', error: 'boom' }],
      },
      // Clamped: a last part-chunk must not report more rows than the file has.
      {
        examined: CHUNK_SIZE + 2,
        applied: CHUNK_SIZE + 1,
        failures: [
          { membershipNumber: '1', error: 'boom' },
          { membershipNumber: '2', error: 'bang' },
        ],
      },
    ]);
  });

  it('carries the failures so far on the progress, not only in the result', async () => {
    const seen: ApplyProgress[] = [];

    // The caller's `catch` is the only thing left when the transport dies
    // mid-run, and it has no return value to read. Without the failures on the
    // progress, the members who failed in the chunks that DID complete are
    // reported nowhere at all.
    const { apply } = recorder([
      ok(0, false, [{ membershipNumber: '7', error: 'boom' }]),
    ]);

    await runApplyLoop(CHUNK_SIZE * 2, apply, (progress) =>
      seen.push(progress),
    );

    expect(seen[0]?.failures).toEqual([
      { membershipNumber: '7', error: 'boom' },
    ]);

    // A snapshot, not a live alias: a later chunk must not be able to rewrite
    // what an earlier progress report already told the caller.
    expect(seen[0]?.failures).not.toBe(seen[1]?.failures);
  });
});

describe('needsAccountReassignment', () => {
  it('recognises the one-account-per-member constraint', () => {
    expect(
      needsAccountReassignment({
        membershipNumber: '123',
        error:
          'duplicate key value violates unique constraint "members_user_id_uk"',
      }),
    ).toBe(true);
  });

  it('leaves ordinary row failures alone', () => {
    expect(
      needsAccountReassignment({
        membershipNumber: '123',
        error: 'Auth account for a@b.com is already registered',
      }),
    ).toBe(false);
  });
});
