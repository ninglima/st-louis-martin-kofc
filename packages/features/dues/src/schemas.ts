import * as z from 'zod';

import { DUES_METHODS_FS } from './types';

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, 'Not a real date');

/**
 * "Today" as the council sees it, not as the server's clock does.
 * `record_dues_payment` (20260928120100_dues_writes.sql) rejects
 * `p_received_on > current_date`, and the online-payment trigger
 * (`kit.record_online_dues_period`, 20260928120200_dues_online_and_load.sql)
 * is explicit that the council's "today" is `America/Chicago`, not UTC and
 * not the DB session's timezone. Mirroring that same zone here means a
 * payment entered late in the evening Central time is never rejected as "in
 * the future" purely because UTC has already rolled to the next calendar
 * day.
 *
 * Exported so `RecordPaymentForm` can default and cap its "received on"
 * input to the same day this schema judges "today" by -- the browser's own
 * local date would default the form to "tomorrow", and then reject its own
 * default, for an FS signed in from east of Central in the last hour or so
 * of the Chicago day.
 */
export function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const RecordPaymentSchema = z
  .object({
    memberId: z.string().uuid(),
    level: z.string().min(1),
    method: z.enum(DUES_METHODS_FS),
    receivedOn: IsoDate,
    checkNumber: z.string().trim().optional(),
  })
  .strip()
  .refine((v) => v.method !== 'check' || !!v.checkNumber, {
    message: 'A check number is required for check payments',
    path: ['checkNumber'],
  })
  .refine((v) => v.receivedOn <= chicagoToday(), {
    message: 'The received date cannot be in the future',
    path: ['receivedOn'],
  });

export const VoidPeriodSchema = z.object({
  periodId: z.string().uuid(),
  reason: z.string().trim().min(1, 'A reason is required'),
});

export const AcceptedOnSchema = z.object({
  memberId: z.string().uuid(),
  acceptedOn: IsoDate,
});

export const LevelSchema = z.object({
  memberId: z.string().uuid(),
  level: z.string().min(1),
});

export const StudentSchema = z.object({
  memberId: z.string().uuid(),
  isStudent: z.boolean(),
});

/**
 * The raw text of an uploaded paid-through CSV, before it ever reaches
 * `parsePaidThroughCsv`. A Server Action is reachable with any payload a
 * caller cares to construct -- not just the file `PaidThroughImport` reads
 * client-side -- so the size cap is enforced here, not just by the 1 MB
 * check the component makes before it ever calls the action. 1,000,000
 * characters comfortably covers a multi-thousand-row three-column CSV while
 * keeping a single adversarial payload from tying up the preview parsing an
 * unbounded string.
 */
export const PaidThroughCsvTextSchema = z
  .string()
  .trim()
  .min(1, 'Choose a CSV file to upload.')
  .max(1_000_000, 'That file is larger than 1 MB.');

/**
 * A single parsed row of the paid-through CSV load, re-validated before it is
 * sent to `dues_opening_balances_apply`. The client only ever gets a row here
 * by way of `parsePaidThroughCsv`, but the action never trusts that --
 * `applyPaidThroughAction` is a Server Action, reachable with any payload a
 * caller cares to construct.
 */
export const PaidThroughRowSchema = z
  .object({
    line: z.number().int().positive(),
    membershipNumber: z.string().trim().min(1),
    paidThrough: IsoDate,
    duesLevel: z.string().trim().min(1).optional(),
  })
  .strip();

/**
 * Capped at 5,000 rows: `dues_opening_balances_apply` takes the whole array
 * in one RPC call and locks one `members` row (`for update`) per row it
 * processes, so an unbounded array is an unbounded single transaction. The
 * preview enforces the same cap before it ever gets here (see
 * `paid-through-actions.ts`), so this is the second line of defence for a
 * caller that skips the preview.
 */
export const PaidThroughRowsSchema = z
  .array(PaidThroughRowSchema)
  .min(1)
  .max(5000, 'That load has more than 5,000 rows.');
