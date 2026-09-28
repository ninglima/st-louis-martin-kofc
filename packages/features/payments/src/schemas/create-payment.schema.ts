import * as z from 'zod';

const common = {
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

/**
 * Dues carry a level, never an amount: `createPaymentAction` prices them
 * from `dues_levels`. `.strip()` drops any `amount`/`currency` a forged
 * request sends, so they cannot even reach the action.
 */
export const DuesPaymentSchema = z
  .object({
    payment_type: z.literal('dues'),
    level: z.string().min(1),
    ...common,
  })
  .strip();

export const OpenPaymentSchema = z.object({
  payment_type: z.enum(['donation', 'event_fee']),
  amount: z.number().int().positive(),
  currency: z.string(),
  items: z
    .array(
      z.object({
        item_type: z.string().min(1),
        description: z.string().min(1),
        amount: z.number().int().positive(),
      }),
    )
    .optional(),
  ...common,
});

export const CreatePaymentSchema = z.discriminatedUnion('payment_type', [
  DuesPaymentSchema,
  OpenPaymentSchema,
]);

export type CreatePaymentFormValues = z.infer<typeof CreatePaymentSchema>;
