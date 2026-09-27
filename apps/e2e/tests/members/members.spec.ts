/**
 * The roster import, end to end, against a real database.
 *
 * Everything below the screen -- the parser, the planner, the services and the
 * two server actions -- has 196 unit tests, every one of them against a fake
 * Supabase client. This suite is the only place where `members_list` really
 * decrypts a column, `member_upsert_from_roster` really writes one, and
 * `kit.has_permission` really refuses somebody.
 *
 * TO RUN IT:
 *
 *   1. Start Docker.
 *   2. pnpm --filter web supabase:start
 *   3. pnpm --filter web supabase:reset    # or: supabase migration up
 *   4. cd apps/web && pnpm with-env:test dev      # port 3000, LOCAL stack
 *   5. cd apps/e2e && pnpm exec playwright test tests/members --workers=1
 *
 * Step 4 is not optional detail. `apps/web/.env.local` points at the council's
 * HOSTED Supabase project and overrides `.env.development`, so a dev server
 * started the ordinary way serves the live council database — and this suite
 * signs users up and imports a roster. The helpers in `members.po.ts` are
 * pinned to 127.0.0.1:54321 whatever the app is doing, which means a run
 * against the wrong stack does not quietly succeed: it fails, loudly, with the
 * database it is checking disagreeing with the one on screen.
 */
import { BrowserContext, Page, expect, test } from '@playwright/test';

import { MembersPageObject, buildRosterFixture } from './members.po';

