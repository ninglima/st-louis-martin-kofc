import type { Retention } from '../types';
import { LapsesByMonthChart, RetentionRateChart } from './insights-charts';

export function RetentionTab({ retention }: { retention: Retention }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RetentionRateChart years={retention.years} />
      <LapsesByMonthChart rows={retention.lapsesByMonth} />
    </div>
  );
}
