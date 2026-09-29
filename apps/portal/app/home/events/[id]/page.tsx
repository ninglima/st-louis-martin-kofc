import Link from 'next/link';
import { notFound } from 'next/navigation';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { AttendancePanel } from '@kit/events/components/attendance-panel';
import { CancelEventButtons } from '@kit/events/components/cancel-event-buttons';
import { ShiftList } from '@kit/events/components/shift-list';
import { formatDay, formatTimeRange } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { CATEGORY_LABELS } from '@kit/events/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;

export const generateMetadata = async () => ({ title: 'Event' });

async function EventPage(props: { params: Promise<{ id: string }> }) {
  await requirePermission('events', 'view');

  const { id } = await props.params;
  const read = await readDuesIfDeployed(() =>
    new EventsService(getSupabaseServerClient()).detail(id),
  );

  if (!read.deployed) {
    return (
      <PageBody>
        <p className="text-muted-foreground">Not available yet.</p>
      </PageBody>
    );
  }

  const event = read.value;
  if (!event) notFound();

  return (
    <>
      <PageHeader
        title={event.title}
        description={`${formatDay(event.startsAt)} · ${formatTimeRange(event.startsAt, event.endsAt)}`}
      >
        {event.canManage && event.status === 'scheduled' ? (
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/home/events/${event.id}/edit`}
                  data-test="event-edit"
                />
              }
            >
              Edit
            </Button>
            <CancelEventButtons
              eventId={event.id}
              inSeries={event.seriesId !== null}
            />
          </>
        ) : null}
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{CATEGORY_LABELS[event.category]}</Badge>
            <span>{event.typeName}</span>
            {event.location ? <span>· {event.location}</span> : null}
            {event.leadName ? <span>· Lead: {event.leadName}</span> : null}
            {event.status === 'cancelled' ? (
              <Badge variant="destructive">Cancelled</Badge>
            ) : null}
          </div>
          {event.description ? (
            <p className="whitespace-pre-line">{event.description}</p>
          ) : null}
          {event.myMemberId === null ? (
            <p className="text-muted-foreground text-sm">
              Your sign-in is not linked to a council member record, so you
              cannot sign up yet.
            </p>
          ) : null}
          <ShiftList event={event} />
          {event.canTakeAttendance && event.status === 'scheduled' ? (
            <AttendancePanel event={event} />
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

export default EventPage;
