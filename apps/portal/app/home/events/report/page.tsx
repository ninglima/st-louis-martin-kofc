import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { VolunteerReportView } from '@kit/events/components/volunteer-report';
import { todayInChicago } from '@kit/events/lib/format';
import { EventsService } from '@kit/events/server/events.service';
import { YearPicker } from '@kit/finance/components/year-picker';
import {
  fraternalYearOf,
  parseYearParam,
} from '@kit/finance/lib/fraternal-year';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

export const instant = false;
export const generateMetadata = async () => ({ title: 'Volunteer hours' });

async function ReportPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('events', 'manage');
  const today = todayInChicago();
  const year = parseYearParam((await props.searchParams).year, today);
  const current = fraternalYearOf(today);
  const options = Array.from({ length: 6 }, (_, i) => current + 1 - i);
  const read = await readDuesIfDeployed(() =>
    new EventsService(getSupabaseServerClient()).report(year),
  );

  return (
    <>
      <PageHeader
        title="Volunteer hours"
        description={`Fraternal year ${year}–${year + 1}`}
      >
        <YearPicker year={year} options={options} />
      </PageHeader>
      <PageBody>
        {read.deployed ? (
          <VolunteerReportView report={read.value} />
        ) : (
          <p className="text-muted-foreground">Not available yet.</p>
        )}
      </PageBody>
    </>
  );
}

export default ReportPage;
