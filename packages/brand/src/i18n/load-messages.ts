/**
 * Translation namespaces shared by the site and the portal. Each lives in
 * `packages/brand/i18n/messages/<locale>/<namespace>.json`.
 */
export const MESSAGE_NAMESPACES = [
  'common',
  'auth',
  'account',
  'teams',
  'billing',
  'marketing',
  'payments',
  'rbac',
] as const;

export async function loadMessages(
  locale: string,
): Promise<Record<string, unknown>> {
  const loaded: Record<string, unknown> = {};

  await Promise.all(
    MESSAGE_NAMESPACES.map(async (namespace) => {
      try {
        const messages = await import(
          `../../i18n/messages/${locale}/${namespace}.json`
        );
        loaded[namespace] = messages.default;
      } catch (error) {
        console.warn(
          `Failed to load namespace "${namespace}" for locale "${locale}":`,
          error,
        );
        loaded[namespace] = {};
      }
    }),
  );

  return loaded;
}
