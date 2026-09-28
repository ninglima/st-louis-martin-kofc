import createNextIntlPlugin from 'next-intl/plugin';

// Create the next-intl plugin with the request config path
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ENABLE_REACT_COMPILER = process.env.ENABLE_REACT_COMPILER === 'true';

const INTERNAL_PACKAGES = [
  '@kit/ui',
  '@kit/auth',
  '@kit/accounts',
  '@kit/shared',
  '@kit/supabase',
  '@kit/i18n',
  '@kit/next',
  '@kit/brand',
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: INTERNAL_PACKAGES,
  images: {
    remotePatterns: getRemotePatterns(),
    /**
     * Supabase Storage runs on 127.0.0.1 locally, and Next.js 16 blocks
     * optimizing local IPs by default. Only relax this outside production.
     */
    dangerouslyAllowLocalIP: !IS_PRODUCTION,
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  serverExternalPackages: [],
  /** Cloud Run runs `node server.js` from the standalone output. */
  output: 'standalone',
  /**
   * The public site also emits /_next/static. Prefixing the portal's asset
   * URLs keeps the two apart; the router strips the prefix before proxying,
   * so the server still serves the files at /_next/static.
   */
  assetPrefix: '/portal-assets',
  /**
   * Partial Prerendering. Every route ships a static shell that serves
   * immediately, and anything behind a Suspense boundary streams in per
   * request. The kit ships zero `export const instant = false` opt-outs.
   */
  cacheComponents: true,
  /** Builds one App Shell per route and reuses it for every link to it. */
  partialPrefetching: true,
  reactCompiler: ENABLE_REACT_COMPILER,
  experimental: {
    serverActions: {
      /**
       * The roster upload posts the Officers Online export through a Server
       * Action, and Next.js caps an action body at 1 MB by default.
       *
       * Deliberately ABOVE the 5 MB ceiling `previewRosterAction` enforces,
       * not equal to it. This limit is measured on the raw HTTP body, which
       * for a `multipart/form-data` post is the file plus boundaries, part
       * headers and field metadata — Next's own documentation puts that at
       * 10–20 KB and says to leave room for it. Set to exactly '5mb', a file
       * of 4.99 MB — under the ceiling, and legitimate — would be refused by
       * the framework instead of by the action, and a framework refusal
       * reaches the officer as a generic failure with no message in it. The
       * ceiling stays 5 MB; it is just enforced in the one place that can
       * explain itself.
       */
      bodySizeLimit: '6mb',
    },
    /** TypeScript 7 does not expose the compiler API Next.js uses, so drive it
     * through the TS CLI instead. */
    useTypeScriptCli: true,
    optimizePackageImports: [
      'recharts',
      'lucide-react',
      '@base-ui/react',
      'date-fns',
      ...INTERNAL_PACKAGES,
    ],
  },
  modularizeImports: {
    lodash: {
      transform: 'lodash/{{member}}',
    },
  },
  /** We already do typechecking as a separate task in CI. Next.js 16 removed
   * the `eslint` option along with `next lint`; linting runs via the ESLint CLI. */
  typescript: { ignoreBuildErrors: true },
};

export default withNextIntl(config);

function getRemotePatterns() {
  /** @type {import('next').NextConfig['remotePatterns']} */
  const remotePatterns = [];

  if (SUPABASE_URL) {
    const hostname = new URL(SUPABASE_URL).hostname;

    remotePatterns.push({
      protocol: 'https',
      hostname,
    });
  }

  return IS_PRODUCTION
    ? remotePatterns
    : [
        {
          protocol: 'http',
          hostname: '127.0.0.1',
        },
        {
          protocol: 'http',
          hostname: 'localhost',
        },
      ];
}
