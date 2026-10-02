export type EventEmailKind = 'confirmation' | 'update' | 'cancel' | 'reminder';

/** One row from `public.event_emails_claim`, in camelCase. */
export interface ClaimedEventEmail {
  emailId: string;
  kind: EventEmailKind;
  sequence: number;
  mode: string;
  signupId: string;
  eventId: string;
  firstName: string;
  email: string;
  title: string;
  location: string | null;
  description: string | null;
  eventStatus: 'scheduled' | 'cancelled';
  shiftStartsAt: string;
  shiftEndsAt: string;
  shiftLabel: string | null;
}
