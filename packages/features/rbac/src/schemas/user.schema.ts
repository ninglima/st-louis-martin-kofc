import * as z from 'zod';

export const CreateUserSchema = z
  .object({
    email: z.string().email(),
    role_id: z.string().uuid(),
    mode: z.enum(['invite', 'password']),
    password: z.string().min(8).optional(),
  })
  .refine((v) => v.mode !== 'password' || (v.password?.length ?? 0) >= 8, {
    message: 'A password of at least 8 characters is required',
    path: ['password'],
  });

export type CreateUserFormValues = z.infer<typeof CreateUserSchema>;
