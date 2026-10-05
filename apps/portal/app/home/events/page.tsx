import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { CalendarToolbar } from '@kit/events/components/calendar-toolbar';
import { EventsList } from '@kit/events/components/events-list';
import { MonthCalendar } from '@kit/events/components/month-calendar';
import {
  addDays,
  gridRange,
  monthGrid,
  parseMonthParam,
  parseTypeParam,
  parseViewParam,
} from '@kit/events/lib/calendar';
import { chicagoDate, todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';

import {
  getCurrentPermissions,
  requirePermission,
} from '~/lib/server/require-permission';

export const instant = false;

export const generateMetadata = async () => ({ title: 'Events' });

type SearchParams = Record<string, string | string[] | undefined>;

async function EventsPage(props: { searchParams: Promise<SearchParams> }) {
  await requirePermission('events', 'view');

  const params = await props.searchParams;
  const today = todayInChicago();
  const month = parseMonthParam(params.month, today);
  const view = parseViewParam(params.view);
  const typeId = parseTypeParam(params.type);
  const canManage = hasPermission(
    await getCurrentPermissions(),
    'events',
    'manage',
  );

  const weeks = monthGrid(month, today);
  const range =
    view === 'list'
      ? { from: today, to: addDays(today, 60) }
      : gridRange(weeks);
  const service = new EventsService(getSupabaseServerClient());

  const read = await readDuesIfDeployed(() =>
    Promise.all([
      service.types(),
      service.inRange(range.from, range.to, typeId || null),
    ]),
  );

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        {!read.deployed ? (
          <p className="text-muted-foreground" data-test="events-unavailable">
            Not available yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <CalendarToolbar
              month={month}
              view={view}
              typeId={typeId}
              types={read.value[0]}
              canManage={canManage}
            />
            {view === 'list' ? (
              <EventsList events={read.value[1]} />
            ) : (
              <>
                <div className="hidden md:block">
                  <MonthCalendar
                    month={month}
                    weeks={weeks}
                    events={read.value[1]}
                  />
                </div>
                <div className="md:hidden">
                  <EventsList
                    events={read.value[1].filter((e) =>
                      chicagoDate(e.startsAt).startsWith(month),
                    )}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}

export default EventsPage;
