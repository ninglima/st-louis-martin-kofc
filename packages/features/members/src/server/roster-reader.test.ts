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

  it('pads short rows so column indexes stay aligned', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    for (const row of rows.slice(1)) {
      expect(row.length).toBeGreaterThanOrEqual(27);
    }
  });

  it('reads a .csv with the same contract', async () => {
    const csv =
      'Membership Number,First Name,Last Name,Primary Email\n1,A,B,a@b.com\n';
    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[0]?.[0]).toBe('Membership Number');
    expect(rows[1]?.[3]).toBe('a@b.com');
  });

  it('rejects an unsupported extension by name', async () => {
    await expect(readRoster(Buffer.from('x'), 'roster.pdf')).rejects.toThrow(
      RosterReadError,
    );
  });
});
