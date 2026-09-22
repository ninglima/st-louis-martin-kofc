import { CreditCard, Home, Settings, Shield, User, Users } from 'lucide-react';
import { z } from 'zod';

import { NavigationConfigSchema } from '@kit/ui/navigation-schema';

import pathsConfig from '~/config/paths.config';

const iconClasses = 'w-4';

const routes = [
  {
    label: 'common.routes.application',
    children: [
      {
        label: 'common.routes.home',
        path: pathsConfig.app.home,
        Icon: <Home className={iconClasses} />,
        // exact match: do not stay highlighted on nested routes like /home/settings
        highlightMatch: `^${pathsConfig.app.home}$`,
        section: 'home',
        verb: 'view' as const,
      },
      {
        label: 'common.routes.payments',
        path: pathsConfig.app.payments,
        Icon: <CreditCard className={iconClasses} />,
        section: 'payments',
        verb: 'view' as const,
      },
    ],
  },
  {
    label: 'common.routes.settings',
    children: [
      {
        label: 'common.routes.profile',
        path: pathsConfig.app.profileSettings,
        Icon: <User className={iconClasses} />,
      },
      {
        label: 'common.routes.paymentSettings',
        path: pathsConfig.app.paymentSettings,
        Icon: <Settings className={iconClasses} />,
        section: 'payment_settings',
        verb: 'manage' as const,
      },
      {
        label: 'common.routes.users',
        path: pathsConfig.app.users,
        Icon: <Users className={iconClasses} />,
        section: 'users',
        verb: 'view' as const,
      },
      {
        label: 'common.routes.roles',
        path: pathsConfig.app.roles,
        Icon: <Shield className={iconClasses} />,
        section: 'roles',
        verb: 'view' as const,
      },
    ],
  },
] satisfies z.infer<typeof NavigationConfigSchema>['routes'];

export const navigationConfig = NavigationConfigSchema.parse({
  routes,
  style: process.env.NEXT_PUBLIC_NAVIGATION_STYLE,
  sidebarCollapsed: process.env.NEXT_PUBLIC_HOME_SIDEBAR_COLLAPSED,
});
