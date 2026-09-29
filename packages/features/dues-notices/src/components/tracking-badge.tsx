import { Badge } from '@kit/ui/badge';

import { TRACKING_LABELS, isProblem } from '../tracking';
import type { Tracking } from '../types';

export function TrackingBadge({ tracking }: { tracking: Tracking }) {
  const problem = isProblem(tracking);

  return (
    <Badge
      variant={problem ? 'destructive' : 'secondary'}
      data-test="tracking-badge"
      data-problem={String(problem)}
    >
      {TRACKING_LABELS[tracking]}
    </Badge>
  );
}
