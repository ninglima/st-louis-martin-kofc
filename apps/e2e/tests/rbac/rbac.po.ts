import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';

/**
 * Local-only Supabase demo project constants, copied verbatim from
 * `apps/web/.env.test`. These are the well-known default keys the Supabase
 * CLI bakes into every fresh `supabase init` project -- they are not
 * secrets, and are only meaningful against a stack listening on
 * 127.0.0.1:54321 (i.e. never against a remote/production project).
 */
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function serviceRoleHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export class RbacPageObject {
  readonly page: Page;
  readonly auth: AuthPageObject;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
  }

  /**
   * Promotes an already-signed-up user to the `administrator` role by
   * writing directly to `public.user_roles`, using the service-role key.
   *
   * WHY THIS EXISTS (read before "simplifying" it away): on a freshly-reset
   * local database there are zero administrators. The rbac migration's
   * backfill (`20260922033217_rbac.sql`, the `insert into
   * public.user_roles ... from public.admin_users` at the bottom of that
   * file) reads from what is, on a fresh database, an *empty*
   * `admin_users` table, and a later migration
   * (`20260922052753_rbac_cutover.sql`) drops that table entirely. So the
   * seeded `administrator` and `member` roles exist, but nobody holds
   * `administrator` -- there is no admin to promote this user through the
   * UI, hence going straight to the service-role key.
   *
   * A fresh signup is *not* roleless, though: `kit.new_user_created_setup()`
   * (`20241219010757_schema.sql`, extended by
   * `20260922055727_default_role_on_signup.sql`) creates the
   * `public.accounts` row and then assigns whichever role has
   * `public.roles.is_default` set -- `member`, per the seed data in
   * `20260922033217_rbac.sql`. So this call is a promotion/overwrite, not a
   * first assignment: the upsert's `on conflict (user_id) do
   * merge-duplicates` replaces that just-assigned `member` row with
   * `administrator` (the column is `user_roles.user_id primary key`, one
   * role per user, so there is nothing to reconcile beyond swapping
   * `role_id`).
   *
   * This has not been run against a live database. It is based on reading
   * the migrations and the permission-loading code, not on observing the
   * actual behaviour of a plain sign-up in this scenario.
   *
   * The upsert below looks up the just-signed-up user's id from
   * `public.accounts` (populated by that same signup trigger, keyed by the
   * same id as `auth.users`) and the seeded `administrator` role's id from
   * `public.roles`, then upserts the pairing into `public.user_roles`.
   * There is no `assigned_by` here -- the column is nullable and there is
   * no other administrator yet to attribute the assignment to.
   */
  async promoteToAdministrator(email: string): Promise<void> {
    const headers = serviceRoleHeaders();

    const accountRes = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts?select=id&email=eq.${encodeURIComponent(email)}`,
      { headers },
    );

    if (!accountRes.ok) {
      throw new Error(
        `promoteToAdministrator: failed to look up account for ${email}: ` +
          `${accountRes.status} ${await accountRes.text()}`,
      );
    }

    const accounts = (await accountRes.json()) as Array<{ id: string }>;
    const userId = accounts[0]?.id;

    if (!userId) {
      throw new Error(
        `promoteToAdministrator: no public.accounts row found for ${email} ` +
          '-- did the on_auth_user_created trigger run?',
      );
    }

    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roles?select=id&slug=eq.administrator`,
      { headers },
    );

    if (!roleRes.ok) {
      throw new Error(
        'promoteToAdministrator: failed to look up the administrator role: ' +
          `${roleRes.status} ${await roleRes.text()}`,
      );
    }

    const roles = (await roleRes.json()) as Array<{ id: string }>;
    const roleId = roles[0]?.id;

    if (!roleId) {
      throw new Error(
        'promoteToAdministrator: no role with slug "administrator" found ' +
          '-- was the rbac seed migration (20260922033217_rbac.sql) applied?',
      );
    }

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_roles`, {
      method: 'POST',
      headers: {
        ...headers,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ user_id: userId, role_id: roleId }),
    });

    if (!upsertRes.ok) {
      throw new Error(
        `promoteToAdministrator: failed to upsert user_roles for ${email}: ` +
          `${upsertRes.status} ${await upsertRes.text()}`,
      );
    }
  }

  /**
   * Signs in and, if the account is flagged `must_change_password` (true
   * for every user created through `/home/settings/users` in password
   * mode -- see `UsersService.createUserWithPassword`), completes the
   * forced rotation so the caller always ends up on `/home`.
   *
   * The "fill password fields, submit, click the Back to Home Page link"
   * sequence below mirrors `password-reset.spec.ts`'s already-working
   * flow through the same `UpdatePasswordForm` component (same locator for
   * the link: `page.locator('a', { hasText: 'Back to Home Page' })`), so
   * that part is on solid footing. What is NOT verified is the premise
   * that gets a member here at all: that `apps/web/app/home/layout.tsx`
   * redirects an admin-created password-mode user to `/update-password`
   * on their very first sign-in, before `/home` (and the sidebar scenario
   * 3 needs) ever renders. That is read from the `must_change_password`
   * check in that layout, not observed. If this flakes, the URL race
   * between `/home` and `/update-password` right after sign-in is the
   * first place to look.
   */
  async signInHandlingForcedPasswordChange(params: {
    email: string;
    password: string;
    newPassword: string;
  }) {
    await this.auth.goToSignIn();
    await this.auth.signIn({
      email: params.email,
      password: params.password,
    });

    await this.page.waitForURL(/\/(home|update-password)/);

    if (this.page.url().includes('/update-password')) {
      await this.auth.updatePassword(params.newPassword);

      await this.page
        .locator('a', { hasText: 'Back to Home Page' })
        .click();
    }

    await this.page.waitForURL('**/home');
  }

  /**
   * Scoped to the sidebar's content region (`data-sidebar="content"`, set
   * by `@kit/ui`'s shadcn sidebar primitive) so link-name assertions can
   * never accidentally match breadcrumbs or other page content that
   * happens to share a label like "Roles" or "Users".
   */
  sidebarContent() {
    return this.page.locator('[data-sidebar="content"]');
  }

  async expectSidebarToShow(labels: string[]) {
    for (const label of labels) {
      await expect(
        this.sidebarContent().getByRole('link', { name: label }),
      ).toBeVisible();
    }
  }

  async expectSidebarToHide(labels: string[]) {
    for (const label of labels) {
      await expect(
        this.sidebarContent().getByRole('link', { name: label }),
      ).toHaveCount(0);
    }
  }

  async goToUsers() {
    await this.page.goto('/home/settings/users');
  }

  async goToRoles() {
    await this.page.goto('/home/settings/roles');
  }

  /** Opens a `@kit/ui/select` trigger and picks the option by visible text. */
  async selectOption(triggerSelector: string, optionName: string) {
    await this.page.click(triggerSelector);
    await this.page.getByRole('option', { name: optionName }).click();
  }

  /**
   * Creates a user in password mode with the given role, through the
   * `/home/settings/users` UI (`create-user-dialog.tsx`). Caller must
   * already be on `/home/settings/users`, signed in as a user with
   * `users.manage`.
   */
  async createPasswordUser(params: {
    email: string;
    password: string;
    roleName: string;
  }) {
    await this.page.click('[data-test="create-user"]');

    const dialog = this.page.locator('[data-test="create-user-dialog"]');
    await expect(dialog).toBeVisible();

    await this.page.fill('[data-test="user-email"]', params.email);

    await this.selectOption('[data-test="user-role"]', params.roleName);
    // Default mode is "invite" (buildDefaultValues in create-user-dialog.tsx)
    // -- password mode has to be selected explicitly.
    await this.selectOption('[data-test="user-mode"]', 'Set password');

    await this.page.fill('[data-test="user-password"]', params.password);

    await this.page.click('[data-test="submit-create-user"]');

    // The dialog only closes on success (see create-user-dialog.tsx's
    // onSubmit) -- a refused create leaves it open with a toast instead.
    // Waiting for it to close is the confirmation the create round-tripped.
    await expect(dialog).toBeHidden();
  }

  /**
   * The table row's `data-test` key is the user's id
   * (`user-row-${user.id}`), which the caller does not know ahead of time
   * -- rows are located by their email text instead.
   */
  userRow(email: string) {
    return this.page.locator('[data-test^="user-row-"]', { hasText: email });
  }

  async changeUserRole(email: string, roleName: string) {
    const trigger = this.userRow(email).locator(
      '[data-test^="user-role-select-"]',
    );

    await trigger.click();
    await this.page.getByRole('option', { name: roleName }).click();
  }

  /**
   * Creates a role via `/home/settings/roles` (`role-form-dialog.tsx`) that
   * grants `home.view` only. Neither seeded role fits scenario 5 -- `member`
   * already has `payments.view` -- so the test builds a role that
   * deliberately omits it. Caller must already be on `/home/settings/roles`.
   * Returns the role's display name for use in `changeUserRole`.
   */
  async createRoleWithoutPaymentsAccess(): Promise<string> {
    const unique = Date.now();
    const name = `No Payments ${unique}`;
    const slug = `no_payments_${unique}`;

    await this.page.click('[data-test="create-role"]');

    const dialog = this.page.locator('[data-test="role-form-dialog"]');
    await expect(dialog).toBeVisible();

    await this.page.fill('[data-test="role-name-input"]', name);
    await this.page.fill('[data-test="role-slug-input"]', slug);
    await this.page.click('[data-test="perm-home-view"]');

    await this.page.click('[data-test="save-role"]');

    await expect(dialog).toBeHidden();

    return name;
  }
}
