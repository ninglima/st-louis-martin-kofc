import type { ClaimedEventEmail } from './types';

export function claimed(
  overrides: Partial<ClaimedEventEmail> = {},
): ClaimedEventEmail {
  return {
    emailId: 'email-1',
    kind: 'confirmation',
    sequence: 0,
    mode: 'live',
    signupId: 'signup-uuid-1',
    eventId: 'event-uuid-1',
    firstName: 'Nick',
    email: 'nick@example.org',
    title: 'Fish Fry',
    location: 'Parish Hall, 123 Main St',
    description: null,
    eventStatus: 'scheduled',
    // 2026-11-06 7:00-9:00 PM Chicago (CST, UTC-6)
    shiftStartsAt: '2026-11-07T01:00:00Z',
    shiftEndsAt: '2026-11-07T03:00:00Z',
    shiftLabel: null,
    ...overrides,
  };
}
