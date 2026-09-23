import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';

/**
 * Same shape as `roster-actions.test.ts`: `enhanceAction`'s own job is tested
 * where it lives, and stubbing it here keeps `server-only`, `next/headers` and
 * GoTrue out of a plain vitest run so these tests exercise the ACTION BODY.
 */
const h = vi.hoisted(() => ({
  perms: {} as Record<string, { canView: boolean; canManage: boolean }>,
  officer: null as unknown,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (fn: (params: never, user: { id: string }) => unknown) => (params: never) =>
      fn(params, { id: USER_ID }),
}));

vi.mock('@kit/rbac/server/permissions.service', () => ({
  loadPermissionsForUser: () => Promise.resolve(h.perms),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({}) as unknown,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => h.officer,
}));

const { exportMembersAction } = await import('./members-actions');

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bd1d9c3a-1111-2222-3333-444455556666',
    membership_number: '1000001',
    user_id: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
    full_name: 'Mr John Q Smith',
    primary_email: 'john.smith@example.com',
    city: 'Ashburn',
    state: 'VA',
    bad_address: false,
    roster_last_seen_at: '2026-09-23T00:00:00+00:00',
    address_line1: '1 Oak St',
    postal_code: '20147-3067',
    phone: '(703) 555-0002',
    ...overrides,
  };
}

/**
 * `pages` is consumed one call at a time, so a test can say "a full page, then
 * a short one" and watch the loop stop. An exhausted list answers with no rows,
 * which is what a real offset past the end returns.
 */
function fakeClient(options: {
  pages?: Record<string, unknown>[][];
  error?: { message: string };
  throws?: string;
}) {
  const calls: RpcCall[] = [];
  const pages = [...(options.pages ?? [])];

  return {
    calls,
    client: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });

        if (options.throws !== undefined) {
          return Promise.reject(new Error(options.throws));
        }

        if (options.error) {
          return Promise.resolve({ data: null, error: options.error });
        }

        return Promise.resolve({ data: pages.shift() ?? [], error: null });
      },
    },
  };
}

function useClient(options: Parameters<typeof fakeClient>[0]) {
  const fake = fakeClient(options);

  h.officer = fake.client;

  return fake;
}

