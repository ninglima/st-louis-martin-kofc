import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { buildFixtureWorkbook } from '../../test/fixtures/make-fixture';
import { readRoster, RosterReadError } from './roster-reader';

async function fixtureBuffer(): Promise<Buffer> {
  const buffer = await buildFixtureWorkbook().xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe('readRoster', () => {
  it('returns the header row first', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    expect(rows[0]?.[0]).toBe('Membership Number');
    expect(rows[0]?.[24]).toBe('Primary Email');
  });

  it('returns every data row', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    // 11 data rows in the fixture, plus the header.
    expect(rows).toHaveLength(12);
  });

  it('yields strings, not numbers, so a numeric member number keeps its shape', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    expect(typeof rows[1]?.[0]).toBe('string');
    expect(rows[1]?.[0]).toBe('1000001');
  });

  it('converts a genuinely numeric xlsx cell to a string', async () => {
    // The fixture's own rows are string literals, so ExcelJS round-trips
    // them as string cells and never exercises the number-coercion branch.
    // Build a cell that is actually typed as a number to prove it.
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');

    sheet.addRow(['Membership Number', 'First Name']);
    sheet.addRow([1000001, 'A']);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await readRoster(buffer, 'numeric.xlsx');

    expect(typeof rows[1]?.[0]).toBe('string');
    expect(rows[1]?.[0]).toBe('1000001');
  });

  it('pads short rows so column indexes stay aligned', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    for (const row of rows.slice(1)) {
      expect(row.length).toBeGreaterThanOrEqual(27);
    }
  });

  it('pads a narrow csv (header and every row under 27 columns) to the minimum column count', async () => {
    // Every line in this file — header included — has 4 fields at most, so
    // the sheet's own column count never reaches 27. Only padRow can bring
    // a row up to the floor here; nothing wider does it implicitly.
    const csv = 'Membership Number,First Name,Last Name,Primary Email\n1,A\n';

    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[1]).toHaveLength(27);
    expect(rows[1]?.[0]).toBe('1');
    expect(rows[1]?.[1]).toBe('A');
    expect(rows[1]?.[2]).toBe('');
  });

  it('reads a .csv with the same contract', async () => {
    const csv =
      'Membership Number,First Name,Last Name,Primary Email\n1,A,B,a@b.com\n';
    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[0]?.[0]).toBe('Membership Number');
    expect(rows[1]?.[3]).toBe('a@b.com');
  });

  it('keeps columns aligned when a quoted csv field contains a comma', async () => {
    const csv =
      'Membership Number,First Name,Last Name,Primary Email\n' +
      '1,A,"Smith, Jr",a@b.com\n';

    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[1]).toEqual(
      expect.arrayContaining(['1', 'A', 'Smith, Jr', 'a@b.com']),
    );
    expect(rows[1]?.[2]).toBe('Smith, Jr');
    expect(rows[1]?.[3]).toBe('a@b.com');
  });

  it('unescapes a doubled quote inside a quoted csv field', async () => {
    const csv = 'A,B\n1,"He said ""hi"""\n';

    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[1]?.[1]).toBe('He said "hi"');
  });

  it('keeps a quoted empty csv field empty rather than shifting columns', async () => {
    const csv = 'A,B,C\n1,"",3\n';

    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[1]?.[1]).toBe('');
    expect(rows[1]?.[2]).toBe('3');
  });

  it('rejects an unsupported extension by name', async () => {
    await expect(readRoster(Buffer.from('x'), 'roster.pdf')).rejects.toThrow(
      RosterReadError,
    );
  });
});
