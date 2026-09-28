import { defineConfig } from 'vitest/config';

/**
 * The repo's base tsconfig sets `jsx: "preserve"`, because Next owns the JSX
 * transform for everything it builds. Vitest reads that same tsconfig and so
 * hands JSX straight to the parser, which rejects it -- mirrors
 * `@kit/members`'s `vitest.config.mts`, which hit this first.
 *
 * Only the transform is configured. The environment stays Node:
 * `dues-status-badge.test.tsx` renders to a string with `react-dom/server`,
 * which is enough to pin what reaches the screen and costs the repo no new
 * test framework.
 */
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
