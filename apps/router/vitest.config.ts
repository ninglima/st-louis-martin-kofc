import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * `@cloudflare/vitest-pool-workers@0.22.0` (needed here for its Vitest 4
 * support) configures the Workers runtime through a Vite plugin
 * (`cloudflareTest`) rather than the `defineWorkersConfig` /
 * `test.poolOptions.workers` shape used by older releases -- the
 * `@cloudflare/vitest-pool-workers/config` entry point that shape depended on
 * no longer exists in this version. This mirrors the shape the package's own
 * `dist/codemods/vitest-v3-to-v4.mjs` migrates existing configs to.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          PORTAL_ORIGIN: 'https://portal-abc.a.run.app',
          ORIGIN_AUTH: 'test-secret',
          DUES_JOBS_SECRET: 'test-jobs',
        },
      },
    }),
  ],
});
