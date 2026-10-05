import Link from 'next/link';

import { cn } from '@kit/ui/utils';

import type { CalendarDay } from '../lib/calendar';
import { chicagoDate, formatTime } from '../lib/format';
import { WEEKDAYS } from '../schemas';
import type { CalendarEvent } from '../types';

export function MonthCalendar({
  weeks,
  events,
}: {
  month: string;
  weeks: CalendarDay[][];
  events: CalendarEvent[];
}) {
  const byDay = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const day = chicagoDate(event.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border"
      data-test="events-calendar"
    >
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th
                key={d}
                className="text-muted-foreground border-b p-2 text-left font-medium"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.date}>
              {week.map((day) => (
                <td
                  key={day.date}
                  data-test={`calendar-day-${day.date}`}
                  className={cn(
                    'h-28 border-b border-r p-1 align-top',
                    !day.inMonth && 'bg-muted/40 text-muted-foreground',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 text-xs',
                      day.isToday &&
                        'bg-primary text-primary-foreground inline-block rounded px-1',
                    )}
                  >
                    {Number(day.date.slice(8))}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {(byDay.get(day.date) ?? []).map((event) => (
                      <li key={event.id}>
                        <Link
                          href={`/home/events/${event.id}`}
                          data-test={`calendar-event-${event.id}`}
                          className={cn(
                            'block truncate rounded px-1 py-0.5 hover:bg-muted',
                            event.status === 'cancelled' &&
                              'line-through opacity-60',
                            event.signedUp && 'font-semibold',
                          )}
                        >
                          {formatTime(event.startsAt)} {event.title}
                          <span className="text-muted-foreground block text-xs">
                            {event.filled} of {event.capacity}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
