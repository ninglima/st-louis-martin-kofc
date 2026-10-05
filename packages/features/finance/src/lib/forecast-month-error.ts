/**
 * `public.finance_forecast_members` raises Postgres error `P0001` ("unknown
 * forecast month") when a `?month=` value passes `parseMonthParam`'s check
 * against the browser/server's notion of "today" but no longer matches
 * `kit.council_today()` by the time the RPC runs -- a request that straddles
 * midnight on the first of a month (M4). That one race should read as "no
 * month selected", not send the page to the error boundary; any other error
 * from the same call is a real failure and must still throw.
 */
export function isForecastMonthOutOfRangeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code } = error as { code: unknown };

  return code === 'P0001';
}
