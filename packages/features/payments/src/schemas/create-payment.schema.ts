import * as z from 'zod';

export const CreatePaymentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string(),
  payment_type: z.enum(['dues', 'donation', 'event_fee']),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.object({
    item_type: z.string().min(1),
    description: z.string().min(1),
    amount: z.number().int().positive(),
  })).optional(),
});

export type CreatePaymentFormValues = z.infer<typeof CreatePaymentSchema>;