describe('exportMembersAction', () => {
  beforeEach(() => {
    h.perms = { members: { canView: true, canManage: false } };
    h.officer = null;
  });

  it('refuses a caller without members.view without reading a single row', async () => {
    h.perms = { members: { canView: false, canManage: false } };

    const fake = useClient({ pages: [[listRow()]] });

    const result = await exportMembersAction({ search: null });

    expect(result).toEqual({
      success: false,
      error: 'You do not have permission to view the roster.',
    });

    // The refusal has to come BEFORE the decrypt, not after it: a Server
    // Action is a public endpoint and this one reads every member's address.
    expect(fake.calls).toEqual([]);
  });

  it('writes a header row and one line per member', async () => {
    useClient({
      pages: [
        [
          listRow(),
          listRow({
            membership_number: '1000009',
            user_id: null,
            full_name: 'Ian Fraser',
            primary_email: null,
            city: 'London',
            state: null,
            bad_address: true,
            address_line1: '13 Kew Rd',
            postal_code: 'SW1A 1AA',
            phone: '+44 20 7946 0958',
            roster_last_seen_at: null,
          }),
        ],
      ],
    });

    const result = await exportMembersAction({ search: null });

    expect(result.success).toBe(true);

    if (!result.success) return;

    const lines = result.csv.split('\r\n');

    expect(lines[0]).toBe(
      'Membership Number,Name,Email,Phone,Address,City,State,Postal Code,Bad Address,Has Account,Roster Last Seen',
    );

    expect(lines[1]).toBe(
      '1000001,Mr John Q Smith,john.smith@example.com,(703) 555-0002,1 Oak St,Ashburn,VA,20147-3067,no,yes,2026-09-23T00:00:00+00:00',
    );

    // Nulls become empty cells rather than the string "null", the flags read
    // as yes/no, and a member with no auth row is reported as having none.
    expect(lines[2]).toBe(
      '1000009,Ian Fraser,,+44 20 7946 0958,13 Kew Rd,London,,SW1A 1AA,yes,no,',
    );

    expect(result.truncated).toBe(false);
    expect(result.filename).toMatch(/^members-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('quotes a field carrying a comma, a quote or a newline', async () => {
    useClient({
      pages: [
        [
          listRow({
            full_name: 'Smith, John "JQ"',
            address_line1: '1 Oak St\nApt 2',
            // A comma and NOTHING else. The quote and the newline above would
            // each be quoted by a rule that had forgotten commas entirely, so
            // without this line the one character that matters most here --
            // the CSV's own separator -- goes untested.
            city: 'Ashburn, Loudoun',
          }),
        ],
      ],
    });

    const result = await exportMembersAction({ search: null });

    expect(result.success).toBe(true);

    if (!result.success) return;

    // Without this the comma in "Smith, John" would shift every subsequent
    // column of that row by one, silently.
    expect(result.csv).toContain('"Smith, John ""JQ"""');
    expect(result.csv).toContain('"1 Oak St\nApt 2"');
    expect(result.csv).toContain('"Ashburn, Loudoun"');
  });

  it('pages through the roster and always asks for an explicit limit', async () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      listRow({ membership_number: String(2000000 + index) }),
    );

    const fake = useClient({ pages: [full, [listRow()]] });

    const result = await exportMembersAction({ search: 'smith' });

    expect(result.success).toBe(true);

    if (!result.success) return;

    // 1 header + 200 + 1
    expect(result.csv.split('\r\n')).toHaveLength(202);

    // A short second page ends the loop -- there is no third call.
    expect(fake.calls).toHaveLength(2);

    // `members_list` caps p_limit at 200 anyway, but a call that omitted the
    // limit would silently fall back to the RPC's default of 50 and produce a
    // file missing three quarters of the council.
    expect(fake.calls[0]?.args).toEqual({
      p_search: 'smith',
      p_limit: 200,
      p_offset: 0,
    });

    expect(fake.calls[1]?.args).toEqual({
      p_search: 'smith',
      p_limit: 200,
      p_offset: 200,
    });
  });

  it('stops at the row cap and says the file is incomplete', async () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      listRow({ membership_number: String(3000000 + index) }),
    );

    // Every page full, forever: the loop can only be stopped by the cap.
    const fake = useClient({
      pages: Array.from({ length: 40 }, () => full),
    });

    const result = await exportMembersAction({ search: null });

    expect(result.success).toBe(true);

    if (!result.success) return;

    // 5_000 / 200 = 25 calls, and the officer is TOLD rather than handed a
    // file that quietly stops three thousand members early.
    expect(fake.calls).toHaveLength(25);
    expect(result.truncated).toBe(true);
    expect(result.csv.split('\r\n')).toHaveLength(5_001);
  });

  it('omits the search argument entirely when there is no search', async () => {
    const fake = useClient({ pages: [[listRow()]] });

    await exportMembersAction({ search: '' });

    // `undefined`, not null: the generated Args type refuses an explicit null,
    // and omitting the argument is what gets the RPC's own default.
    expect(fake.calls[0]?.args.p_search).toBeUndefined();
  });

  it('returns a read failure as a value rather than throwing it', async () => {
    useClient({ error: { message: 'permission denied for function' } });

    const result = await exportMembersAction({ search: null });

    // Next.js redacts thrown Server Action messages in production, so a throw
    // here would reach the officer as an opaque digest.
    expect(result).toEqual({
      success: false,
      error: 'permission denied for function',
    });
  });

  it('survives the transport rejecting outright', async () => {
    useClient({ throws: 'fetch failed' });

    const result = await exportMembersAction({ search: null });

    expect(result).toEqual({ success: false, error: 'fetch failed' });
  });
});
