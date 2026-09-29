import type { Env } from './env';

/** Daily cron: wake the portal and run the dues notices job. */
export async function runDuesNoticesTrigger(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  if (!env.DUES_JOBS_SECRET) {
    console.warn('DUES_JOBS_SECRET is not set; skipping the dues notices job.');
    return null;
  }

  const response = await fetchImpl(
    `${env.PORTAL_ORIGIN}/api/jobs/dues-notices`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.DUES_JOBS_SECRET}`,
        'x-origin-auth': env.ORIGIN_AUTH,
      },
    },
  );

  if (!response.ok) {
    console.error(`Dues notices job answered ${response.status}`);
  }

  return response;
}
