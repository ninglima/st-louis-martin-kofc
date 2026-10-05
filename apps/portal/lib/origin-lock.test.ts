import { describe, expect, it } from 'vitest';

import { checkOriginAuth } from './origin-lock';

describe('checkOriginAuth', () => {
  it('allows the matching secret', () => {
    expect(checkOriginAuth('s3cret', 's3cret', 'production')).toBe('allow');
  });

  it('denies a missing header', () => {
    expect(checkOriginAuth(null, 's3cret', 'production')).toBe('deny');
  });

  it('denies a wrong or prefix-only value', () => {
    expect(checkOriginAuth('nope', 's3cret', 'production')).toBe('deny');
    expect(checkOriginAuth('s3cre', 's3cret', 'production')).toBe('deny');
    expect(checkOriginAuth('s3cretX', 's3cret', 'production')).toBe('deny');
  });

  it('fails closed when production has no secret configured', () => {
    expect(checkOriginAuth('anything', undefined, 'production')).toBe(
      'misconfigured',
    );
    expect(checkOriginAuth(null, '', 'production')).toBe('misconfigured');
  });

  it('allows everything in development when no secret is set (pnpm dev)', () => {
    expect(checkOriginAuth(null, undefined, 'development')).toBe('allow');
  });

  it('still enforces a secret in development when one is set (local stack)', () => {
    expect(checkOriginAuth(null, 'local', 'development')).toBe('deny');
  });
});
