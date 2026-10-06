import { defineConfig } from 'vitest/config';

/**
 * Copied from `@kit/dues`' `vitest.config.ts`. The repo's base tsconfig sets
 * `jsx: "preserve"`, because Next owns the JSX transform for everything it
 * builds; Vitest reads that same tsconfig and would hand JSX straight to the
 * parser, which rejects it. Only the transform is configured -- the
 * environment stays Node.
 */
export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
