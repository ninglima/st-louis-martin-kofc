import { describe, expect, it } from 'vitest';

import { reportCsv } from './report-csv';

describe('reportCsv', () => {
  it('writes a header and one row per member, quoting where needed', () => {
    expect(
      reportCsv([
        {
          memberId: 'm1',
          name: 'Smith, John',
          membershipNumber: '100',
          events: 2,
          hours: 4.5,
        },
        {
          memberId: 'm2',
          name: '=cmd',
          membershipNumber: '101',
          events: 1,
          hours: 1,
        },
      ]),
    ).toBe(
      'Member,Membership Number,Events,Hours\r\n"Smith, John",100,2,4.5\r\n\'=cmd,101,1,1',
    );
  });

  it('defuses every spreadsheet-formula starter, not just = and @', () => {
    const rows = reportCsv([
      {
        memberId: 'm1',
        name: '+1234',
        membershipNumber: '1',
        events: 1,
        hours: 1,
      },
      {
        memberId: 'm2',
        name: '-1234',
        membershipNumber: '2',
        events: 1,
        hours: 1,
      },
      {
        memberId: 'm3',
        name: '\tcmd',
        membershipNumber: '3',
        events: 1,
        hours: 1,
      },
      {
        memberId: 'm4',
        name: '\rcmd',
        membershipNumber: '4',
        events: 1,
        hours: 1,
      },
    ]).split('\r\n');

    expect(rows[1]).toBe("'+1234,1,1,1");
    expect(rows[2]).toBe("'-1234,2,1,1");
    expect(rows[3]).toBe("'\tcmd,3,1,1");
    // A defused leading \r still contains \r, so the field is quoted too.
    expect(rows[4]).toBe('"\'\rcmd",4,1,1');
  });
});
