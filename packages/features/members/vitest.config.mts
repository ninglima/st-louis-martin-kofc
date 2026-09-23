import { defineConfig } from 'vitest/config';

/**
 * The repo's base tsconfig sets `jsx: "preserve"`, because Next owns the JSX
 * transform for everything it builds. Vitest reads that same tsconfig and so
 * handed JSX straight to the parser, which rejects it -- which is why this
 * package could not render a component in a test until now.
 *
 * Only the transform is configured. The environment stays Node: the component
 * tests render to a string with `react-dom/server`, which is enough to pin
 * what reaches the screen and costs the repo no new test framework.
 */
export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
});
