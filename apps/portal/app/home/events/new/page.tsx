import { EventForm } from '@kit/events/components/event-form';
import { todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'New event' });

async function NewEventPage() {
  await requirePermission('events', 'manage');
  const types = await new EventsService(getSupabaseServerClient()).types();

  return (
    <>
      <PageHeader title="New event" />
      <PageBody>
        <EventForm types={types} today={todayInChicago()} />
      </PageBody>
    </>
  );
}

export default NewEventPage;
