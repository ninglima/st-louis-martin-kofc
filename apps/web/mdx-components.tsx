import type { MDXComponents } from 'mdx/types';

import Link from 'next/link';

/**
 * Maps MDX elements onto the design system. Written once, inherited by every
 * .mdx page, which is what keeps the content pages free of their own
 * typography styles. Semantic colour tokens only, so dark mode works without
 * per-page effort.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="text-foreground mb-6 text-3xl font-bold tracking-tight lg:text-4xl">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-foreground mt-10 mb-4 text-2xl font-semibold tracking-tight">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-foreground mt-8 mb-3 text-xl font-semibold">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="text-muted-foreground mb-4 leading-7">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="text-muted-foreground mb-4 list-disc space-y-2 pl-6">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="text-muted-foreground mb-4 list-decimal space-y-2 pl-6">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-7">{children}</li>,
    strong: ({ children }) => (
      <strong className="text-foreground font-semibold">{children}</strong>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-border text-muted-foreground my-6 border-l-2 pl-6 italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-border my-8" />,
    a: ({ href, children }) => {
      const url = href ?? '#';
      const isInternal = url.startsWith('/');

      if (isInternal) {
        return (
          <Link
            href={url}
            className="text-primary font-medium underline underline-offset-4"
          >
            {children}
          </Link>
        );
      }

      const isExternalHttp = url.startsWith('http');

      return (
        <a
          href={url}
          className="text-primary font-medium underline underline-offset-4"
          {...(isExternalHttp
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {children}
        </a>
      );
    },
    ...components,
  };
}