test.describe('Member roster', () => {
  // Serial: scenario 4 applies what scenario 3 previewed, and scenario 5 only
  // means anything once scenario 4 has written the members it re-plans.
  test.describe.configure({ mode: 'serial' });

  // One fixture for the whole file, with membership numbers unique to this
  // run. Built once so scenarios 3, 4 and 5 upload the identical bytes --
  // scenario 5 is the idempotency claim, and it is only a claim about the
  // same file.
  const fixture = buildRosterFixture();

  let officerPage: Page;
  let officer: MembersPageObject;

  let memberContext: BrowserContext;
  let memberPage: Page;
  let member: MembersPageObject;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    officer = new MembersPageObject(officerPage);

    const officerEmail = await officer.auth.signUpFlow('/home');

    await officer.promoteToAdministrator(officerEmail);

    // Permissions are read fresh from the database on every server render --
    // they are not baked into the JWT -- so a reload is enough to pick the
    // promotion up. See the longer note in rbac.po.ts.
    await officerPage.reload();
  });

  test.afterAll(async () => {
    await officerPage.close();
    await memberContext?.close();
  });

  test('1. a user without members.view is redirected away from /home/members', async ({
    browser,
  }) => {
    memberContext = await browser.newContext();
    memberPage = await memberContext.newPage();
    member = new MembersPageObject(memberPage);

    // A plain signup lands on the `member` role, which
    // 20260922033217_rbac.sql grants home, payments and checkout -- and no
    // `members` section at all.
    await member.auth.signUpFlow('/home');

    // The link being absent is cosmetic. The redirect below is the part that
    // distinguishes a hidden door from a locked one.
    await expect(
      memberPage.locator('[data-sidebar="content"]').getByRole('link', {
        name: 'Members',
      }),
    ).toHaveCount(0);

    await member.goToMembers();

    await memberPage.waitForURL('**/home');
    expect(memberPage.url()).not.toContain('/members');
  });

  test('2. a user without members.manage is redirected away from the import', async () => {
    await member.goToImport();

    await memberPage.waitForURL('**/home');
    expect(memberPage.url()).not.toContain('/import');
  });

  test('3. the preview shows what the file would do and writes nothing', async () => {
    const before = await officer.countMembers();

    await officer.goToImport();
    await officer.uploadRoster(fixture);

    // 11 rows: the parser rejects 3 (no email, blank number, malformed
    // email), leaving 8 planned -- 5 creates, and 3 skips made of the
    // repeated membership number plus BOTH rows contesting one email
    // address.
    await expect(officer.planCount('create')).toHaveText('5');
    await expect(officer.planCount('update')).toHaveText('0');
    await expect(officer.planCount('nochange')).toHaveText('0');
    await expect(officer.planCount('skip')).toHaveText('3');
    await expect(officer.planCount('accounts')).toHaveText('5');

    await expect(
      officerPage.locator('[data-test="roster-row-error"]'),
    ).toHaveCount(fixture.rowErrors);

    // THE assertion of this scenario. The officer has now seen every row the
    // import would touch, and the database has not moved: `previewRosterAction`
    // writes a plan and nothing else. Counted through PostgREST rather than
    // read off the screen -- the screen cannot distinguish "nothing was
    // written" from "this page has not caught up".
    expect(await officer.countMembers()).toBe(before);

    // And none of the file's members exist yet, which is the same claim said
    // in a way a coincidental count cannot satisfy.
    expect(await officer.storedMembers(fixture.creates)).toEqual([]);
  });

  test('4. confirming writes exactly the members the preview promised', async () => {
    // Five accounts are created through GoTrue's admin API, each with its own
    // retry/backoff budget (RETRY_DELAYS_MS), so this scenario is allowed
    // considerably longer than the 60s file default.
    test.setTimeout(150_000);

    await officerPage.click('[data-test="roster-confirm"]');

    const complete = officerPage.locator('[data-test="roster-complete"]');

    await expect(complete).toBeVisible({ timeout: 120_000 });
    await expect(complete).toContainText('5 rows written');

    await expect(
      officerPage.locator('[data-test="roster-failure-row"]'),
    ).toHaveCount(0);

    await expect(
      officerPage.locator('[data-test="roster-recurring-failures"]'),
    ).toHaveCount(0);

    const stored = await officer.storedMembers(fixture.creates);

    expect(stored.map((row) => row.membership_number).sort()).toEqual(
      [...fixture.creates].sort(),
    );

    // Every created member carries an email, so every one of them should have
    // been given a sign-in account -- that is what the `accounts` tile
    // promised in scenario 3.
    expect(stored.filter((row) => row.user_id === null)).toEqual([]);

    // The contested rows were skipped, so they must not have been written by
    // some other path. (The repeated membership number is excluded: its FIRST
    // listing is one of the creates.)
    const contested = fixture.skips.filter(
      (number) => !fixture.creates.includes(number),
    );

    expect(await officer.storedMembers(contested)).toEqual([]);

    // --- and now the officer-facing list, which is the only place the
    // encrypted columns are ever readable ---

    await officer.goToMembers();

    // `getByRole`, not `locator('h1')`: Next keeps the page navigated away
    // from mounted-but-hidden, and the accessibility tree exposes only the
    // live one.
    await expect(
      officerPage.getByRole('heading', { name: 'Members', level: 1 }),
    ).toBeVisible();

    await officer.searchFor(fixture.firstMember.membershipNumber);

    const row = officer.memberRow(fixture.firstMember.membershipNumber);

    await expect(row).toBeVisible();
    await expect(row).toContainText(fixture.firstMember.fullName);
    await expect(row).toContainText(fixture.firstMember.email);

    // The point of the whole encryption split: these two columns are
    // ciphertext in the table and only `members_list` can read them. Seeing
    // them here proves the security definer path works end to end -- and the
    // phone is the normalized shape, not the shape the file spells.
    await expect(row.locator('[data-test="member-phone"]')).toHaveText(
      fixture.firstMember.phone,
    );

    const address = row.locator('[data-test="member-address"]');

    await expect(address).toContainText(fixture.firstMember.addressLine1);
    await expect(address).toContainText(fixture.firstMember.postalCode);

    await expect(row.locator('[data-test="member-has-account"]')).toBeVisible();

    // A search that matches nobody says so, rather than rendering an empty
    // table that reads as "the council has no members".
    await officer.searchFor(`${fixture.firstMember.membershipNumber}-nobody`);

    await expect(
      officerPage.locator('[data-test="members-empty"]'),
    ).toBeVisible();
  });

  test('5. re-uploading the same file plans no creates at all', async () => {
    // The monthly re-import property, and the reason the council can run this
    // every month without a second thought. If this ever fails, every import
    // after the first is writing something it should not be.
    await officer.goToImport();
    await officer.uploadRoster(fixture);

    await expect(officer.planCount('create')).toHaveText('0');
    await expect(officer.planCount('update')).toHaveText('0');
    await expect(officer.planCount('accounts')).toHaveText('0');

    // The same 8 planned rows as before, now all accounted for as "already
    // exactly this" -- 5 unchanged and the same 3 skips.
    await expect(officer.planCount('nochange')).toHaveText('5');
    await expect(officer.planCount('skip')).toHaveText('3');
  });
});
