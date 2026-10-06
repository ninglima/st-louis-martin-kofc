import Link from 'next/link';

import { cn } from '@kit/ui/utils';

import { DASHBOARD_TABS } from '../lib/dashboard-tabs';
import type { DashboardTab } from '../types';

const LABELS: Record<DashboardTab, string> = {
  overview: 'Overview',
  collection: 'Collection',
  lapses: 'Lapses',
  retention: 'Retention',
};

export function DashboardTabsNav({ active }: { active: DashboardTab }) {
  return (
    <nav
      className="flex gap-1 border-b"
      aria-label="Dashboard"
      data-test="dashboard-tabs"
    >
      {DASHBOARD_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/home/dashboard?tab=${tab}`}
          aria-current={tab === active ? 'page' : undefined}
          data-test={`dashboard-tab-${tab}`}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            tab === active
              ? 'border-primary text-foreground'
              : 'text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
