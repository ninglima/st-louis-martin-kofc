import { cleanUpE2EData } from './tests/utils/cleanup';

export default async function globalTeardown() {
  await cleanUpE2EData(process.env.E2E_RUN_STARTED_AT);
}
