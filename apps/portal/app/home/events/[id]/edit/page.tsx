import { notFound } from 'next/navigation';

import { EventForm } from '@kit/events/components/event-form';
import {
  chicagoDate,
  chicagoTime,
  todayInChicago,
} from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'Edit event' });

async function EditEventPage(props: { params: Promise<{ id: string }> }) {
  await requirePermission('events', 'manage');
  const { id } = await props.params;
  const service = new EventsService(getSupabaseServerClient());
  const [event, types] = await Promise.all([
    service.detail(id),
    service.types(true),
  ]);

  if (!event) notFound();

  return (
    <>
      <PageHeader title={`Edit ${event.title}`} />
      <PageBody>
        <EventForm
          types={types.filter((t) => t.active || t.id === event.typeId)}
          today={todayInChicago()}
          eventId={event.id}
          inSeries={event.seriesId !== null}
          initial={{
            type_id: event.typeId,
            title: event.title,
            description: event.description ?? '',
            location: event.location ?? '',
            date: chicagoDate(event.startsAt),
            start_time: chicagoTime(event.startsAt),
            end_time: chicagoTime(event.endsAt),
            lead_member_id: event.leadMemberId ?? '',
            lead_name: event.leadName ?? '',
            is_public: event.isPublic,
            shifts: event.shifts.map((s) => ({
              id: s.id,
              start_time: chicagoTime(s.startsAt),
              end_time: chicagoTime(s.endsAt),
              capacity: s.capacity,
              label: s.label ?? '',
            })),
            repeat: {
              freq: 'none',
              interval: 1,
              weekdays: [],
              weekday: 6,
              nth: 1,
              until: '',
            },
          }}
        />
      </PageBody>
    </>
  );
}

export default EditEventPage;
