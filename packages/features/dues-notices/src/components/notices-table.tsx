'use client';

import { useState, useTransition } from 'react';

import Link from 'next/link';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { loadNoticeEventsAction } from '../server/notice-actions';
import { KIND_LABELS } from '../tracking';
import type { NoticeEvent, NoticeRow } from '../types';
import { TrackingBadge } from './tracking-badge';

/**
 * Local copy of `@kit/finance`'s `addDaysIso` (`lib/dates.ts`): pulling that
 * package in just for one day of UTC math would make `@kit/finance` and
 * `@kit/dues-notices` depend on each other in both directions (finance
 * already depends on this package for the Last notice column).
 */
function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const eventTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Chicago',
});

function labelEventType(type: string): string {
  return type
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function NoticeTableRow({
  row,
  canOpenMembers,
}: {
  row: NoticeRow;
  canOpenMembers: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<NoticeEvent[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const name = `${row.firstName} ${row.lastName}`;
  const lastCoveredDay = addDaysIso(row.cycleDate, -1);
  const sentDate = (row.sentAt ?? row.createdAt).slice(0, 10);

  const onToggle = () => {
    const next = !expanded;
    setExpanded(next);

    if (next && events === null) {
      startTransition(async () => {
        const result = await loadNoticeEventsAction(row.id);
        setEvents(result.success ? result.events : []);
      });
    }
  };

  return (
    <>
      <TableRow data-test="dues-notice-row">
        <TableCell>
          {canOpenMembers ? (
            <Link href={`/home/members/${row.memberId}`}>{name}</Link>
          ) : (
            name
          )}
        </TableCell>
        <TableCell>{KIND_LABELS[row.kind]}</TableCell>
        <TableCell>{lastCoveredDay}</TableCell>
        <TableCell>{sentDate}</TableCell>
        <TableCell>
          <TrackingBadge tracking={row.tracking} />
        </TableCell>
        <TableCell>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? 'Hide events' : 'Show events'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={6}>
            {row.error ? (
              <p
                className="text-destructive mb-2 text-sm"
                data-test="dues-notice-error"
              >
                {row.error}
              </p>
            ) : null}
            {isPending || events === null ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : events.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {row.error
                  ? 'No delivery events (the email never reached Resend).'
                  : 'No events yet.'}
              </p>
            ) : (
              <ul
                data-test="dues-notice-events"
                className="flex flex-col gap-1 text-sm"
              >
                {events.map((event, index) => (
                  <li key={index}>
                    {labelEventType(event.type)} —{' '}
                    {eventTimeFmt.format(new Date(event.occurredAt))}
                  </li>
                ))}
              </ul>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function NoticesTable({
  rows,
  canOpenMembers,
}: {
  rows: NoticeRow[];
  canOpenMembers: boolean;
}) {
  return (
    <Card data-test="dues-notices-table">
      <CardHeader>
        <CardTitle>Dues notices</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No dues notices yet.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>
                    <span className="sr-only">Events</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <NoticeTableRow
                    key={row.id}
                    row={row}
                    canOpenMembers={canOpenMembers}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
