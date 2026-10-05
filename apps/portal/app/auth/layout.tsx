import { AuthLayoutShell } from '@kit/auth/shared';

import { AppLogo } from '@kit/brand/app-logo';

function AuthLayout({ children }: React.PropsWithChildren) {
  return <AuthLayoutShell Logo={AppLogo}>{children}</AuthLayoutShell>;
}

export default AuthLayout;
