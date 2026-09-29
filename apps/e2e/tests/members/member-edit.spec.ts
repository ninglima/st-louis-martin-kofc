/**
 * Member editing end to end: an administrator corrects a member's phone and
 * city in the dialog and sees them in the roster; a user with members.view
 * only is offered no Edit control. Run against the Docker stack
 * (`pnpm stack:up`) and local Supabase, like the other member suites.
 */
import { BrowserContext, Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { DuesPageObject, buildOneRowRosterFixture } from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';

test.describe('Member editing', () => {
  test.describe.configure({ mode: 'serial' });

  const fixture = buildOneRowRosterFixture();

  let officerPage: Page;
  let officerRbac: RbacPageObject;
  let officerDues: DuesPageObject;
  let memberContext: BrowserContext;
  let memberId: string;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    officerRbac = new RbacPageObject(officerPage);
    officerDues = new DuesPageObject(officerPage);

    const officerEmail = await new AuthPageObject(officerPage).signUpFlow('/home');
    await officerRbac.promoteToAdministrator(officerEmail);
    await officerPage.reload();
  });

  test.afterAll(async () => {
    await officerPage.close();
    await memberContext?.close();
  });

  test('1. an administrator edits a phone and city and sees them in the roster', async () => {
    test.setTimeout(90_000);

    await officerDues.goToImport();
    await officerDues.uploadAndConfirmRoster(fixture);

    memberId = await officerDues.openMember(fixture.membershipNumber);
    await expect(officerPage.locator('[data-test="member-edit"]')).toBeVisible();

    await officerDues.goToMembers();
    await officerDues.searchFor(fixture.membershipNumber);

    const row = officerDues.memberRow(fixture.membershipNumber);
    await expect(row).toBeVisible();

    await row.locator(`[data-test="member-edit-${memberId}"]`).click();

    const dialog = officerPage.locator('[data-test="member-edit-dialog"]');
    await expect(dialog).toBeVisible();

    const phone = dialog.locator('[data-test="member-edit-phone_cell"]');
    await expect(phone).toBeVisible();
    await phone.fill('(314) 555-0142');
    await dialog.locator('[data-test="member-edit-city"]').fill('Florissant');

    await dialog.locator('[data-test="member-edit-save"]').click();

    await expect(officerPage.getByText('Member updated.')).toBeVisible();
    await expect(dialog).toBeHidden();

    await expect(row.locator('[data-test="member-phone"]')).toHaveText('(314) 555-0142');
    await expect(row).toContainText('Florissant');
  });

  test('2. a user with members.view only sees no Edit control', async ({ browser }) => {
    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    const memberEmail = await new AuthPageObject(memberPage).signUpFlow('/home');

    await officerRbac.goToRoles();
    const roleName = await officerDues.createRoleWithMembersViewOnly();
    await officerRbac.goToUsers();
    await officerRbac.changeUserRole(memberEmail, roleName);
    await expect(officerPage.getByText('Role updated.')).toBeVisible();

    await memberPage.goto('/home/members');
    await expect(
      memberPage.getByRole('heading', { name: 'Members', level: 1 }),
    ).toBeVisible();
    await expect(memberPage.locator('[data-test^="member-edit-"]')).toHaveCount(0);

    await memberPage.goto(`/home/members/${memberId}`);
    await expect(memberPage.locator('[data-test="member-roster-details"]')).toBeVisible();
    await expect(memberPage.locator('[data-test="member-edit"]')).toHaveCount(0);
  });
});
