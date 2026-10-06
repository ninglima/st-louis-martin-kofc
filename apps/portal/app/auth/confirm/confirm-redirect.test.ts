import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import pathsConfig from '@kit/brand/config/paths';
import { createAuthCallbackService } from '@kit/supabase/auth';

import { afterPasswordUpdatePath } from '../../../lib/after-password-update-path';
import { safeRedirectPath } from '../../../lib/safe-redirect-path';

const SITE = 'https://kofc-15256.org';

describe('invite confirm redirect', () => {
  const verifyOtp = vi.fn(async () => ({ data: {}, error: null }));

  beforeEach(() => {
    verifyOtp.mockClear();
  });

  it('lands on the password page without keeping the confirm callback', async () => {
    const callback = `${SITE}/update-password`;
    const request = new Request(
      `${SITE}/auth/confirm?token_hash=abc&type=recovery&callback=${encodeURIComponent(callback)}`,
    );
    const client = {
      auth: { verifyOtp },
    } as unknown as SupabaseClient;

    const url = await createAuthCallbackService(client).verifyTokenHash(
      request,
      { redirectPath: pathsConfig.app.home },
    );

    const location = safeRedirectPath(
      `${url.pathname}${url.search}`,
      pathsConfig.app.home,
    );

    expect(location).toBe('/update-password');
    expect(url.searchParams.has('callback')).toBe(false);
    expect(afterPasswordUpdatePath(url.searchParams.get('callback'))).toBe(
      '/home',
    );
  });
});

describe('afterPasswordUpdatePath', () => {
  it('sends a finished password change home', () => {
    expect(afterPasswordUpdatePath(undefined)).toBe('/home');
    expect(afterPasswordUpdatePath(null)).toBe('/home');
  });

  it('does not follow a callback that points back at the password page', () => {
    expect(
      afterPasswordUpdatePath('https://kofc-15256.org/update-password'),
    ).toBe('/home');
    expect(afterPasswordUpdatePath('/update-password')).toBe('/home');
    expect(afterPasswordUpdatePath('/update-password?callback=/home')).toBe(
      '/home',
    );
  });

  it('keeps a same-origin path', () => {
    expect(afterPasswordUpdatePath('/home/settings')).toBe('/home/settings');
  });
});
