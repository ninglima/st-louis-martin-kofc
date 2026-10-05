import type { Env } from './env';

/** Daily cron: wake the portal and run one of its jobs. */
export async function runJobTrigger(
  env: Env,
  path: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  if (!env.DUES_JOBS_SECRET) {
    console.warn(`DUES_JOBS_SECRET is not set; skipping the ${label} job.`);
    return null;
  }

  const url = new URL(path, env.PORTAL_ORIGIN);

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
    console.error(`${label} job request failed:`, message);
    return null;
  }

  if (!response.ok) {
    console.error(`${label} job answered ${response.status}`);
  }

  return response;
}

export function runDuesNoticesTrigger(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  return runJobTrigger(
    env,
    '/api/jobs/dues-notices',
    'Dues notices',
    fetchImpl,
  );
}

export function runEventEmailsTrigger(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  return runJobTrigger(
    env,
    '/api/jobs/event-emails',
    'Event emails',
    fetchImpl,
  );
}
