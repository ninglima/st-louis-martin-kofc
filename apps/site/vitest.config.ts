import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * `tsconfig.json` sets `jsx: "preserve"` (Next.js compiles JSX itself), but
 * vitest's default transform (`oxc`, in this vitest version) reads that same
 * setting and leaves JSX untransformed, which fails to parse.
 * `portal-href.test.tsx` is the first test in this app to render JSX, so this
 * override is scoped to this app rather than left implicit.
 *
 * `resolve.alias` mirrors `tsconfig.json`'s `~/*` paths, which vitest does not
 * read on its own -- without it, `components/site-link.tsx`'s `~/lib/*`
 * import would resolve against the wrong module system.
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: [
      { find: '~/config', replacement: `${dirname}/config` },
      { find: '~/components', replacement: `${dirname}/components` },
      { find: '~/lib', replacement: `${dirname}/lib` },
      { find: '~', replacement: `${dirname}/app` },
    ],
  },
});
