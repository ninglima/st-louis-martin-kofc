import { describe, expect, it } from 'vitest';

import { mapHeaders, REQUIRED_HEADERS } from './column-map';

const FULL_HEADER = [
  'Membership Number',
  'Prefix',
  'First Name',
  'Middle Name',
  'Last Name',
  'Suffix',
  'Fraternal - Bad Address',
  'Primary Type',
  'Address Line 1',
  'Address Line 2',
  'City',
  'State/Province',
  'Postal Code',
  'Country',
  'Secondary Type',
  'Address Line 1 (Secondary)',
  'Address Line 2 (Secondary)',
  'City (Secondary)',
  'State/Province (Secondary)',
  'Postal Code (Secondary)',
  'Country (Secondary)',
  'Residence Phone',
  'Business Phone',
  'Cell Phone',
  'Primary Email',
  'Secondary Email',
  'Tertiary Email',
];

describe('mapHeaders', () => {
  it('maps every column of the real extract shape', () => {
    const { index, missing } = mapHeaders(FULL_HEADER);

    expect(missing).toEqual([]);
    expect(index.membershipNumber).toBe(0);
    expect(index.primaryEmail).toBe(24);
    expect(index.cellPhone).toBe(23);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const { index, missing } = mapHeaders([
      '  membership number ',
      'FIRST NAME',
      'last name',
      'Primary EMAIL',
    ]);

    expect(missing).toEqual([]);
    expect(index.membershipNumber).toBe(0);
    expect(index.lastName).toBe(2);
  });

  it('matches by name, not position, so a reordered export still works', () => {
    const { index } = mapHeaders([
      'Primary Email',
      'Last Name',
      'First Name',
      'Membership Number',
    ]);

    expect(index.membershipNumber).toBe(3);
    expect(index.primaryEmail).toBe(0);
  });

  it('reports every missing required header by name', () => {
    const { missing } = mapHeaders(['First Name', 'Last Name']);

    expect(missing).toEqual(['Membership Number', 'Primary Email']);
  });

  it('ignores unrecognized extra columns silently', () => {
    const { index, missing } = mapHeaders([
      'Membership Number',
      'First Name',
      'Last Name',
      'Primary Email',
      'Council Notes',
    ]);

    expect(missing).toEqual([]);
    expect(Object.keys(index)).not.toContain('councilNotes');
  });

  it('exposes exactly the four required headers', () => {
    expect(REQUIRED_HEADERS).toEqual([
      'Membership Number',
      'First Name',
      'Last Name',
      'Primary Email',
    ]);
  });

  it('collapses internal double spaces in a required header instead of reporting it missing', () => {
    const { index, missing } = mapHeaders([
      'Membership  Number',
      'First Name',
      'Last Name',
      'Primary Email',
    ]);

    expect(missing).toEqual([]);
    expect(index.membershipNumber).toBe(0);
  });

  it('collapses internal double spaces in a non-required header instead of dropping it', () => {
    const { index } = mapHeaders([
      'Membership Number',
      'First Name',
      'Middle  Name',
      'Last Name',
      'Primary Email',
    ]);

    expect(index.middleName).toBe(2);
  });

  it('collapses a tab or newline between words to a single space', () => {
    const { index, missing } = mapHeaders([
      'Membership\tNumber',
      'First Name',
      'Last\nName',
      'Primary Email',
    ]);

    expect(missing).toEqual([]);
    expect(index.membershipNumber).toBe(0);
    expect(index.lastName).toBe(2);
  });

  it('keeps the first occurrence when a header is duplicated', () => {
    const { index } = mapHeaders([
      'Membership Number',
      'First Name',
      'Last Name',
      'Primary Email',
      'First Name',
    ]);

    expect(index.firstName).toBe(1);
  });
});
