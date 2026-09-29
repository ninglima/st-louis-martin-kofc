import postgres from 'postgres';

/**
 * The local Supabase database (`supabase start`). Override with
 * `E2E_DATABASE_URL`; anything that isn't on localhost is refused, so the
 * teardown can never touch a hosted project.
 */
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Every address the specs create: `AuthPageObject.createRandomEmail` and
// `password-reset.spec.ts` use @makerkit.dev; the dues and roster fixtures use
// dues.<n>@example.com and roster.<base>.<n>@example.com.
const TEST_EMAIL = String.raw`(@makerkit\.dev$|^(dues|roster)\..*@example\.com$)`;

// Roles built by `createRoleWithoutPaymentsAccess` (rbac.po.ts) and
// `createRoleWithMembersViewOnly` (dues.po.ts).
const TEST_ROLE_SLUG = String.raw`^(no_payments|dues_e2e_roster_viewer)_\d+$`;

/**
 * Deletes what the suite leaves behind: test users and accounts, the roles
 * the RBAC and dues specs build, test members with their dues periods and
 * notices, roster imports and hosting bills made by test users, and dues
 * notice runs recorded since `startedAt`.
 *
 * Dues periods can't be deleted through the API (`kit.dues_periods_guard`),
 * so this connects to Postgres directly and lifts that one trigger inside
 * the transaction.
 */
export async function cleanUpE2EData(startedAt?: string) {
  const { hostname } = new URL(DATABASE_URL);

  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(`E2E cleanup refuses a non-local database (${hostname})`);
  }

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    await sql.begin(async (tx) => {
      await tx`
        create temp table e2e_users on commit drop as
        select id from auth.users where email ~ ${TEST_EMAIL}`;

      await tx`
        create temp table e2e_members on commit drop as
        select id from public.members
        where primary_email ~ ${TEST_EMAIL}
           or user_id in (select id from e2e_users)`;

      await tx`alter table public.dues_periods disable trigger dues_periods_guard`;

      await tx`
        delete from public.dues_notices
        where member_id in (select id from e2e_members)`;

      await tx`
        delete from public.dues_periods
        where member_id in (select id from e2e_members)
           or recorded_by in (select id from e2e_users)
           or voided_by in (select id from e2e_users)`;

      await tx`alter table public.dues_periods enable trigger dues_periods_guard`;

      if (startedAt) {
        await tx`delete from public.dues_notice_runs where ran_at >= ${startedAt}`;
      }

      await tx`
        delete from public.hosting_costs
        where created_by in (select id from e2e_users)
           or updated_by in (select id from e2e_users)`;

      await tx`
        delete from public.roster_imports
        where uploaded_by in (select id from e2e_users)`;

      await tx`delete from public.members where id in (select id from e2e_members)`;
      await tx`delete from public.accounts where email ~ ${TEST_EMAIL}`;
      await tx`delete from auth.users where id in (select id from e2e_users)`;

      await tx`
        delete from public.roles
        where not is_system and slug ~ ${TEST_ROLE_SLUG}`;
    });
  } finally {
    await sql.end();
  }
}
