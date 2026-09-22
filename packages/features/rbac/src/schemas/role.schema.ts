import * as z from 'zod';

export const RolePermissionSchema = z.object({
  section: z.string().min(1),
  can_view: z.boolean(),
  can_manage: z.boolean(),
});

export const RoleSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
  name: z.string().min(2).max(100),
  description: z.string().max(500),
  is_default: z.boolean(),
  permissions: z.array(RolePermissionSchema),
});

export type RoleFormValues = z.infer<typeof RoleSchema>;
