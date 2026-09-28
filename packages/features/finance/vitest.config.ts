import { defineConfig } from 'vitest/config';

/**
 * The repo's base tsconfig sets `jsx: "preserve"`, because Next owns the JSX
 * transform for everything it builds. Vitest reads that same tsconfig and so
 * hands JSX straight to the parser, which rejects it -- mirrors
 * `@kit/dues`'s `vitest.config.ts`, which hit this first.
 *
 * Unlike `@kit/dues` (which renders to a string with `react-dom/server`),
 * `hosting-costs-table.test.tsx` drives the hosting cost dialogs through
 * `@testing-library/react`, which needs a real DOM to mount into and to
 * dispatch events against -- hence `environment: 'jsdom'`, new in this
 * package.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
