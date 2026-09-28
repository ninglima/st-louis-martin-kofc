import { z } from 'zod';

const PathsSchema = z.object({
  auth: z.object({
    signIn: z.string().min(1),
    signUp: z.string().min(1),
    verifyMfa: z.string().min(1),
    callback: z.string().min(1),
    passwordReset: z.string().min(1),
    passwordUpdate: z.string().min(1),
  }),
  app: z.object({
    home: z.string().min(1),
    profileSettings: z.string().min(1),
    payments: z.string().min(1),
    paymentSettings: z.string().min(1),
    checkout: z.string().min(1),
    members: z.string().min(1),
    users: z.string().min(1),
    roles: z.string().min(1),
  }),
});

const pathsConfig = PathsSchema.parse({
  auth: {
    signIn: '/auth/sign-in',
    signUp: '/auth/sign-up',
    verifyMfa: '/auth/verify',
    callback: '/auth/callback',
    passwordReset: '/auth/password-reset',
    passwordUpdate: '/update-password',
  },
  app: {
    home: '/home',
    profileSettings: '/home/settings',
    payments: '/home/payments',
    paymentSettings: '/home/settings/payments',
    checkout: '/home/checkout',
    members: '/home/members',
    users: '/home/settings/users',
    roles: '/home/settings/roles',
  },
} satisfies z.infer<typeof PathsSchema>);

export default pathsConfig;

/**
 * Every path the member portal serves. The router proxies exactly these to
 * Cloud Run and serves everything else from the static site, and the portal's
 * `proxy.ts` reads the same list, so the two cannot drift apart. Matching is
 * per path segment: `/home` and `/home/x` are portal paths, `/homework` is not.
 */
export const PORTAL_PREFIXES = [
  '/home',
  '/auth',
  '/update-password',
  '/api',
  '/version',
  '/portal-assets',
] as const;

export function isPortalPath(pathname: string): boolean {
  return PORTAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
