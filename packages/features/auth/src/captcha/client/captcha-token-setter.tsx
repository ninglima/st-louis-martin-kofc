'use client';

import { useContext } from 'react';

import { Turnstile, TurnstileProps } from '@marsidev/react-turnstile';

import { Captcha } from './captcha-provider';

/** Stable action for all auth surfaces that share the portal Turnstile widget. */
export const TURNSTILE_AUTH_ACTION = 'auth';

export function CaptchaTokenSetter(props: {
  siteKey: string | undefined;
  options?: TurnstileProps;
}) {
  const { setToken, setInstance } = useContext(Captcha);

  if (!props.siteKey) {
    return null;
  }

  const options = props.options ?? {
    options: {
      size: 'invisible',
      action: TURNSTILE_AUTH_ACTION,
    },
  };

  return (
    <Turnstile
      ref={(instance) => {
        if (instance) {
          setInstance(instance);
        }
      }}
      siteKey={props.siteKey}
      onSuccess={setToken}
      {...options}
    />
  );
}
