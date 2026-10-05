'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { NativeSelect } from '@kit/ui/native-select';

import { shiftMonth, type CalendarView } from '../lib/calendar';
import type { EventType } from '../types';

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function CalendarToolbar({
  month,
  view,
  typeId,
  types,
  canManage,
}: {
  month: string;
  view: CalendarView;
  typeId: string;
  types: EventType[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) query.set(k, v);
      else query.delete(k);
    }
    return `${pathname}?${query.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={href({ month: shiftMonth(month, -1) })} />}
        >
          ‹
        </Button>
        <span
          className="min-w-36 text-center font-medium"
          data-test="calendar-month"
        >
          {monthLabel(month)}
        </span>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={href({ month: shiftMonth(month, 1) })} />}
        >
          ›
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={
            <Link href={href({ view: view === 'list' ? 'month' : 'list' })} />
          }
        >
          {view === 'list' ? 'Month view' : 'List view'}
        </Button>
        <NativeSelect
          aria-label="Event type"
          data-test="calendar-type-filter"
          value={typeId}
          onChange={(e) => router.replace(href({ type: e.target.value }))}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {canManage ? (
        <div className="flex gap-2">
          <Button
            nativeButton={false}
            render={<Link href="/home/events/new" data-test="event-new" />}
          >
            New event
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href="/home/events/types" data-test="event-types-link" />
            }
          >
            Event types
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href="/home/events/report" data-test="event-report-link" />
            }
          >
            Report
          </Button>
        </div>
      ) : null}
    </div>
  );
}
