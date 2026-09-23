import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/**
 * The narrowest fake that still exercises the real code paths: the services
 * only ever call `from().select()`, `rpc()` and two `auth.admin` methods, so a
 * fake of those four is a fake of the whole surface. Anything else is left
 * undefined on purpose — a service that reached for it would throw loudly
 * rather than quietly do nothing.
 */

export interface SelectCall {
  table: string;
  columns: string;
}

export interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AuthUserStub {
  id: string;
  email: string;
}

export type CreateUserOutcome =
  | { id: string }
  | { error: { message: string; code?: string } };

export interface FakeClientOptions {
  /** Rows returned by `from('members').select(...)`. */
  rows?: Record<string, unknown>[];
  selectError?: { message: string };
  /** Per-call result for `rpc()`, keyed by call order; default is success. */
  rpcError?: (call: RpcCall, index: number) => { message: string } | null;
  rpcData?: unknown;
  rpcThrows?: { message: string } | null;
  /** Consumed in order by `auth.admin.createUser`. */
  createUser?: CreateUserOutcome[];
  /** The auth directory `auth.admin.listUsers` pages through. */
  authUsers?: AuthUserStub[];
  listUsersError?: { message: string };
}

export interface FakeClient {
  client: SupabaseClient<Database>;
  selects: SelectCall[];
  rpcs: RpcCall[];
  createUserEmails: string[];
  listUsersPages: { page?: number; perPage?: number }[];
  inviteCalls: string[];
}

export function fakeClient(options: FakeClientOptions = {}): FakeClient {
  const selects: SelectCall[] = [];
  const rpcs: RpcCall[] = [];
  const createUserEmails: string[] = [];
  const listUsersPages: { page?: number; perPage?: number }[] = [];
  const inviteCalls: string[] = [];

  const createUserOutcomes = [...(options.createUser ?? [])];
  const authUsers = options.authUsers ?? [];

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          selects.push({ table, columns });

          return Promise.resolve(
            options.selectError
              ? { data: null, error: options.selectError }
              : { data: options.rows ?? [], error: null },
          );
        },
      };
    },

    rpc(name: string, args: Record<string, unknown>) {
      const call = { name, args };
      const index = rpcs.length;

      rpcs.push(call);

      if (options.rpcThrows) throw new Error(options.rpcThrows.message);

      const error = options.rpcError?.(call, index) ?? null;

      return Promise.resolve({ data: error ? null : options.rpcData, error });
    },

    auth: {
      admin: {
        createUser({ email }: { email: string }) {
          createUserEmails.push(email);

          const outcome = createUserOutcomes.shift() ?? {
            id: `created-${createUserEmails.length}`,
          };

          if ('error' in outcome)
            return Promise.resolve({ data: { user: null }, ...outcome });

          const user = { id: outcome.id, email };

          authUsers.push(user);

          return Promise.resolve({ data: { user }, error: null });
        },

        listUsers(params?: { page?: number; perPage?: number }) {
          listUsersPages.push(params ?? {});

          if (options.listUsersError)
            return Promise.resolve({
              data: { users: [] },
              error: options.listUsersError,
            });

          const perPage = params?.perPage ?? 50;
          const page = params?.page ?? 1;
          const start = (page - 1) * perPage;

          return Promise.resolve({
            data: { users: authUsers.slice(start, start + perPage) },
            error: null,
          });
        },

        inviteUserByEmail(email: string) {
          inviteCalls.push(email);

          return Promise.resolve({ data: { user: null }, error: null });
        },
      },
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    selects,
    rpcs,
    createUserEmails,
    listUsersPages,
    inviteCalls,
  };
}

/** Every column `existingForPlanning()` selects, all populated. */
export function fullMemberRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    membership_number: '1000001',
    primary_email: 'stored@example.com',
    first_name: 'Stored',
    last_name: 'Member',
    bad_address: false,
    prefix: 'Mr',
    middle_name: 'Q',
    suffix: 'Jr',
    city: 'Saint Louis',
    state: 'MO',
    country: 'US',
    primary_type: 'Regular',
    address_line1_enc: '\\xdeadbeef01',
    address_line2_enc: '\\xdeadbeef02',
    postal_code_enc: '\\xdeadbeef03',
    phone_cell_enc: '\\xdeadbeef04',
    phone_residence_enc: '\\xdeadbeef05',
    phone_business_enc: '\\xdeadbeef06',
    email_secondary_enc: '\\xdeadbeef07',
    secondary_address_enc: '\\xdeadbeef08',
    ...overrides,
  };
}
