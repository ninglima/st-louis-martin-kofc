import type { NoticeKind, Tracking } from './types';

export const TRACKING_LABELS: Record<Tracking, string> = {
  pending: 'Pending',
  dry_run: 'Dry run',
  failed: 'Failed',
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
  suppressed: 'Suppressed',
  complained: 'Complained',
};

export const KIND_LABELS: Record<NoticeKind, string> = {
  before_30: '30 days before',
  due_date: 'Due date',
  after_30: '30 days after',
};

export function isProblem(tracking: Tracking): boolean {
  return (
    tracking === 'bounced' ||
    tracking === 'suppressed' ||
    tracking === 'complained' ||
    tracking === 'failed'
  );
}
