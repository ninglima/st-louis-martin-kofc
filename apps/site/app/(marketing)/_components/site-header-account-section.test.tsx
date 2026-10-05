import { cloneElement, isValidElement } from 'react';
import type React from 'react';

import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it, vi } from 'vitest';

import { PersonalAccountDropdown } from '@kit/accounts/personal-account-dropdown';

import { SiteHeaderAccountSection } from './site-header-account-section';

/**
 * `next/link` renders a plain `<a>` on the server too, so the markup alone
 * cannot tell it from `SiteLink`'s anchor. The stand-in marks every anchor
 * `next/link` renders, so a portal link that would do a client-side transition
 * shows up as `data-next-link`.
 */
vi.mock('next/link', () => ({
  default: ({ href, ...props }: React.ComponentProps<'a'>) => (
    <a data-next-link={''} href={href} {...props} />
  ),
}));

/**
 * The menu popup renders through a portal only once it is open on the client,
 * so the primitives are replaced with pass-throughs that render every item
 * inline, honouring the `render` prop the real `DropdownMenuItem` accepts.
 */
vi.mock('@kit/ui/dropdown-menu', () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );

  return {
    DropdownMenu: PassThrough,
    DropdownMenuTrigger: PassThrough,
    DropdownMenuContent: PassThrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({
      render,
      children,
    }: {
      render?: React.ReactElement;
      children?: React.ReactNode;
    }) =>
      isValidElement(render) ? (
        cloneElement(render, undefined, children)
      ) : (
        <div>{children}</div>
      ),
  };
});

vi.mock('@kit/ui/trans', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));

vi.mock('@kit/ui/mode-toggle', () => ({
  ModeToggle: () => null,
  SubMenuModeToggle: () => null,
}));

vi.mock('@kit/ui/profile-avatar', () => ({
  ProfileAvatar: () => null,
}));

vi.mock('@kit/supabase/hooks/use-user', () => ({
  useUser: () => ({ data: { id: 'user-1', email: 'knight@example.org' } }),
}));

vi.mock('@kit/supabase/hooks/use-sign-out', () => ({
  useSignOut: () => ({ mutateAsync: async () => undefined }),
}));

vi.mock(
  '../../../../../packages/features/accounts/src/hooks/use-personal-account-data',
  () => ({
    usePersonalAccountData: () => ({ data: null }),
  }),
);

describe('SiteHeaderAccountSection (signed in)', () => {
  it('renders the account dropdown portal links as plain anchors', () => {
    const html = renderToStaticMarkup(<SiteHeaderAccountSection />);

    expect(html).toMatch(/<a [^>]*href="\/home"/);
    expect(html).not.toContain('data-next-link');
  });

  it('keeps next/link as the dropdown default (the portal relies on it)', () => {
    const html = renderToStaticMarkup(
      <PersonalAccountDropdown
        user={{ id: 'user-1', email: 'knight@example.org' } as never}
        paths={{ home: '/home' }}
        features={{ enableThemeToggle: false }}
        signOutRequested={() => undefined}
      />,
    );

    expect(html).toMatch(/<a data-next-link="" href="\/home"/);
  });
});
