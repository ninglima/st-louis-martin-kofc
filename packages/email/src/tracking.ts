export type Tracking =
  | 'pending'
  | 'dry_run'
  | 'failed'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'suppressed'
  | 'complained'
  | 'no_email';

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
  no_email: 'No email',
};

export function isProblem(tracking: Tracking): boolean {
  return (
    tracking === 'bounced' ||
    tracking === 'suppressed' ||
    tracking === 'complained' ||
    tracking === 'failed'
  );
}
