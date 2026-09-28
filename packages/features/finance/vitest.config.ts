import { defineConfig } from 'vitest/config';

/**
 * The repo's base tsconfig sets `jsx: "preserve"`, because Next owns the JSX
 * transform for everything it builds. Vitest reads that same tsconfig and so
 * hands JSX straight to the parser, which rejects it -- mirrors
 * `@kit/dues`'s `vitest.config.ts`, which hit this first.
 *
 * Only the transform is configured. The environment stays Node.
 */
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
