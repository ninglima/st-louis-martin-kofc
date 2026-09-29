export interface Env {
  ASSETS: Fetcher;
  PORTAL_ORIGIN: string;
  ORIGIN_AUTH: string;
  /** Local stack only: pretend the portal is cold for this many ms. */
  SIMULATE_COLD_START_MS?: string;
  /** Local stack only: how long without portal traffic counts as idle. */
  SIMULATE_IDLE_MS?: string;
  /** Shared secret for the daily dues notices cron; unset skips the job. */
  DUES_JOBS_SECRET?: string;
}
