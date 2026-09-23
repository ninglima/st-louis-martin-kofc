import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewPlan } from '../server/roster-actions';
import type { PlanRow } from '../server/roster-plan';
import { RosterImportPreview } from './roster-import-preview';

// The action module is `'use server'`; Next replaces the import with a
// reference at build time, but a test really loads it, and `server-only`
// throws on the way in. Mocked so the component under test can be rendered at
// all -- nothing here presses the button.
vi.mock('../server/roster-actions', () => ({
  applyRosterChunkAction: vi.fn(),
}));

vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function plan(rows: PlanRow[], absentFromFile: string[] = []): PreviewPlan {
  const counts = { create: 0, update: 0, nochange: 0, skip: 0 };

  for (const row of rows) counts[row.action]++;

  return { rows, counts, absentFromFile, rowErrors: [] };
}

function render(preview: PreviewPlan) {
  return renderToStaticMarkup(
    <RosterImportPreview
      importId="00000000-0000-0000-0000-000000000000"
      filename="roster.xlsx"
      plan={preview}
      onStartOver={() => {}}
    />,
  );
}

/**
 * The preview is the only moment a human sees what an import will do to real
 * people, and until these tests existed every one of the requirements below
 * could be deleted from the markup without a single test noticing. Each one is
 * asserted on what actually reaches the screen.
 */
describe('RosterImportPreview', () => {
  it('shows a contested email that was awarded on a guess, naming both members', () => {
    const html = render(
      plan([
        {
          membershipNumber: '1000004',
          displayName: 'Peter Nolan',
          sourceRow: 5,
          action: 'create',
          conflicts: [
            {
              field: 'primaryEmail',
              kind: 'awarded-contested-email',
              incoming: 'peter@example.com',
              stored: '(also claimed in this file by member 1000007)',
            },
          ],
        },
      ]),
    );

    expect(html).toContain('data-test="roster-awarded-email"');
    expect(html).toContain('peter@example.com');

    // Both membership numbers, because the officer is the only party who knows
    // which of the two transferred out, and the winner alone does not let them
    // decide. And the row number, because the fix happens in the spreadsheet.
    expect(html).toContain('1000004');
    expect(html).toContain('member 1000007');
    expect(html).toContain('Row 5 in the file');

    // The guess is stated as a guess rather than dressed up as a decision.
    expect(html).toContain('a rule that guesses');
  });

  it('gives every skipped row the number the spreadsheet shows', () => {
    const html = render(
      plan([
        {
          membershipNumber: '1000007',
          displayName: 'Duplicate Email',
          sourceRow: 9,
          action: 'skip',
          reason: 'Two rows in the file share this email',
          conflicts: [],
        },
      ]),
    );

    const cell = html.slice(html.indexOf('data-test="roster-skip-source-row"'));

    // "Two rows in the file share this email" is unactionable in a 372-row
    // spreadsheet without the row number beside it.
    expect(cell.slice(0, 120)).toContain('9');
    expect(html).toContain('Two rows in the file share this email');
  });

  it('keeps the already-set noise collapsed behind its count', () => {
    const rows: PlanRow[] = Array.from({ length: 30 }, (_, index) => ({
      membershipNumber: `20000${index}`,
      displayName: `Member ${index}`,
      sourceRow: index + 2,
      action: 'nochange',
      conflicts: [
        {
          field: 'city',
          kind: 'already-set',
          incoming: 'Ashburn',
          stored: '(already set)',
        },
      ],
    }));

    const html = render(plan(rows));

    // The count is on screen; the 30 lines behind it -- 3,000 on the real
    // roster, every one of them writing nothing -- are not, because inline
    // they bury the handful of lines a human must actually read.
    expect(html).toContain('30 fields already have a value');
    expect(html).toContain('data-test="roster-already-set-toggle"');
    expect(html).not.toContain('data-test="roster-already-set-row"');
  });

  it('reports a member no row imports as a job for a human', () => {
    const html = render(
      plan([
        {
          membershipNumber: '3000001',
          displayName: 'Ann Pratt',
          sourceRow: 4,
          action: 'skip',
          reason: 'Two rows in the file share this email',
          conflicts: [],
        },
        {
          membershipNumber: '3000001',
          displayName: 'Ann Pratt',
          sourceRow: 5,
          action: 'skip',
          reason: 'Two rows in the file share this email',
          conflicts: [],
        },
      ]),
    );

    expect(html).toContain('data-test="roster-blocked-row"');
    expect(html).toContain('1 member this file cannot import');
    expect(html).toContain('Correct the rows named below');
  });

  it('puts the conflicts a human must read on screen, uncollapsed', () => {
    const html = render(
      plan([
        {
          membershipNumber: '1000001',
          displayName: 'John Smith',
          sourceRow: 2,
          action: 'update',
          conflicts: [
            {
              field: 'lastName',
              kind: 'value-differs',
              incoming: 'Smyth',
              stored: 'Smith',
            },
            {
              field: 'primaryEmail',
              kind: 'owned-by-another-member',
              incoming: 'paul@example.com',
              stored: '(already belongs to member 1000002)',
            },
          ],
        },
      ]),
    );

    // Two conflicts, two rows: grouped by kind, never merged by field.
    expect(html.split('data-test="roster-conflict-row"')).toHaveLength(3);
    expect(html).toContain('The file disagrees with the record');
    expect(html).toContain('That address belongs to another member');
    expect(html).not.toContain('data-test="roster-already-set-row"');
  });

  it('says plainly that nothing has been written yet', () => {
    const html = render(plan([]));

    expect(html).toContain('Nothing has been written yet');
    expect(html).toContain('On the roster but not in this file');
  });
});
