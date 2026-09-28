import createMDX from '@next/mdx';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * The public site is plain files. `output: 'export'` makes a server-only
 * import, a request-time API or a route handler without a static result fail
 * the build, which is the guard that keeps this app serverless.
 * `cacheComponents` is deliberately off: there is no request to cache
 * against.
 */
/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  transpilePackages: [
    '@kit/ui',
    '@kit/brand',
    '@kit/i18n',
    '@kit/supabase',
    '@kit/accounts',
  ],
  images: { unoptimized: true },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx'],
  },
  experimental: {
    mdxRs: true,
    useTypeScriptCli: true,
  },
  typescript: { ignoreBuildErrors: true },
};

export default withNextIntl(createMDX()(config));
