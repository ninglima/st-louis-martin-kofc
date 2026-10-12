import * as z from 'zod';

import { addDaysIso, daysBetween } from './lib/dates';
import { parseDollarsToCents } from './lib/money';
import type { HostingCostInput } from './types';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date')
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().startsWith(v),
    'Enter a real date',
  )
  // Matches the lower bound `kit.assert_fraternal_year` enforces (year
  // 2000): a typo like "0026-…" would otherwise pass the 3-year span check
  // below and reach `finance_net_by_year`, producing years of bogus rows.
  .refine((v) => v >= '2000-01-01', 'Enter a date from 2000 on');

export const HostingCostFormSchema = z
  .object({
    id: z.string().uuid().optional(),
    provider: z.string().min(1, 'Choose a provider'),
    amount: z
      .string()
      .refine(
        (v) => parseDollarsToCents(v) !== null,
        'Enter an amount like 25 or 25.00',
      ),
    paidOn: isoDate,
    coversFrom: isoDate,
    /** Inclusive: the last day the bill covers. */
    coversTo: isoDate,
    note: z
      .string()
      .max(500, 'The note can be at most 500 characters')
      .optional(),
  })
  .refine((v) => v.coversTo >= v.coversFrom, {
    message: 'The last covered day must be on or after the first',
    path: ['coversTo'],
  })
  .refine((v) => daysBetween(v.coversFrom, addDaysIso(v.coversTo, 1)) <= 1096, {
    message: 'A bill can cover at most 3 years',
    path: ['coversTo'],
  });

export type HostingCostForm = z.infer<typeof HostingCostFormSchema>;

export function toHostingCostInput(form: HostingCostForm): HostingCostInput {
  return {
    id: form.id ?? null,
    provider: form.provider,
    amountCents: parseDollarsToCents(form.amount) as number,
    paidOn: form.paidOn,
    periodStart: form.coversFrom,
    periodEnd: addDaysIso(form.coversTo, 1),
    note: form.note?.trim() ? form.note.trim() : null,
  };
}

export const DeleteHostingCostSchema = z.object({ id: z.string().uuid() });

export const RepeatLastBillSchema = z.object({ provider: z.string().min(1) });

export const OverlapCheckSchema = z.object({
  provider: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  excludeId: z.string().uuid().optional(),
});

export const PaymentPacketFormSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: z
      .string()
      .trim()
      .min(1, 'Enter a label')
      .max(120, 'The label can be at most 120 characters'),
    supreme: z.string(),
    state: z.string(),
    note: z
      .string()
      .max(500, 'The note can be at most 500 characters')
      .optional(),
  })
  .superRefine((value, ctx) => {
    const supremeBlank = value.supreme.trim() === '';
    const stateBlank = value.state.trim() === '';

    if (!supremeBlank && parseDollarsToCents(value.supreme) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['supreme'],
        message: 'Enter an amount like 25 or 25.00',
      });
    }
    if (!stateBlank && parseDollarsToCents(value.state) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Enter an amount like 25 or 25.00',
      });
    }
    if (supremeBlank && stateBlank) {
      ctx.addIssue({
        code: 'custom',
        path: ['supreme'],
        message: 'Enter a Supreme or a state total',
      });
    }
  });

export function toPaymentPacketCents(input: {
  supreme: string;
  state: string;
}): {
  supremeCents: number | null;
  stateCents: number | null;
} {
  return {
    supremeCents:
      input.supreme.trim() === '' ? null : parseDollarsToCents(input.supreme),
    stateCents:
      input.state.trim() === '' ? null : parseDollarsToCents(input.state),
  };
}
