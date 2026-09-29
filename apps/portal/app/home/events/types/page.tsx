import { EventTypesManager } from '@kit/events/components/event-types-manager';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'Event types' });

async function EventTypesPage() {
  await requirePermission('events', 'manage');
  const types = await new EventsService(getSupabaseServerClient()).types(true);

  return (
    <>
      <PageHeader
        title="Event types"
        description="Each type belongs to one Knights program category."
      />
      <PageBody>
        <EventTypesManager types={types} />
      </PageBody>
    </>
  );
}

export default EventTypesPage;
