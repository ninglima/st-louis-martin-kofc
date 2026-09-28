import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { SiteLink } from '../components/site-link';
import { portalHref } from './portal-href';

describe('portalHref', () => {
  it('leaves portal links relative in production (same origin)', () => {
    expect(portalHref('/auth/sign-in?next=/home/checkout')).toBe(
      '/auth/sign-in?next=/home/checkout',
    );
  });

  it('prefixes portal links with the dev portal URL, keeping the query', () => {
    expect(
      portalHref('/auth/sign-in?next=/home/checkout', 'http://localhost:3001'),
    ).toBe('http://localhost:3001/auth/sign-in?next=/home/checkout');
  });

  it('never prefixes site links', () => {
    expect(portalHref('/who-we-are', 'http://localhost:3001')).toBe(
      '/who-we-are',
    );
    expect(portalHref('/homework', 'http://localhost:3001')).toBe('/homework');
  });

  it('leaves external and fragment links alone', () => {
    expect(portalHref('https://kofc.org', 'http://localhost:3001')).toBe(
      'https://kofc.org',
    );
    expect(portalHref('#main-content', 'http://localhost:3001')).toBe(
      '#main-content',
    );
  });

  it('tolerates a trailing slash on the portal URL', () => {
    expect(portalHref('/home', 'http://localhost:3001/')).toBe(
      'http://localhost:3001/home',
    );
  });
});

describe('SiteLink', () => {
  it('renders a portal link as a plain anchor with the portal href', () => {
    const html = renderToStaticMarkup(
      <SiteLink href={'/auth/sign-in?next=/home/checkout'}>Sign in</SiteLink>,
    );

    expect(html).toBe(
      '<a href="/auth/sign-in?next=/home/checkout">Sign in</a>',
    );
  });
});
