import { Page, expect } from '@playwright/test';

/**
 * Local-only Supabase demo project constants, copied verbatim from
 * `members.po.ts` and `rbac.po.ts` -- the same pair, for the same reason.
 * These are the well-known defaults the Supabase CLI bakes into every fresh
 * `supabase init` project: not secrets, and meaningless anywhere but a stack
 * listening on 127.0.0.1:54321.
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

/** The Officers Online export's header row, verbatim -- copied from
 * `members.po.ts` since `parseRoster` rejects a file missing any of
 * `REQUIRED_HEADERS` regardless of what the data rows contain. */
const HEADER = [
  'Membership Number',
  'Prefix',
  'First Name',
  'Middle Name',
  'Last Name',
  'Suffix',
  'Fraternal - Bad Address',
  'Primary Type',
  'Address Line 1',
  'Address Line 2',
  'City',
  'State/Province',
  'Postal Code',
  'Country',
  'Secondary Type',
  'Address Line 1 (Secondary)',
  'Address Line 2 (Secondary)',
  'City (Secondary)',
  'State/Province (Secondary)',
  'Postal Code (Secondary)',
  'Country (Secondary)',
  'Residence Phone',
  'Business Phone',
  'Cell Phone',
  'Primary Email',
  'Secondary Email',
  'Tertiary Email',
];

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export interface DuesRosterFixture {
  filename: string;
  buffer: Buffer;
  membershipNumber: string;
  fullName: string;
  email: string;
}

/**
 * A single-row roster CSV: just enough for `parseRoster` to accept it and
 * `member_upsert_from_roster` to create exactly one member with an account.
 * Membership numbers start at 9_500_000 -- above `members.po.ts`'s
 * 9_000_000-plus-Date.now()%900_000 range -- so the two fixtures can never
 * collide even when both suites run against the same long-lived local
 * database in the same millisecond.
 */
export function buildOneRowRosterFixture(): DuesRosterFixture {
  const number = String(9_500_000 + (Date.now() % 400_000));
  const email = `dues.${number}@example.com`;
  const firstName = 'Dues';
  const lastName = `Tester${number}`;

  const row = HEADER.map((_, index) => {
    switch (index) {
      case 0:
        return number;
      case 2:
        return firstName;
      case 4:
        return lastName;
      case 7:
        return 'Member';
      case 24:
        return email;
      default:
        return '';
    }
  });

  const csv = [HEADER, row].map((r) => r.map(escapeCsv).join(',')).join('\r\n');

  return {
    filename: `dues-roster-${number}.csv`,
    buffer: Buffer.from(csv, 'utf8'),
    membershipNumber: number,
    fullName: `${firstName} ${lastName}`,
    email,
  };
}

/**
 * Adds `days` calendar days to an ISO `YYYY-MM-DD` date, doing the math in
 * UTC on the date's own y/m/d components. Deliberately a second copy of
 * `addDaysIso` (`packages/features/dues/src/lib/period-preview.ts`) rather
 * than an import of it: this test computes its expectation independently of
 * the code it is checking, the same way the schema comment on
 * `chicagoToday` asks callers to reason about "today". Using the host's
 * local date here would be wrong the same way the browser's local date would
 * be wrong for `chicagoToday` -- and adding a calendar year instead of 365
 * days would silently disagree with the database across a leap year.
 */
export function addDaysIso(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];

  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);

  return utc.toISOString().slice(0, 10);
}

/**
 * "Today" as the council sees it (America/Chicago), mirroring
 * `chicagoToday` in `packages/features/dues/src/schemas.ts`. Duplicated
 * here for the same reason as `addDaysIso` above -- and because the
 * "received on" field and the paid-through expectation both need to agree
 * with whatever the app itself calls "today", not the test runner's local
 * clock.
 */
