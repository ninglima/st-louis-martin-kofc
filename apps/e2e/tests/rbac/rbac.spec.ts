/**
 * ============================================================================
 * THESE TESTS HAVE NEVER BEEN EXECUTED.
 * ============================================================================
 *
 * They were written by reading the rbac feature's source (components,
 * server actions, migrations, permission-loading code) and the existing e2e
 * suite's conventions, on a machine where `docker info` fails -- so no local
 * Supabase stack could be started, and this suite cannot run without one
 * (`apps/web/.env.test` points at `http://127.0.0.1:54321`, and
 * `apps/e2e/tests/utils/mailbox.ts` reads a local Mailpit instance). Running
 * against the remote/hosted project instead was deliberately avoided: it
 * would create real users in a live database, and the mailbox helper
 * wouldn't work against it regardless.
 *
 * Every selector and route here was confirmed by reading the corresponding
 * component or config file (see `rbac.po.ts` for the per-helper citations),
 * not by observing it in a browser. Treat a first run as a debugging
 * session, not a rubber stamp -- see task-11-report.md for which scenarios
 * are most likely to need adjustment.
 *
 * TO RUN THIS SUITE:
 *
 *   1. Start Docker Desktop (or whatever `docker info` needs to succeed).
 *   2. pnpm --filter web supabase:start
 *   3. pnpm --filter web supabase:reset   # applies migrations incl. rbac seed
 *   4. pnpm --filter web-e2e test
 *
 * ============================================================================
 */
import { BrowserContext, Page, expect, test } from '@playwright/test';

import { RbacPageObject } from './rbac.po';

test.describe('RBAC permission enforcement', () => {
  test.describe.configure({ mode: 'serial' });

  let adminPage: Page;
  let admin: RbacPageObject;
  let adminEmail: string;

  let memberContext: BrowserContext;
  let memberPage: Page;
  let member: RbacPageObject;
  let memberEmail: string;

  const memberInitialPassword = 'TempPassw0rd!';
  const memberFinalPassword = 'MemberPassw0rd!';

  test.beforeAll(async ({ browser }) => {
    adminPage = await browser.newPage();
    admin = new RbacPageObject(adminPage);

    // Fresh database => zero administrators (see the doc comment on
    // promoteToAdministrator in rbac.po.ts for why). Sign up normally, then
    // promote this specific user directly via the service-role key -- there
    // is no admin yet to do this through the UI.
    adminEmail = await admin.auth.signUpFlow('/home');

    await admin.promoteToAdministrator(adminEmail);

    // getCurrentPermissions() (apps/web/lib/server/require-permission.ts)
    // reads user_roles fresh on every server render -- it is not baked into
    // the JWT the way `must_change_password` is -- so a reload is enough to
    // pick up the promotion. No session refresh needed.
    await adminPage.reload();
  });

  test.afterAll(async () => {
    await adminPage.close();
    await memberContext?.close();
  });

  test('1. an administrator sees every section in the sidebar', async () => {
    await admin.expectSidebarToShow([
      'Home',
      'Payments',
      'Payment Settings',
      'Users',
      'Roles',
    ]);
  });

  test('2. admin creates a Member-role user in password mode', async () => {
    memberEmail = admin.auth.createRandomEmail();

    await admin.goToUsers();

    await admin.createPasswordUser({
      email: memberEmail,
      password: memberInitialPassword,
      roleName: 'Member',
    });

    const row = admin.userRow(memberEmail);

    await expect(row).toBeVisible();
    await expect(row).toContainText('Member');
  });

  test('3. the member sees only member-facing sections in a fresh context', async ({
    browser,
  }) => {
    memberContext = await browser.newContext();
    memberPage = await memberContext.newPage();
    member = new RbacPageObject(memberPage);

    // An admin-created password-mode user carries must_change_password:
    // true and is forced through /update-password before /home renders --
    // this helper completes that rotation so we land where the assertions
    // below expect to be.
    await member.signInHandlingForcedPasswordChange({
      email: memberEmail,
      password: memberInitialPassword,
      newPassword: memberFinalPassword,
    });

    await member.expectSidebarToShow(['Home', 'Payments']);
    await member.expectSidebarToHide(['Users', 'Roles']);
  });

  test('4. direct navigation to /home/settings/roles redirects the member to /home', async () => {
    // This is the test that actually distinguishes enforcement from a
    // merely-hidden link: requirePermission('roles', 'view')
    // (apps/web/lib/server/require-permission.ts), called from
    // app/home/settings/roles/layout.tsx, redirects to /home server-side
    // regardless of what the client ever rendered.
    await member.goToRoles();

    await memberPage.waitForURL('**/home');
    expect(memberPage.url()).not.toContain('/settings/roles');
  });

  test('5. revoking payments.view applies on the member’s next navigation', async () => {
    await admin.goToRoles();

    const restrictedRoleName = await admin.createRoleWithoutPaymentsAccess();

    await admin.goToUsers();
    await admin.changeUserRole(memberEmail, restrictedRoleName);

    // Same as the promotion in beforeAll: permissions are read fresh from
    // the DB on every server render, so the member merely has to navigate
    // again -- no sign-out/sign-in and no session refresh required.
    await memberPage.goto('/home');

    await member.expectSidebarToHide(['Payments']);
  });
});
