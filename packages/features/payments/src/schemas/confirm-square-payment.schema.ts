import * as z from 'zod';

export const ConfirmSquarePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  sourceToken: z.string().min(1),
});

export type ConfirmSquarePaymentFormValues = z.infer<
  typeof ConfirmSquarePaymentSchema
>;
