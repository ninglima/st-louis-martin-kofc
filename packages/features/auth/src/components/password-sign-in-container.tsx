'use client';

import { useCallback } from 'react';

import type { z } from 'zod';

import { useSignInWithEmailPassword } from '@kit/supabase/hooks/use-sign-in-with-email-password';

import { useCaptchaToken } from '../captcha/client';
import type { PasswordSignInSchema } from '../schemas/password-sign-in.schema';
import { AuthErrorAlert } from './auth-error-alert';
import { PasswordSignInForm } from './password-sign-in-form';

/** When unset, Turnstile is not mounted and sign-in must not wait for a token. */
const captchaEnabled = Boolean(
  process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY?.trim(),
);

export function PasswordSignInContainer({
  onSignIn,
}: {
  onSignIn?: (userId?: string) => unknown;
}) {
  const { captchaToken, resetCaptchaToken } = useCaptchaToken();
  const signInMutation = useSignInWithEmailPassword();
  const isLoading = signInMutation.isPending;
  const captchaReady = !captchaEnabled || Boolean(captchaToken);

  const onSubmit = useCallback(
    async (credentials: z.infer<typeof PasswordSignInSchema>) => {
      if (captchaEnabled && !captchaToken) {
        return;
      }

      try {
        const data = await signInMutation.mutateAsync({
          ...credentials,
          options: { captchaToken },
        });

        if (onSignIn) {
          const userId = data?.user?.id;

          onSignIn(userId);
        }
      } catch {
        // wrong credentials, do nothing
      } finally {
        resetCaptchaToken();
      }
    },
    [captchaToken, onSignIn, resetCaptchaToken, signInMutation],
  );

  return (
    <>
      <AuthErrorAlert error={signInMutation.error} />

      <PasswordSignInForm
        onSubmit={onSubmit}
        loading={isLoading}
        disabled={!captchaReady}
      />
    </>
  );
}
