import pathsConfig from '@kit/brand/config/paths';

import { safeRedirectPath } from './safe-redirect-path';

/**
 * Where the password-page success button goes. The confirm handler used to
 * leave the invite's `callback` on `/update-password`, and this page treated
 * that value as the button target, which reloaded the password screen.
 * Anything that is not a same-origin path, or that points back here, goes home.
 */
export function afterPasswordUpdatePath(
  callback: string | null | undefined,
): string {
  const requested = safeRedirectPath(callback, pathsConfig.app.home);
  const path = requested.split(/[?#]/, 1)[0];

  if (path === pathsConfig.auth.passwordUpdate) return pathsConfig.app.home;

  return requested;
}
