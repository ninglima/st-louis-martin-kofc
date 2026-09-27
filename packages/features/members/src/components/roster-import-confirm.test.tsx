import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDom, mount } from '../../test/dom';
import type { PreviewPlan } from '../server/roster-actions';
import { RosterImportPreview } from './roster-import-preview';

const { applyRosterChunkAction, toast } = vi.hoisted(() => ({
  applyRosterChunkAction: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

// `'use server'` modules load `server-only`, which throws on the way in.
vi.mock('../server/roster-actions', () => ({ applyRosterChunkAction }));

vi.mock('@kit/ui/sonner', () => ({ toast }));

const ACCOUNT_CLASH =
  'duplicate key value violates unique constraint "members_user_id_uk"';

function plan(rowCount: number): PreviewPlan {
  return {
    rows: Array.from({ length: rowCount }, (_, index) => ({
      membershipNumber: `100000${index}`,
      displayName: `Member ${index}`,
      sourceRow: index + 2,
      action: 'create' as const,
      conflicts: [],
    })),
    counts: { create: rowCount, update: 0, nochange: 0, skip: 0 },
    absentFromFile: [],
    rowErrors: [],
  };
}

function preview(rowCount = 1) {
  return mount(
    <RosterImportPreview
      importId="00000000-0000-0000-0000-000000000000"
      filename="roster.csv"
      plan={plan(rowCount)}
      onStartOver={() => {}}
    />,
  );
}

beforeAll(installDom);

beforeEach(() => {
  applyRosterChunkAction.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
  toast.error.mockReset();
});

/**
 * The apply path, driven by an actual click.
 *
 * Every other test in this package renders the preview to a string, which
 * cannot press the button -- so until this file existed the entire `onConfirm`
 * body was unreachable, and a review demonstrated it: the exact defect the
 * previous round fixed ("a partially failed run fires a green success toast")
 * could be pasted back verbatim and all 220 tests still passed. So could
 * `toast[notice.tone]` -> `toast.success`, and so could deleting the outcome
 * report from the screen altogether.
 *
 * `describeOutcome` was already tested as a pure function. What was untested
 * was that the component USES it -- which is the only part an officer sees.
 */
describe('RosterImportPreview — confirming the import', () => {
  it('does not announce a run that lost a member as a success', async () => {
    applyRosterChunkAction.mockResolvedValue({
      success: true,
      applied: 2,
      failures: [{ membershipNumber: '1000009', error: ACCOUNT_CLASH }],
      done: true,
    });

    const screen = await preview();

    await screen.click('roster-confirm');

    // The toast is the coloured, transient thing that draws the eye, and the
    // only part of the outcome still visible to an officer who has scrolled.
    // Green here is how they close the tab believing all 372 members landed.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      'Imported 2 rows from roster.csv. 1 row could not be applied.',
    );

    screen.unmount();
  });

  it('congratulates a run where every row landed', async () => {
    applyRosterChunkAction.mockResolvedValue({
      success: true,
      applied: 3,
      failures: [],
      done: true,
    });

    const screen = await preview();

    await screen.click('roster-confirm');

    // The other half: warning on every run would train the officer to ignore
    // the colour, which costs exactly as much as never warning at all.
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      'Imported 3 rows from roster.csv.',
    );

    screen.unmount();
  });

  it('puts the outcome report on the screen, amber, beside the toast', async () => {
    applyRosterChunkAction.mockResolvedValue({
      success: true,
      applied: 2,
      failures: [{ membershipNumber: '1000009', error: ACCOUNT_CLASH }],
      done: true,
    });

    const screen = await preview();

    await screen.click('roster-confirm');

    const complete = screen.find('roster-complete');

    // The report is what survives after the toast fades. Deleting it from the
    // preview used to be invisible to the suite.
    expect(complete).not.toBeNull();
    expect(complete!.textContent).toContain('2 rows written');
    expect(complete!.textContent).toContain('1 could not be applied');
    expect(complete!.className).toContain('yellow');
    expect(complete!.className).not.toContain('green');

    // And the member who did not land is named, hoisted into the alert that
    // says re-running will not fix them.
    expect(screen.find('roster-recurring-failures')?.textContent).toContain(
      '1000009',
    );

    screen.unmount();
  });

  it('keeps the rows that failed before the transport died', async () => {
    // Chunk one lands two members and loses one; chunk two never answers.
    applyRosterChunkAction
      .mockResolvedValueOnce({
        success: true,
        applied: 2,
        failures: [{ membershipNumber: '1000009', error: ACCOUNT_CLASH }],
        done: false,
      })
      .mockRejectedValueOnce(new Error('Failed to fetch'));

    // Two chunks' worth of rows, so the loop cannot finish on the first pass.
    const screen = await preview(40);

    await screen.click('roster-confirm');

    const halted = screen.find('roster-halted');

    expect(halted).not.toBeNull();
    expect(halted!.textContent).toContain('Failed to fetch');

    // The member lost in chunk one is still reported. The loop's return value
    // -- the only other carrier of that fact -- never arrived, so without the
    // mirror this member vanishes from a screen whose entire purpose is that
    // nothing about an import is invisible.
    expect(screen.container.textContent).toContain('1000009');

    screen.unmount();
  });

  it('tells a refused officer to ask for their permission back', async () => {
    applyRosterChunkAction.mockResolvedValue({
      success: false,
      denied: true,
      error: 'You do not have permission to import the roster.',
      applied: 0,
      failures: [],
      done: true,
    });

    const screen = await preview();

    await screen.click('roster-confirm');

    expect(screen.find('roster-denied')).not.toBeNull();
    expect(screen.find('roster-halted')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'You do not have permission to import the roster.',
    );

    screen.unmount();
  });
});
