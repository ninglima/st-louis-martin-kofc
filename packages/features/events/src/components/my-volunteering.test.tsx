import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MyVolunteeringView } from './my-volunteering';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const setReminders = vi.hoisted(() => vi.fn());
vi.mock('../server/events-actions', () => ({
  cancelSignupAction: vi.fn(),
  setEventRemindersAction: setReminders,
}));
vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('MyVolunteeringView', () => {
  it('explains an unlinked sign-in', () => {
    render(<MyVolunteeringView data={{ linked: false }} />);
    expect(screen.getByTestId('volunteering-unlinked')).toBeInTheDocument();
  });

  it('shows hours, categories, upcoming and history', () => {
    render(
      <MyVolunteeringView
        data={{
          linked: true,
          year: 2026,
          yearHours: 12.5,
          allTimeHours: 40,
          byCategory: [
            { category: 'faith', hours: 0 },
            { category: 'family', hours: 2.5 },
            { category: 'community', hours: 10 },
            { category: 'life', hours: 0 },
          ],
          upcoming: [
            {
              signupId: 's1',
              eventId: 'e1',
              title: 'Pantry',
              startsAt: '2040-10-13T14:00:00Z',
              endsAt: '2040-10-13T16:00:00Z',
              label: null,
            },
          ],
          history: [
            {
              signupId: 's2',
              eventId: 'e2',
              title: 'Breakfast',
              typeName: 'Breakfast with Knights',
              startsAt: '2026-09-01T13:00:00Z',
              status: 'attended',
              hours: 2.5,
              eventCancelled: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('volunteering-year-hours')).toHaveTextContent(
      '12.5',
    );
    expect(screen.getByTestId('volunteering-all-hours')).toHaveTextContent(
      '40',
    );
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByTestId('volunteering-upcoming')).toHaveTextContent(
      'Pantry',
    );
    expect(screen.getByTestId('volunteering-history')).toHaveTextContent(
      'Attended',
    );
  });

  const linked = {
    linked: true as const,
    year: 2026,
    yearHours: 0,
    allTimeHours: 0,
    byCategory: [],
    upcoming: [],
    history: [],
  };

  it('shows the reminder switch from the saved value and flips it', async () => {
    setReminders.mockResolvedValue({ success: true });
    render(<MyVolunteeringView data={linked} remindersEnabled={true} />);

    const sw = screen.getByTestId('volunteering-reminders');
    expect(sw).toBeChecked();
    expect(
      screen.getByText('Email me a reminder the day before'),
    ).toBeInTheDocument();

    fireEvent.click(sw);
    await waitFor(() =>
      expect(setReminders).toHaveBeenCalledWith({ enabled: false }),
    );
  });

  it('hides the reminder switch when the value is null', () => {
    render(<MyVolunteeringView data={linked} remindersEnabled={null} />);
    expect(screen.queryByTestId('volunteering-reminders')).toBeNull();
  });
});
