import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EventDetail } from '../types';
import { AttendancePanel } from './attendance-panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../server/events-actions', () => ({
  addVolunteerAction: vi.fn(),
  setAttendanceAction: vi.fn(),
  searchMembersAction: vi.fn(),
}));

const past = new Date(Date.now() - 86_400_000).toISOString();
const pastEnd = new Date(Date.now() - 82_800_000).toISOString();

const event = {
  id: 'e1',
  shifts: [
    {
      id: 's1',
      startsAt: past,
      endsAt: pastEnd,
      capacity: 2,
      label: null,
      filled: 2,
      signups: [
        {
          id: 'a',
          memberId: 'm1',
          name: 'Ann',
          status: 'signed_up',
          hours: null,
        },
        {
          id: 'b',
          memberId: 'm2',
          name: 'Bob',
          status: 'signed_up',
          hours: null,
        },
        {
          id: 'c',
          memberId: 'm3',
          name: 'Cy',
          status: 'signed_up',
          hours: null,
        },
      ],
    },
  ],
} as unknown as EventDetail;

describe('AttendancePanel email status', () => {
  it('shows the latest email and its delivery state per volunteer', () => {
    render(
      <AttendancePanel
        event={event}
        emailStatus={{
          a: { kind: 'confirmation', tracking: 'delivered', at: past },
          b: { kind: 'reminder', tracking: 'bounced', at: past },
        }}
      />,
    );

    expect(screen.getByTestId('email-status-a')).toHaveTextContent(
      'Confirmation · Delivered',
    );
    expect(screen.getByTestId('email-status-b')).toHaveTextContent(
      'Reminder · Bounced',
    );
    expect(screen.queryByTestId('email-status-c')).toBeNull();
  });
});
