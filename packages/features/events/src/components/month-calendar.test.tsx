import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { monthGrid } from '../lib/calendar';
import type { CalendarEvent } from '../types';
import { MonthCalendar } from './month-calendar';

const event = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1',
  title: 'Pantry',
  typeId: 't',
  typeName: 'Food Pantry',
  category: 'community',
  startsAt: '2040-10-14T04:30:00Z',
  endsAt: '2040-10-14T06:00:00Z',
  status: 'scheduled',
  isPublic: false,
  seriesId: null,
  capacity: 6,
  filled: 3,
  signedUp: false,
  ...o,
});

describe('MonthCalendar', () => {
  it('puts a late-evening event on its Chicago day with its fill count', () => {
    render(
      <MonthCalendar
        month="2040-10"
        weeks={monthGrid('2040-10', '2040-10-01')}
        events={[event({})]}
      />,
    );

    const cell = screen.getByTestId('calendar-day-2040-10-13');
    expect(cell).toHaveTextContent('Pantry');
    expect(cell).toHaveTextContent('3 of 6');
  });

  it('strikes through a cancelled event', () => {
    render(
      <MonthCalendar
        month="2040-10"
        weeks={monthGrid('2040-10', '2040-10-01')}
        events={[event({ status: 'cancelled' })]}
      />,
    );

    expect(screen.getByTestId('calendar-event-e1')).toHaveClass('line-through');
  });
});
