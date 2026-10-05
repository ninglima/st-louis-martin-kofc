import Link from 'next/link';

import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

import { formatDay, formatTimeRange } from '../lib/format';
import { CATEGORY_LABELS, type CalendarEvent } from '../types';

export function EventsList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground" data-test="events-list">
        No events in this period.
      </p>
    );
  }

  return (
    <ul
      className="flex flex-col divide-y rounded-lg border"
      data-test="events-list"
    >
      {events.map((event) => (
        <li key={event.id}>
          <Link
            href={`/home/events/${event.id}`}
            data-test={`calendar-event-${event.id}`}
            className={cn(
              'flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-muted',
              event.status === 'cancelled' && 'line-through opacity-60',
            )}
          >
            <span className="flex flex-col">
              <span className="font-medium">{event.title}</span>
              <span className="text-muted-foreground text-sm">
                {formatDay(event.startsAt)} ·{' '}
                {formatTimeRange(event.startsAt, event.endsAt)}
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{CATEGORY_LABELS[event.category]}</Badge>
              {event.filled} of {event.capacity}
              {event.signedUp ? <Badge>Signed up</Badge> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
