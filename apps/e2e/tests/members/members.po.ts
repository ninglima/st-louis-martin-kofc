import { Page, expect } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';

/**
 * Local-only Supabase demo project constants, copied verbatim from
 * `apps/web/.env.test` — the same pair `rbac.po.ts` uses, and for the same
 * reason. These are the well-known defaults the Supabase CLI bakes into every
 * `supabase init` project: not secrets, and meaningless anywhere but a stack
 * listening on 127.0.0.1:54321.
 *
 * That address is load-bearing here. `apps/web/.env.local` points at the
 * council's HOSTED project and overrides `.env.development`, so a suite that
 * inherited the app's own configuration could create real auth accounts and
 * import a fixture roster into the live council database. Everything this file
 * touches directly is pinned to the local stack instead.
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

/** The Officers Online export's header row, verbatim. */
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

export interface RosterFixture {
  filename: string;
  buffer: Buffer;
  /** Membership numbers the plan must CREATE, in file order. */
  creates: string[];
  /** Membership numbers the plan must skip. */
  skips: string[];
  /** Rows the parser rejects outright, so they reach no plan at all. */
  rowErrors: number;
  /** Row 1's member: the one the browser assertions read back. */
  firstMember: {
    membershipNumber: string;
    fullName: string;
    email: string;
    /** As `normalizePhone` stores it, not as the file spells it. */
    phone: string;
    addressLine1: string;
    postalCode: string;
  };
}

/**
 * The unit suite's fixture (`packages/features/members/test/fixtures/
 * make-fixture.ts`), rebuilt as CSV with every membership number and address
 * made unique to this run.
 *
 * WHY UNIQUE, rather than the fixture's literal 1000001..1000009: the local
 * database is long-lived and already holds members from earlier runs, and
 * `member_upsert_from_roster` is an upsert. Re-importing the same numbers
 * would plan zero creates on a machine that had run the suite before and five
 * on one that had not — so "after confirming, the expected members exist"
 * would pass without the import having written anything at all. Unique numbers
 * make the create path real on every run, on any database, without truncating
 * a table the developer may be looking at.
 *
 * CSV rather than .xlsx because `readRoster` supports both and `apps/e2e` has
 * no spreadsheet dependency — writing one in would be a build dependency added
 * to state a fixture.
 */
