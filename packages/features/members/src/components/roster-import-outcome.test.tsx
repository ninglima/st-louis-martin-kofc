import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ApplyOutcome } from './apply-loop';
import { describeOutcome, RosterImportOutcome } from './roster-import-outcome';

const ACCOUNT_CLASH =
  'duplicate key value violates unique constraint "members_user_id_uk"';

function outcome(overrides: Partial<ApplyOutcome> = {}): ApplyOutcome {
  return {
    status: 'complete',
    applied: 7,
    failures: [],
    error: null,
    ...overrides,
  };
}

/**
 * Rendered rather than reasoned about. Every requirement below is a property of
 * what reaches the screen, and the module-level tests beside this one cannot
 * see the screen: a review found five requirement-bearing lines in these
 * components that could be broken without a single test noticing.
 */
function render(result: ApplyOutcome) {
  return renderToStaticMarkup(
    <RosterImportOutcome outcome={result} scroller="scroller" wrap="wrap" />,
  );
}

describe('RosterImportOutcome', () => {
  it('tells a refused officer to ask for their permission, not to fix the file', () => {
    const html = render(
      outcome({
        status: 'denied',
        applied: 0,
        error: 'You do not have permission to import the roster.',
      }),
    );

    expect(html).toContain('data-test="roster-denied"');
    expect(html).toContain('Your permission to import was withdrawn');
    expect(html).toContain('There is nothing wrong with the spreadsheet');

    // The two refusals are the same shape and mean opposite things. A denied
    // officer told "the import stopped before it finished" goes looking at
    // their spreadsheet for a problem that is not in it.
    expect(html).not.toContain('data-test="roster-halted"');
    expect(html).not.toContain('The import stopped before it finished');
  });

  it('keeps the action’s own sentence on a halted run', () => {
    const message =
      '3 rows were applied, but the import record could not be updated: timeout. Re-run the import — applying it again is safe.';

    const html = render(
      outcome({ status: 'halted', applied: 3, error: message }),
    );

    expect(html).toContain('data-test="roster-halted"');
    expect(html).toContain('applying it again is safe');
    expect(html).not.toContain('data-test="roster-denied"');
  });

  it('does not colour a run green when a member failed to land', () => {
    const html = render(
      outcome({
        applied: 2,
        failures: [{ membershipNumber: '1000009', error: ACCOUNT_CLASH }],
      }),
    );

    // `alertExtras.warning` / `.success` are class strings, so the assertion
    // is on the token that actually decides the colour.
    expect(html).toContain('yellow');
    expect(html).not.toContain('green');
    expect(html).toContain('2 rows written, 1 could not be applied.');
  });

  it('is green only when every row landed', () => {
    const html = render(outcome({ applied: 7 }));

    expect(html).toContain('green');
    expect(html).not.toContain('yellow');
    expect(html).toContain('7 rows written');
  });

  it('hoists a failure that will recur every month out of the failures table', () => {
    const html = render(
      outcome({
        applied: 1,
        failures: [
          { membershipNumber: '1000009', error: ACCOUNT_CLASH },
          { membershipNumber: '1000010', error: 'network reset' },
        ],
      }),
    );

    expect(html).toContain('data-test="roster-recurring-failures"');
    expect(html).toContain('needs their account reassigned by hand');
    expect(html).toContain('Member 1000009');

    // The recurring one is NOT left in the ordinary list as well: the whole
    // point is that it stops being a line a monthly reader skims past.
    const table = html.slice(html.indexOf('data-test="roster-failures"'));

    expect(table).toContain('1000010');
    expect(table).not.toContain('1000009');
  });
});

describe('describeOutcome', () => {
  it('warns rather than congratulates when rows failed', () => {
    const notice = describeOutcome(
      outcome({
        applied: 2,
        failures: [{ membershipNumber: '1000009', error: ACCOUNT_CLASH }],
      }),
      'roster.xlsx',
    );

    // A green "Imported 2 rows" toast over an amber "1 could not be applied"
    // alert is how an officer closes the tab believing all is well.
    expect(notice.tone).toBe('warning');
    expect(notice.message).toContain('1 row could not be applied');
  });

  it('congratulates only a clean run', () => {
    const notice = describeOutcome(outcome({ applied: 7 }), 'roster.xlsx');

    expect(notice).toEqual({
      tone: 'success',
      message: 'Imported 7 rows from roster.xlsx.',
    });
  });

  it('counts one row as one row', () => {
    const notice = describeOutcome(outcome({ applied: 1 }), 'roster.xlsx');

    expect(notice.message).toBe('Imported 1 row from roster.xlsx.');
  });

  it('repeats the action’s message verbatim when the run did not finish', () => {
    const message =
      '5 rows were applied, but the import record could not be updated: timeout. Re-run the import — applying it again is safe.';

    for (const status of ['denied', 'halted'] as const) {
      const notice = describeOutcome(
        outcome({ status, applied: 5, error: message }),
        'roster.xlsx',
      );

      expect(notice.tone).toBe('error');
      expect(notice.message).toBe(message);
    }
  });
});