export function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export class DuesPageObject {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  goToImport() {
    return this.page.goto('/home/members/import');
  }

  goToMembers() {
    return this.page.goto('/home/members');
  }

  /** Opens a `@kit/ui/select` trigger and picks the option by visible text. */
  async selectOption(triggerSelector: string, optionName: string) {
    await this.page.click(triggerSelector);
    await this.page
      .getByRole('option', { name: optionName, exact: true })
      .click();
  }

  /** Uploads the fixture and confirms the import, waiting for it to finish
   * writing. `roster-confirm` calls the GoTrue admin API to create the
   * account, so this gets a longer-than-default wait, mirroring
   * `members.spec.ts` scenario 4. */
  async uploadAndConfirmRoster(fixture: DuesRosterFixture): Promise<void> {
    await this.page.locator('[data-test="roster-file"]').setInputFiles({
      name: fixture.filename,
      mimeType: 'text/csv',
      buffer: fixture.buffer,
    });

    await this.page.click('[data-test="roster-upload"]');

    await expect(
      this.page.locator('[data-test="roster-preview"]'),
    ).toBeVisible();

    await this.page.click('[data-test="roster-confirm"]');

    await expect(
      this.page.locator('[data-test="roster-complete"]'),
    ).toBeVisible({ timeout: 60_000 });
  }

  memberRow(membershipNumber: string) {
    return this.page.locator(`[data-test="member-row-${membershipNumber}"]`);
  }

  async searchFor(term: string) {
    await this.page.fill('[data-test="members-search"]', term);
  }

  /**
   * Finds the member by membership number on `/home/members` and clicks
   * through to their detail page, returning the id parsed back out of the
   * URL. Going by the UI's own link rather than a REST lookup keeps this
   * honest about what an officer can actually reach -- and it is the only
   * place the id is available at all, since `storedMembers`-style REST reads
   * (see `members.po.ts`) only ever select non-PII columns and were never
   * asked for `id`.
   */
  async openMember(membershipNumber: string): Promise<string> {
    await this.goToMembers();
    await this.searchFor(membershipNumber);

    const row = this.memberRow(membershipNumber);
    await expect(row).toBeVisible();

    await row.locator('[data-test="member-name-link"]').click();
    await this.page.waitForURL(/\/home\/members\/[0-9a-f-]+$/);

    const match = /\/home\/members\/([0-9a-f-]+)$/.exec(this.page.url());

    if (!match?.[1]) {
      throw new Error(
        `openMember: could not parse a member id from ${this.page.url()}`,
      );
    }

    return match[1];
  }

  duesCard() {
    return this.page.locator('[data-test="dues-card"]');
  }

  duesStatus() {
    return this.page.locator('[data-test="dues-status"]');
  }

  duesPaidThrough() {
    return this.page.locator('[data-test="dues-paid-through"]');
  }

  ledgerRows() {
    return this.page.locator('[data-test="ledger-row"]');
  }

  async setAcceptedOn(date: string) {
    await this.page.fill('[data-test="set-accepted-on-input"]', date);
    await this.page.click('[data-test="set-accepted-on-submit"]');
  }

  /**
   * Records a check payment through `RecordPaymentForm`. Method is left at
   * its default (`check`, per `buildDefaultValues` in
   * `record-payment-form.tsx`) -- only the level and check number need
   * setting for this dialog's happy path.
   */
  async recordCheckPayment(params: {
    levelOptionName: string;
    checkNumber: string;
  }): Promise<void> {
    await this.page.click('[data-test="record-payment-open"]');

    const dialog = this.page.locator('[data-test="record-payment-dialog"]');
    await expect(dialog).toBeVisible();

    await this.selectOption(
      '[data-test="record-payment-level"]',
      params.levelOptionName,
    );

    await this.page.fill(
      '[data-test="record-payment-check-number"]',
      params.checkNumber,
    );

    await this.page.click('[data-test="record-payment-submit"]');

    await expect(dialog).toBeHidden();
  }

  /** Voids the first (only, in this suite's usage) ledger row's period. */
  async voidFirstPeriod(reason: string): Promise<void> {
    await this.page.locator('[data-test="void-period"]').first().click();

    const dialog = this.page.locator('[data-test="void-period-dialog"]');
    await expect(dialog).toBeVisible();

    await this.page.fill('[data-test="void-period-reason"]', reason);
    await this.page.click('[data-test="void-period-submit"]');

    await expect(dialog).toBeHidden();
  }

  /**
   * Creates a role via `/home/settings/roles` (`role-form-dialog.tsx`) that
   * grants `members.view` only -- neither seeded role fits scenario 3 (the
   * default `member` role has no `members` section at all, per
   * `members.spec.ts` scenario 1's comment), so the test builds a role that
   * grants exactly the one permission it needs and deliberately omits
   * `finance`. Caller must already be on `/home/settings/roles` (e.g. via
   * `RbacPageObject.goToRoles()`). Mirrors
   * `RbacPageObject.createRoleWithoutPaymentsAccess` in `rbac.po.ts`.
   */
  async createRoleWithMembersViewOnly(): Promise<string> {
    const unique = Date.now();
    const name = `Dues E2E Roster Viewer ${unique}`;
    const slug = `dues_e2e_roster_viewer_${unique}`;

    await this.page.click('[data-test="create-role"]');

    const dialog = this.page.locator('[data-test="role-form-dialog"]');
    await expect(dialog).toBeVisible();

    await this.page.fill('[data-test="role-name-input"]', name);
    await this.page.fill('[data-test="role-slug-input"]', slug);
    await this.page.click('[data-test="perm-members-view"]');

    await this.page.click('[data-test="save-role"]');

    await expect(dialog).toBeHidden();

    return name;
  }

  /**
   * Repoints a roster-imported member's `user_id` at an already-signed-up
   * auth account, via the service-role key. Used only by the online-dues
   * spec (gated on `E2E_STRIPE`): the roster import already creates its own
   * GoTrue account per row (see `members.spec.ts` scenario 4), but that
   * account's password is never given back to the test, so there is no way
   * to sign in as it. Signing up separately through the normal flow (known
   * password, confirmed via Mailpit) and then relinking the member row here
   * gets a member this test can actually act as, without inventing a whole
   * second account-provisioning path.
   */
  async linkMemberToUser(
    membershipNumber: string,
    email: string,
  ): Promise<void> {
    const headers = serviceRoleHeaders();

    const accountRes = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts?select=id&email=eq.${encodeURIComponent(email)}`,
      { headers },
    );

    if (!accountRes.ok) {
      throw new Error(
        `linkMemberToUser: failed to look up account for ${email}: ` +
          `${accountRes.status} ${await accountRes.text()}`,
      );
    }

    const accounts = (await accountRes.json()) as { id: string }[];
    const userId = accounts[0]?.id;

    if (!userId) {
      throw new Error(
        `linkMemberToUser: no public.accounts row found for ${email}`,
      );
    }

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/members?membership_number=eq.${encodeURIComponent(membershipNumber)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: userId }),
      },
    );

    if (!patchRes.ok) {
      throw new Error(
        `linkMemberToUser: failed to link member ${membershipNumber} to ` +
          `${email}: ${patchRes.status} ${await patchRes.text()}`,
      );
    }
  }
}
