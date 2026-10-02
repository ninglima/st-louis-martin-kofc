import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { MyVolunteeringView } from '@kit/events/components/my-volunteering';
import { EventsService } from '@kit/events/server/events.service';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'My volunteering' });

async function VolunteeringPage() {
  await requirePermission('events', 'view');
  const events = new EventsService(getSupabaseServerClient());
  const read = await readDuesIfDeployed(async () => ({
    data: await events.myVolunteering(),
    reminders: await events.myEventReminders(),
  }));

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        {read.deployed ? (
          <MyVolunteeringView
            data={read.value.data}
            remindersEnabled={read.value.reminders}
          />
        ) : (
          <p className="text-muted-foreground">Not available yet.</p>
        )}
      </PageBody>
    </>
  );
}

export default VolunteeringPage;
