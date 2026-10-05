import { defineConfig } from 'vitest/config';

/**
 * The repo's base tsconfig sets `jsx: "preserve"`, because Next owns the JSX
 * transform for everything it builds. Vitest reads that same tsconfig and so
 * hands JSX straight to the parser, which rejects it -- mirrors
 * `@kit/dues`'s `vitest.config.ts`, which hit this first.
 *
 * Unlike `@kit/dues` (which renders to a string with `react-dom/server`),
 * this package's component tests render through `@testing-library/react`,
 * which needs a real DOM to mount into -- hence `environment: 'jsdom'`, new
 * in this package.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
