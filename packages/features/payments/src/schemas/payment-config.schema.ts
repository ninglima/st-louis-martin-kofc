import * as z from 'zod';

export const PaymentConfigSchema = z.object({
  active_provider: z.enum(['stripe', 'square']),
  stripe_publishable_key: z.string(),
  stripe_secret_key: z.string(),
  stripe_webhook_secret: z.string(),
  square_application_id: z.string(),
  square_access_token: z.string(),
  square_location_id: z.string(),
  square_webhook_signature_key: z.string(),
  environment: z.enum(['sandbox', 'production']),
});

export type PaymentConfigFormValues = z.infer<typeof PaymentConfigSchema>;
