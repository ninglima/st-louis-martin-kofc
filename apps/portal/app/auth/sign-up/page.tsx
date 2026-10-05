import { redirect } from 'next/navigation';

import pathsConfig from '@kit/brand/config/paths';

/**
 * Public self sign-up is disabled. Accounts are created by officers
 * (invite or password) from Settings → Users. Keep the route so old
 * bookmarks and shared links do not 404.
 */
export default function SignUpPage() {
  redirect(pathsConfig.auth.signIn);
}
