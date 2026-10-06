import { vi } from 'vitest';

/**
 * `config.ts` and `send-receipt.ts` import `server-only` so Next rejects
 * client bundles. Vitest runs in Node; stub the package so action tests that
 * transitively import those modules can load.
 */
vi.mock('server-only', () => ({}));
