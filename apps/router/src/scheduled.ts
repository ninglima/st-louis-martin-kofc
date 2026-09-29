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

  const url = new URL('/api/jobs/dues-notices', env.PORTAL_ORIGIN);

  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.DUES_JOBS_SECRET}`,
        'x-origin-auth': env.ORIGIN_AUTH,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Dues notices job request failed:', message);
    return null;
  }

  if (!response.ok) {
    console.error(`Dues notices job answered ${response.status}`);
  }

  return response;
}
