import { describe, expect, it } from 'vitest';

import type { MemberDuesSummary } from '../types';
import { describeMyDues, formatDueDate, isPayable } from './describe-my-dues';

const base: MemberDuesSummary = {
  memberId: 'm1',
  duesLevel: 'regular',
  levelName: 'Regular (with voluntary contribution)',
  amountCents: 5800,
  acceptedOn: '2025-08-01',
  isStudent: false,
  paidThrough: null,
  duesStatus: 'no_record',
};

const TODAY = '2026-10-02';

describe('formatDueDate', () => {
  it('spells out the month without shifting the day', () => {
    // Parsed as a plain calendar date: a `new Date('2027-08-01')` read in
    // Chicago time would show July 31.
    expect(formatDueDate('2027-08-01')).toBe('August 1, 2027');
  });
});

describe('isPayable', () => {
  it('offers payment to everyone who may owe dues', () => {
    expect(isPayable('due')).toBe(true);
    expect(isPayable('lapsed')).toBe(true);
    expect(isPayable('due_soon')).toBe(true);
    expect(isPayable('no_record')).toBe(true);
  });

  it('offers nothing to a member who is current', () => {
    expect(isPayable('current')).toBe(false);
  });
});

describe('describeMyDues', () => {
  it('reads as paid when current, with no amount', () => {
    expect(
      describeMyDues(
        { ...base, duesStatus: 'current', paidThrough: '2027-08-01' },
        TODAY,
      ),
    ).toEqual({
      tone: 'ok',
      headline: 'Your dues are paid',
      detail: 'Paid until August 1, 2027',
      note: null,
      payable: false,
    });
  });

  it('counts the days left when due soon', () => {
    expect(
      describeMyDues(
        { ...base, duesStatus: 'due_soon', paidThrough: '2026-11-13' },
        TODAY,
      ),
    ).toEqual({
      tone: 'attention',
      headline: 'Your dues are due soon',
      detail: 'Due November 13, 2026 (in 42 days) · $58.00',
      note: null,
      payable: true,
    });
  });

  it('says tomorrow rather than in 1 day', () => {
    expect(
      describeMyDues(
        { ...base, duesStatus: 'due_soon', paidThrough: '2026-10-03' },
        TODAY,
      ).detail,
    ).toBe('Due October 3, 2026 (tomorrow) · $58.00');
  });

  it('counts the days since when past due', () => {
    expect(
      describeMyDues(
        { ...base, duesStatus: 'lapsed', paidThrough: '2026-08-01' },
        TODAY,
      ),
    ).toEqual({
      tone: 'owed',
      headline: 'Your dues are past due',
      detail: 'Expired August 1, 2026 (62 days ago) · $58.00',
      note: null,
      payable: true,
    });
  });

  it('says today when the dues expire today', () => {
    expect(
      describeMyDues(
        { ...base, duesStatus: 'lapsed', paidThrough: TODAY },
        TODAY,
      ).detail,
    ).toBe('Expired October 2, 2026 (today) · $58.00');
  });

  it('names the level when nothing has been paid yet', () => {
    expect(describeMyDues({ ...base, duesStatus: 'due' }, TODAY)).toEqual({
      tone: 'owed',
      headline: "Your dues haven't been paid yet",
      detail: '$58.00 for Regular (with voluntary contribution)',
      note: null,
      payable: true,
    });
  });

  it('allows for an unrecorded check or cash payment when there is no record', () => {
    expect(
      describeMyDues(
        { ...base, duesStatus: 'no_record', acceptedOn: null },
        TODAY,
      ),
    ).toEqual({
      tone: 'owed',
      headline: 'We have no record of your dues payment',
      detail: '$58.00 for Regular (with voluntary contribution)',
      note: 'If you paid by check or cash, the Financial Secretary may not have recorded it yet.',
      payable: true,
    });
  });
});
