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
});
