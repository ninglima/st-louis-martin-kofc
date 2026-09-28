import { describe, expect, it } from 'vitest';

import type { DuesLevel, MyDuesSummary } from '../types';
import { availableDuesLevels } from './available-levels';

const LEVELS: DuesLevel[] = [
  {
    slug: 'regular_contrib',
    name: 'Regular (with voluntary contribution)',
    amountCents: 5800,
    selfService: true,
  },
  { slug: 'regular', name: 'Regular', amountCents: 5000, selfService: true },
  { slug: 'student', name: 'Student', amountCents: 2500, selfService: false },
  {
    slug: 'public_service',
    name: 'Public Service',
    amountCents: 2000,
    selfService: false,
  },
  { slug: 'honorary', name: 'Honorary', amountCents: 1900, selfService: false },
];

function member(overrides: Partial<MyDuesSummary> = {}): MyDuesSummary {
  const slug = overrides.duesLevel ?? 'regular_contrib';
  const level = LEVELS.find((candidate) => candidate.slug === slug);

  return {
    levelSelfService: level?.selfService ?? true,
    levelActive: true,
    memberId: 'm1',
    duesLevel: 'regular_contrib',
    levelName: 'Regular (with voluntary contribution)',
    amountCents: 5800,
    acceptedOn: null,
    isStudent: false,
    paidThrough: null,
    duesStatus: 'no_record',
    ...overrides,
  };
}

const slugs = (levels: DuesLevel[]) => levels.map((level) => level.slug);

describe('availableDuesLevels', () => {
  it('offers nothing to a sign-in with no member record', () => {
    expect(availableDuesLevels(LEVELS, null)).toEqual([]);
  });

  it('offers the self-service levels to a regular member', () => {
    expect(slugs(availableDuesLevels(LEVELS, member()))).toEqual([
      'regular_contrib',
      'regular',
    ]);
  });

  it('adds student when the member is a student', () => {
    expect(
      slugs(availableDuesLevels(LEVELS, member({ isStudent: true }))),
    ).toEqual(['regular_contrib', 'regular', 'student']);
  });

  it.each(['public_service', 'honorary'])(
    'offers only the FS-assigned %s level',
    (slug) => {
      expect(
        slugs(availableDuesLevels(LEVELS, member({ duesLevel: slug }))),
      ).toEqual([slug]);
    },
  );

  it('offers only student when the FS assigned student, even if is_student is off', () => {
    expect(
      slugs(availableDuesLevels(LEVELS, member({ duesLevel: 'student' }))),
    ).toEqual(['student']);
  });

  it('offers nothing when the FS-assigned non-self-service level is inactive', () => {
    const active = LEVELS.filter((level) => level.slug !== 'honorary');

    expect(
      availableDuesLevels(
        active,
        member({ duesLevel: 'honorary', levelActive: false }),
      ),
    ).toEqual([]);
  });

  it('falls back to self-service when an assigned self-service level is inactive', () => {
    const active = LEVELS.filter((level) => level.slug !== 'regular_contrib');

    expect(
      slugs(
        availableDuesLevels(
          active,
          member({ duesLevel: 'regular_contrib', levelActive: false }),
        ),
      ),
    ).toEqual(['regular']);
  });
});
