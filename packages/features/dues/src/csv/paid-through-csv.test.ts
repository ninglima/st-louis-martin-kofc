import { describe, expect, it } from 'vitest';

import { parsePaidThroughCsv } from './paid-through-csv';

const TODAY = '2026-09-28';

describe('parsePaidThroughCsv', () => {
  it('reads ISO and US dates, strips a BOM, ignores blank lines', () => {
    const csv =
      '﻿membership_number,paid_through,dues_level\n1001,2027-03-01,student\n\n1002,3/1/2027,\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        membershipNumber: '1001',
        paidThrough: '2027-03-01',
        duesLevel: 'student',
      },
      { line: 4, membershipNumber: '1002', paidThrough: '2027-03-01' },
    ]);
  });

  it('flags a missing required column', () => {
    const { issues } = parsePaidThroughCsv('membership_number\n1001\n', TODAY);
    expect(issues[0]?.kind).toBe('missing_column');
  });

  it('flags impossible dates and keeps them out of rows', () => {
    const { rows, issues } = parsePaidThroughCsv(
      'membership_number,paid_through\n1001,2027-02-30\n',
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(issues[0]).toMatchObject({ line: 2, kind: 'bad_date' });
  });

  it('flags duplicates and keeps only the first', () => {
    const { rows, issues } = parsePaidThroughCsv(
      'membership_number,paid_through\n1001,2027-01-01\n1001,2027-06-01\n',
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, kind: 'duplicate' });
  });

  it('flags suspicious dates (>2y ahead, >5y back) but keeps them for review', () => {
    const { rows, issues } = parsePaidThroughCsv(
      'membership_number,paid_through\n1001,2030-01-01\n1002,2019-01-01\n',
      TODAY,
    );
    expect(rows).toHaveLength(2);
    expect(issues.map((i) => i.kind)).toEqual([
      'suspicious_date',
      'suspicious_date',
    ]);
  });
});
