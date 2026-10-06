import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// `server-only` throws on import outside a React Server Component. Workspace
// packages that import it are otherwise loaded as real Node modules.
const serverOnly = fileURLToPath(
  new URL('./test/server-only.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      'server-only': serverOnly,
    },
  },
  test: {
    setupFiles: ['./test/setup.ts'],
    server: {
      deps: {
        inline: ['@kit/supabase', 'server-only'],
      },
    },
  },
});
