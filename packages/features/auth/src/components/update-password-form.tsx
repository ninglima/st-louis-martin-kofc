'use client';

import { useState } from 'react';

import Link from 'next/link';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRightIcon, Check, TriangleAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { useUpdateUser } from '@kit/supabase/hooks/use-update-user-mutation';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Heading } from '@kit/ui/heading';
import { Input } from '@kit/ui/input';
import { Trans } from '@kit/ui/trans';

import { PasswordResetSchema } from '../schemas/password-reset.schema';

export function UpdatePasswordForm(params: { redirectTo: string }) {
  const client = useSupabase();
  const updateUser = useUpdateUser();

  // `updateUser` (Supabase's `PUT /user`) never mints a new access token --
  // it only rewrites the *stored* session's `user` field in place (see
  // `_updateUser` in `@supabase/auth-js`, which does `session.user =
  // data.user; await this._saveSession(session)` and never touches
  // `access_token`). So any claim baked into the token the caller already
  // holds -- e.g. `must_change_password: true`, which `HomeLayout` decodes
  // locally via `getClaims()` -- stays stale until the token naturally
  // expires (`jwt_expiry`, 3600s in this project) unless we force a
  // refresh. Without this, an admin-created user who changes their forced
  // password would be redirected straight back to this page in a loop.
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [sessionRefreshFailed, setSessionRefreshFailed] = useState(false);
  const [sessionRefreshed, setSessionRefreshed] = useState(false);

  const form = useForm<z.infer<typeof PasswordResetSchema>>({
    resolver: zodResolver(PasswordResetSchema),
    defaultValues: {
      password: '',
      repeatPassword: '',
    },
  });

  if (updateUser.error) {
    return (
      <ErrorState
        messageKey={'auth.resetPasswordError'}
        onRetry={() => updateUser.reset()}
      />
    );
  }

  // The password change already succeeded here -- this is specifically the
  // post-update session refresh failing. Retrying the same refresh call is
  // unlikely to help (the request already went to GoTrue and failed), so
  // this offers no retry: signing out and back in is the only path to a
  // token that reflects the new password / cleared flag.
  if (sessionRefreshFailed) {
    return <ErrorState messageKey={'auth.sessionRefreshError'} />;
  }

  if (updateUser.data && sessionRefreshed) {
    return <SuccessState redirectTo={params.redirectTo} />;
  }

  const isPending = updateUser.isPending || isRefreshingSession;

  return (
    <div className={'flex w-full flex-col space-y-6'}>
      <div className={'flex justify-center'}>
        <Heading level={5} className={'tracking-tight'}>
          <Trans i18nKey={'auth.passwordResetLabel'} />
        </Heading>
      </div>

      <Form {...form}>
        <form
          className={'flex w-full flex-1 flex-col'}
          onSubmit={form.handleSubmit(async ({ password }) => {
            try {
              await updateUser.mutateAsync({
                password,
                // Clears the forced-rotation flag `UsersService` sets on
                // admin-created accounts. Kept in the same request as the
                // password change itself (not a separate call) so there is
                // no window where the password is changed but the flag
                // isn't.
                data: { must_change_password: false },
                redirectTo: params.redirectTo,
              });
            } catch {
              // `updateUser.error` is already set by the mutation itself;
              // the render above switches to the error state from that.
              // Nothing to refresh if the update itself never succeeded.
              return;
            }

            // Force a new access token so the claim `HomeLayout` reads on
            // the very next `/home` navigation reflects
            // `must_change_password: false` instead of the stale value
            // baked into the token this request started with.
            setIsRefreshingSession(true);
            const { error } = await client.auth.refreshSession();
            setIsRefreshingSession(false);

            if (error) {
              setSessionRefreshFailed(true);
              return;
            }

            setSessionRefreshed(true);
          })}
        >
          <div className={'flex-col space-y-4'}>
            <FormField
              name={'password'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'common.password'} />
                  </FormLabel>

                  <FormControl>
                    <Input required type="password" {...field} />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name={'repeatPassword'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey={'common.repeatPassword'} />
                  </FormLabel>

                  <FormControl>
                    <Input required type="password" {...field} />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <Button disabled={isPending} type="submit" className={'w-full'}>
              <Trans i18nKey={'auth.passwordResetLabel'} />
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function SuccessState(props: { redirectTo: string }) {
  return (
    <div className={'flex flex-col space-y-4'}>
      <Alert className={alertExtras.success}>
        <Check className={'s-6'} />

        <AlertTitle>
          <Trans i18nKey={'account.updatePasswordSuccess'} />
        </AlertTitle>

        <AlertDescription>
          <Trans i18nKey={'account.updatePasswordSuccessMessage'} />
        </AlertDescription>
      </Alert>

      <Link href={props.redirectTo}>
        <Button variant={'outline'} className={'w-full'}>
          <span>
            <Trans i18nKey={'common.backToHomePage'} />
          </span>

          <ArrowRightIcon className={'ml-2 h-4'} />
        </Button>
      </Link>
    </div>
  );
}

function ErrorState(props: { messageKey: string; onRetry?: () => void }) {
  return (
    <div className={'flex flex-col space-y-4'}>
      <Alert variant={'destructive'}>
        <TriangleAlert className={'s-6'} />

        <AlertTitle>
          <Trans i18nKey={'common.genericError'} />
        </AlertTitle>

        <AlertDescription>
          <Trans i18nKey={props.messageKey} />
        </AlertDescription>
      </Alert>

      {props.onRetry && (
        <Button onClick={props.onRetry} variant={'outline'}>
          <Trans i18nKey={'common.retry'} />
        </Button>
      )}
    </div>
  );
}
