import {
  TRACKING_LABELS as EMAIL_TRACKING_LABELS,
  isProblem,
} from '@kit/email/tracking';

import type { NoticeKind, Tracking } from './types';

export { isProblem };

// `no_email` is an event-emails state; dues notices never have it.
const { no_email: _noEmail, ...duesLabels } = EMAIL_TRACKING_LABELS;

export const TRACKING_LABELS: Record<Tracking, string> = duesLabels;

export const KIND_LABELS: Record<NoticeKind, string> = {
  before_30: '30 days before',
  due_date: 'Due date',
  after_30: '30 days after',
};