export function buildRosterFixture(): RosterFixture {
  // Seven digits, starting with 9, so it cannot collide with the 1000001-range
  // the unit fixture and any manual session use.
  const base = 9_000_000 + (Date.now() % 900_000);

  const number = (offset: number) => String(base + offset);
  const email = (offset: number) => `roster.${base}.${offset}@example.com`;

  const blank = (values: Partial<Record<number, string>>) =>
    HEADER.map((_, index) => values[index] ?? '');

  const rows = [
    // 1. normal, fully populated
    blank({
      0: number(1),
      1: 'Mr',
      2: 'John',
      3: 'Q',
      4: 'Smith',
      7: 'Member',
      8: '1 Oak St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147-3067',
      13: 'US',
      21: '703-555-0001',
      23: '7035550002',
      24: email(1).toUpperCase(),
    }),
    // 2. sparse
    blank({
      0: number(2),
      2: 'Paul',
      4: 'Abraham',
      7: 'Member',
      8: '2 Elm St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147',
      13: 'US',
      24: email(2),
    }),
    // 3. NO EMAIL -- the parser rejects it; it must be reported, not dropped
    blank({
      0: number(3),
      2: 'Carl',
      4: 'Krebs',
      7: 'Member',
      8: '3 Pine St',
      10: 'Ashburn',
      11: 'VA',
      12: '20148',
      13: 'US',
      21: '7035550003',
    }),
    // 4. bad-address flag set, and one of the two rows contesting email(4)
    blank({
      0: number(4),
      2: 'Peter',
      4: 'Nolan',
      5: 'Jr',
      6: 'X',
      7: 'Member',
      8: '4 Ash St',
      10: 'Sterling',
      11: 'VA',
      12: '20164',
      13: 'US',
      23: '7035550004',
      24: email(4),
    }),
    // 5. "Iii" as the source spells it
    blank({
      0: number(5),
      2: 'Robert',
      4: 'Vance',
      5: 'Iii',
      7: 'Member',
      8: '5 Birch St',
      9: 'Apt 2',
      10: 'Leesburg',
      11: 'VA',
      12: '20176',
      13: 'US',
      22: '7035550005',
      24: email(5),
    }),
    // 6. secondary/seasonal address populated
    blank({
      0: number(6),
      1: 'Dr',
      2: 'Luis',
      3: 'M',
      4: 'Ortiz',
      7: 'Member',
      8: '6 Cedar St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147',
      13: 'US',
      14: 'Seasonal',
      15: '100 Beach Rd',
      17: 'Naples',
      18: 'FL',
      19: '34102',
      20: 'US',
      23: '7035550006',
      24: email(6),
    }),
    // 7. repeats row 1's membership number -- skipped
    blank({
      0: number(1),
      2: 'Duplicate',
      4: 'Number',
      7: 'Member',
      8: '9 Dup St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147',
      13: 'US',
      24: email(7),
    }),
    // 8. repeats row 4's email under a new number -- both are skipped
    blank({
      0: number(7),
      2: 'Duplicate',
      4: 'Email',
      7: 'Member',
      8: '10 Dup St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147',
      13: 'US',
      24: email(4),
    }),
    // 9. blank membership number -- rejected by the parser
    blank({
      2: 'Missing',
      4: 'Number',
      7: 'Member',
      8: '11 No St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147',
      13: 'US',
      24: email(9),
    }),
    // 10. malformed email -- rejected by the parser
    blank({
      0: number(8),
      2: 'Bad',
      4: 'Email',
      7: 'Member',
      8: '12 Bad St',
      10: 'Ashburn',
      11: 'VA',
      12: '20147',
      13: 'US',
      24: 'not-an-email',
    }),
    // 11. non-US phone shape -- stored as written rather than reshaped
    blank({
      0: number(9),
      2: 'Ian',
      4: 'Fraser',
      7: 'Member',
      8: '13 Kew Rd',
      10: 'London',
      12: 'SW1A 1AA',
      13: 'GB',
      21: '+44 20 7946 0958',
      24: email(11),
    }),
  ];

  const csv = [HEADER, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n');

  return {
    filename: `roster-${base}.csv`,
    buffer: Buffer.from(csv, 'utf8'),
    creates: [number(1), number(2), number(5), number(6), number(9)],
    skips: [number(1), number(4), number(7)],
    rowErrors: 3,
    firstMember: {
      membershipNumber: number(1),
      fullName: 'Mr John Q Smith',
      // The file shouts it; `normalizeEmail` lowercases it.
      email: email(1),
      // Cell wins the coalesce in `members_list`, and `normalizePhone`
      // reshapes a ten-digit US number.
      phone: '(703) 555-0002',
      addressLine1: '1 Oak St',
      postalCode: '20147-3067',
    },
  };
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export class MembersPageObject {
  readonly page: Page;
  readonly auth: AuthPageObject;

  constructor(page: Page) {
    this.page = page;
    this.auth = new AuthPageObject(page);
  }

  goToMembers() {
    return this.page.goto('/home/members');
  }

  goToImport() {
    return this.page.goto('/home/members/import');
  }

  /**
   * How many rows `public.members` holds, straight from PostgREST rather than
   * from the screen. The whole point of scenario 3 is that the PREVIEW writes
   * nothing, and a list rendered by the same request that ran the preview
   * could not tell the difference between "nothing was written" and "the page
   * has not caught up yet".
   *
   * `count=exact` puts the total in `content-range` as `0-0/41` (and as a
   * star followed by `/0` when the table is empty), which is why the request
   * asks for a single row and reads a header rather than a body.
   */
  async countMembers(): Promise<number> {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/members?select=id`, {
      headers: {
        ...serviceRoleHeaders(),
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(
        `countMembers: ${response.status} ${await response.text()}`,
      );
    }

    const range = response.headers.get('content-range');
    const total = Number(range?.split('/')[1]);

    if (!Number.isFinite(total)) {
      throw new Error(`countMembers: unreadable content-range "${range}"`);
    }

    return total;
  }

  /**
   * The stored rows for the given membership numbers. Only the unencrypted
   * columns: `service_role` holds `select` on `public.members` (see
   * 20260922221437_members_fixes.sql) but not the PII key, so the ciphertext
   * is unreadable from here by design. The decrypted values are asserted where
   * the officer actually sees them — on the list page.
   */
  async storedMembers(
    membershipNumbers: string[],
  ): Promise<{ membership_number: string; user_id: string | null }[]> {
    const list = membershipNumbers.join(',');

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/members?select=membership_number,user_id&membership_number=in.(${list})`,
      { headers: serviceRoleHeaders() },
    );

    if (!response.ok) {
      throw new Error(
        `storedMembers: ${response.status} ${await response.text()}`,
      );
    }

    return response.json() as Promise<
      { membership_number: string; user_id: string | null }[]
    >;
  }

  /**
   * Promotes an already-signed-up user to `administrator`, which carries
   * members view + manage on any database built from migrations alone:
   * 20260922221437_members_fixes.sql:286 inserts that grant, and
   * 20260922033217_rbac.sql:101 seeds the `administrator` role the statement
   * looks up. See `rbac.po.ts`'s copy of this for why a fresh local database
   * has no administrator to do it through the UI.
   */
  async promoteToAdministrator(email: string): Promise<void> {
    const headers = serviceRoleHeaders();

    const accountRes = await fetch(
      `${SUPABASE_URL}/rest/v1/accounts?select=id&email=eq.${encodeURIComponent(email)}`,
      { headers },
    );

    if (!accountRes.ok) {
      throw new Error(
        `promoteToAdministrator: ${accountRes.status} ${await accountRes.text()}`,
      );
    }

    const accounts = (await accountRes.json()) as { id: string }[];
    const userId = accounts[0]?.id;

    if (!userId) {
      throw new Error(
        `promoteToAdministrator: no public.accounts row for ${email}`,
      );
    }

    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roles?select=id&slug=eq.administrator`,
      { headers },
    );

    const roles = (await roleRes.json()) as { id: string }[];
    const roleId = roles[0]?.id;

    if (!roleId) {
      throw new Error(
        'promoteToAdministrator: no role with slug "administrator" -- was ' +
          '20260922033217_rbac.sql applied?',
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
        `promoteToAdministrator: ${upsertRes.status} ${await upsertRes.text()}`,
      );
    }
  }

  /** Uploads the fixture and waits for the preview to render. */
  async uploadRoster(fixture: RosterFixture): Promise<void> {
    await this.page.locator('[data-test="roster-file"]').setInputFiles({
      name: fixture.filename,
      mimeType: 'text/csv',
      buffer: fixture.buffer,
    });

    await this.page.click('[data-test="roster-upload"]');

    await expect(
      this.page.locator('[data-test="roster-preview"]'),
    ).toBeVisible();
  }

  /**
   * The number in one of the preview's five tiles. `Count` renders the figure
   * and its label as two sibling spans, so the first span is the figure —
   * matching on the tile's whole text would read "5New members".
   */
  planCount(name: 'create' | 'update' | 'nochange' | 'skip' | 'accounts') {
    return this.page.locator(`[data-test="roster-count-${name}"] span`).first();
  }

  /** The list row for a membership number, wherever it sits on the page. */
  memberRow(membershipNumber: string) {
    return this.page.locator(`[data-test="member-row-${membershipNumber}"]`);
  }

  /**
   * Types into the roster search box. The input is debounced by 300ms, so
   * every assertion on the result has to be a retrying one — which every
   * `expect(locator)` in this suite is.
   */
  async searchFor(term: string) {
    await this.page.fill('[data-test="members-search"]', term);
  }
}
