/**
 * Records when this run started, so `global-teardown.ts` removes only the
 * dues notice runs the suite itself triggered. Global setup and teardown run
 * in the same Playwright main process, so the value carries across.
 */
export default function globalSetup() {
  process.env.E2E_RUN_STARTED_AT = new Date().toISOString();
}
