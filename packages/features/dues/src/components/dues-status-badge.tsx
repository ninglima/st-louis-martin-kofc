import type { ComponentProps } from 'react';

import { Badge } from '@kit/ui/badge';

import type { DuesStatus } from '../types';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const VARIANT_BY_STATUS: Record<DuesStatus, BadgeVariant> = {
  current: 'default',
  due_soon: 'secondary',
  due: 'destructive',
  lapsed: 'destructive',
  no_record: 'outline',
};

/**
 * Exported so any other screen that lists dues statuses in words -- the
 * members-list filter, most notably -- reads the same five labels as the
 * badge itself, instead of a second hand-copied set that can drift.
 */
export const LABEL_BY_STATUS: Record<DuesStatus, string> = {
  current: 'Current',
  due_soon: 'Due soon',
  due: 'Due',
  lapsed: 'Lapsed',
  no_record: 'No record',
};

export function DuesStatusBadge({ status }: { status: DuesStatus }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status]} data-status={status}>
      {LABEL_BY_STATUS[status]}
    </Badge>
  );
}
