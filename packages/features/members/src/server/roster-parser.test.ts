import { describe, expect, it } from 'vitest';

import { buildFixtureWorkbook } from '../../test/fixtures/make-fixture';
import { readRoster } from './roster-reader';
import type { SheetRow } from './roster-reader';
import { parseRoster } from './roster-parser';

/** Numbers literal rows consecutively from 1, as a sheet with no gaps would. */
function sheet(rows: string[][]): SheetRow[] {
  return rows.map((cells, index) => ({ rowNumber: index + 1, cells }));
}

async function parseFixture() {
  const buffer = Buffer.from(await buildFixtureWorkbook().xlsx.writeBuffer());
  return parseRoster(await readRoster(buffer, 'roster.xlsx'));
}

describe('parseRoster', () => {
  it('reports missing required headers and parses nothing', () => {
    const result = parseRoster(sheet([['First Name', 'Last Name']]));

    expect(result.missingHeaders).toEqual([
      'Membership Number',
      'Primary Email',
    ]);
    expect(result.records).toEqual([]);
  });

  it('normalizes email case', async () => {
    const { records } = await parseFixture();
    const paul = records.find((r) => r.membershipNumber === '1000002');

    expect(paul?.primaryEmail).toBe('pabraham@pjilaw.com');
  });

  it('formats US phones and leaves other shapes alone', async () => {
    const { records } = await parseFixture();

    expect(
      records.find((r) => r.membershipNumber === '1000001')?.phoneCell,
    ).toBe('(703) 555-0002');
    expect(
      records.find((r) => r.membershipNumber === '1000009')?.phoneResidence,
    ).toBe('+44 20 7946 0958');
  });

  it('leaves name case untouched', async () => {
    const { records } = await parseFixture();

    expect(records.find((r) => r.membershipNumber === '1000005')?.suffix).toBe(
      'Iii',
    );
  });

  it('reads the bad-address flag', async () => {
    const { records } = await parseFixture();

    expect(
      records.find((r) => r.membershipNumber === '1000004')?.badAddress,
    ).toBe(true);
    expect(
      records.find((r) => r.membershipNumber === '1000001')?.badAddress,
    ).toBe(false);
  });

  it('collects the secondary address when present', async () => {
    const { records } = await parseFixture();
    const luis = records.find((r) => r.membershipNumber === '1000006');

    expect(luis?.secondaryAddress).toMatchObject({
      city: 'Naples',
      state: 'FL',
    });
  });

  it('errors a blank membership number rather than importing it', async () => {
    const { rowErrors } = await parseFixture();

    expect(
      rowErrors.some((e) => e.reason === 'Cannot identify the member'),
    ).toBe(true);
  });

  it('errors a malformed email', async () => {
    const { rowErrors } = await parseFixture();

    expect(
      rowErrors.some((e) => e.reason.startsWith('No usable email address')),
    ).toBe(true);
  });

  it('keeps the emailless member as an error, not a silent drop', async () => {
    const { records, rowErrors } = await parseFixture();

    expect(records.some((r) => r.membershipNumber === '1000003')).toBe(false);
    expect(rowErrors.some((e) => e.sourceRow === 4)).toBe(true);
  });

  it('records the source row number for every error', async () => {
    const { rowErrors } = await parseFixture();

    for (const error of rowErrors) {
      expect(error.sourceRow).toBeGreaterThan(1);
    }
  });

  // --- Additions beyond the brief ---

  it('includes the secondary address type marker, not just the location fields', async () => {
    const { records } = await parseFixture();
    const luis = records.find((r) => r.membershipNumber === '1000006');

    // The real extract uses values like "Seasonal" here. The header map
    // exposes secondaryType, but a parser that never reads it would drop
    // the marker silently, leaving secondaryAddress present with no way to
    // tell it apart from a permanent second home.
    expect(luis?.secondaryAddress).toMatchObject({ type: 'Seasonal' });
  });

  it('pins the bad-address marker to the literal "X", not the broader vocabulary the database accepts', () => {
    // kit.roster_bad_address() in the database treats X, Y, YES, T, TRUE,
    // and 1 as all equally truthy. This parser deliberately does not: it
    // only recognizes 'X', matching what the real extract actually emits.
    // If a future Officers Online export switched to 'Y' or 'YES', every
    // member's bad-address flag would silently read false unless this
    // comparison is updated to match — this test exists so that change
    // fails loudly here instead of vanishing downstream.
    const result = parseRoster(
      sheet([
        [
          'Membership Number',
          'First Name',
          'Last Name',
          'Primary Email',
          'Fraternal - Bad Address',
        ],
        ['1000010', 'Jane', 'Doe', 'jane@example.com', 'Y'],
        ['1000011', 'Jill', 'Roe', 'jill@example.com', 'X'],
      ]),
    );

    expect(
      result.records.find((r) => r.membershipNumber === '1000010')?.badAddress,
    ).toBe(false);
    expect(
      result.records.find((r) => r.membershipNumber === '1000011')?.badAddress,
    ).toBe(true);
  });

  it("reports an error at the sheet's own row number, not its position after blank lines", () => {
    // Rows 3 and 4 were blank in the sheet, so the bad row is the third one
    // handed over but sits on Excel row 5. Position-derived numbering would
    // report row 3 and send the officer to the wrong member.
    const result = parseRoster([
      {
        rowNumber: 1,
        cells: [
          'Membership Number',
          'First Name',
          'Last Name',
          'Primary Email',
        ],
      },
      { rowNumber: 2, cells: ['1000010', 'Jane', 'Doe', 'jane@example.com'] },
      { rowNumber: 5, cells: ['1000011', 'Jill', 'Roe', 'not-an-email'] },
    ]);

    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0]?.sourceRow).toBe(5);
  });

  it('reports all four required headers missing for a completely empty file', () => {
    // readRoster returns [] for an empty .csv or an empty first sheet. This
    // is the boundary where an empty upload becomes a readable, actionable
    // error for the officer rather than a crash or a confusingly empty
    // success (records: [], missingHeaders: [] would look like nothing was
    // wrong).
    const result = parseRoster([]);

    expect(result.missingHeaders).toEqual([
      'Membership Number',
      'First Name',
      'Last Name',
      'Primary Email',
    ]);
    expect(result.records).toEqual([]);
    expect(result.rowErrors).toEqual([]);
  });
});
