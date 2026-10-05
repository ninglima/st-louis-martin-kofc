import * as z from 'zod';

export const MIN_OPEN_AMOUNT_CENTS = 50;

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
  // Whole cents, at least $0.50: the processors' minimum, and a floor
  // against 1-cent card-testing charges from a direct POST. The checkout
  // form enforces the same rule with the same message.
  amount: z
    .number()
    .int()
    .min(MIN_OPEN_AMOUNT_CENTS, 'Enter an amount of at least $0.50.'),
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
