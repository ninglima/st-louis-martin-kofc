import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EventDetail } from '../types';
import { ShiftList } from './shift-list';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../server/events-actions', () => ({
  signupAction: vi.fn(),
  cancelSignupAction: vi.fn(),
}));

const future = new Date(Date.now() + 86_400_000).toISOString();
const futureEnd = new Date(Date.now() + 90_000_000).toISOString();

function detail(
  o: Partial<EventDetail['shifts'][number]>,
  me: string | null = 'me',
): EventDetail {
  return {
    id: 'e1',
    title: 'Pantry',
    description: null,
    location: null,
    startsAt: future,
    endsAt: futureEnd,
    status: 'scheduled',
    isPublic: false,
    seriesId: null,
    typeId: 't',
    typeName: 'Food Pantry',
    category: 'community',
    leadMemberId: null,
    leadName: null,
    canTakeAttendance: false,
    canManage: false,
    myMemberId: me,
    shifts: [
      {
        id: 's1',
        startsAt: future,
        endsAt: futureEnd,
        capacity: 2,
        label: null,
        filled: 0,
        signups: [],
        ...o,
      },
    ],
  };
}

describe('ShiftList', () => {
  it('offers Sign up on an open future shift', () => {
    render(<ShiftList event={detail({})} />);
    expect(screen.getByTestId('shift-signup-s1')).toBeInTheDocument();
  });

  it('shows Full when every slot is taken', () => {
    render(<ShiftList event={detail({ filled: 2, signups: [] })} />);
    expect(screen.getByTestId('shift-full-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-signup-s1')).toBeNull();
  });

  it('offers Cancel on my own sign-up and lists names', () => {
    render(
      <ShiftList
        event={detail({
          filled: 1,
          signups: [
            {
              id: 'g1',
              memberId: 'me',
              name: 'Ada Lovelace',
              status: 'signed_up',
              hours: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('shift-cancel-s1')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('offers nothing to an unlinked sign-in', () => {
    render(<ShiftList event={detail({}, null)} />);
    expect(screen.queryByTestId('shift-signup-s1')).toBeNull();
  });
});
