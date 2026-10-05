import { KIND_LABELS } from '../tracking';
import type { LastNotice } from '../types';
import { TrackingBadge } from './tracking-badge';

const fmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'America/Chicago',
});

export function LastNoticeCell({ notice }: { notice: LastNotice | undefined }) {
  if (!notice) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="flex items-center gap-2" data-test="last-notice">
      <span>
        {KIND_LABELS[notice.kind]}, {fmt.format(new Date(notice.sentAt))}
      </span>
      <TrackingBadge tracking={notice.tracking} />
    </span>
  );
}
