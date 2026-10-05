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

  it('handles quoted fields, doubled-quote escapes, and an embedded comma', () => {
    const csv =
      'membership_number,paid_through,dues_level\n' +
      '"1001","2027-03-01","reg""ular"\n' +
      '"1,002",2027-04-01,\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        membershipNumber: '1001',
        paidThrough: '2027-03-01',
        duesLevel: 'reg"ular',
      },
      { line: 3, membershipNumber: '1,002', paidThrough: '2027-04-01' },
    ]);
  });

  it('reads CRLF line endings', () => {
    const csv =
      'membership_number,paid_through\r\n1001,2027-01-01\r\n1002,2027-02-01\r\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('reads lone-CR (old Mac) line endings', () => {
    const csv =
      'membership_number,paid_through\r1001,2027-01-01\r1002,2027-02-01\r';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
      { line: 3, membershipNumber: '1002', paidThrough: '2027-02-01' },
    ]);
  });

  it('treats a quote in the middle of an unquoted field as a literal character', () => {
    const csv = 'membership_number,paid_through\n10"01,2027-01-01\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, membershipNumber: '10"01', paidThrough: '2027-01-01' },
    ]);
  });

  it('gives an impossible US date its own message', () => {
    const { rows, issues } = parsePaidThroughCsv(
      'membership_number,paid_through\n1001,2/30/2027\n',
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(issues[0]).toMatchObject({ line: 2, kind: 'bad_date' });
    expect(issues[0]?.message).toMatch(/not a real calendar date/);
  });

  it('matches headers case-insensitively and trims whitespace', () => {
    const csv = ' Membership_Number , PAID_THROUGH \n1001,2027-01-01\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
    ]);
  });

  it('ignores extra columns not named by the header', () => {
    const csv =
      'membership_number,paid_through,extra\n1001,2027-01-01,whatever\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
    ]);
  });

  it('rejects dates outside the ledger range as bad_date, not suspicious', () => {
    const { rows, issues } = parsePaidThroughCsv(
      'membership_number,paid_through\n1001,1999-12-31\n1002,2040-01-01\n',
      TODAY,
    );
    expect(rows).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(['bad_date', 'bad_date']);
  });

  it('combines a BOM, header whitespace/case, CRLF, a quoted extra column with a comma, doubled quotes, and an impossible date', () => {
    const csv =
      '﻿ Membership_Number ,PAID_THROUGH,extra\r\n' +
      '"1001","2027-01-01","a,b"\r\n' +
      '"10""02",2/30/2027,x\r\n';
    const { rows, issues } = parsePaidThroughCsv(csv, TODAY);
    expect(rows).toEqual([
      { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, kind: 'bad_date' });
  });
});
