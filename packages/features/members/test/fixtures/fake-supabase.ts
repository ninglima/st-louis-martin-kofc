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

/**
 * Every interaction in the order it happened. The only way to assert that the
 * permission probe ran BEFORE an irreversible account creation — which is the
 * whole of F1 — is to look at the order, not at the counts.
 */
export type Interaction =
  | 'members_can_manage'
  | 'rpc'
  | 'select'
  | 'createUser'
  | 'listUsers'
  | 'inviteUserByEmail';

export interface FakeClientOptions {
  /** Rows returned by `from('members').select(...)`. */
  rows?: Record<string, unknown>[];
  selectError?: { message: string; code?: string };
  /**
   * Per-call result for `rpc()`, keyed by call order; default is success. The
   * permission probe is not counted, so indexes line up with the member rows.
   */
  rpcError?: (call: RpcCall, index: number) => { message: string } | null;
  rpcData?: unknown;
  /** The answer `members_can_manage` gives. Defaults to true. */
  canManage?: boolean;
  canManageError?: { message: string };
  /** Consumed in order by `auth.admin.createUser`. */
  createUser?: CreateUserOutcome[];
  /** The auth directory `auth.admin.listUsers` pages through. */
  authUsers?: AuthUserStub[];
  listUsersError?: { message: string };
  /** A deployment that silently returns fewer users than `perPage` asked for. */
  authPerPageCap?: number;
  /** Every page comes back full, so the listing never ends. */
  authAlwaysFull?: boolean;
}

export interface FakeClient {
  client: SupabaseClient<Database>;
  selects: SelectCall[];
  /** Every `rpc()` call EXCEPT the permission probe. */
  rpcs: RpcCall[];
  canManageCalls: number;
  createUserEmails: string[];
  listUsersPages: { page?: number; perPage?: number }[];
  inviteCalls: string[];
  order: Interaction[];
}

export function fakeClient(options: FakeClientOptions = {}): FakeClient {
  const selects: SelectCall[] = [];
  const rpcs: RpcCall[] = [];
  const createUserEmails: string[] = [];
  const listUsersPages: { page?: number; perPage?: number }[] = [];
  const inviteCalls: string[] = [];
  const order: Interaction[] = [];
  const state = { canManageCalls: 0 };

  const createUserOutcomes = [...(options.createUser ?? [])];
  const authUsers = options.authUsers ?? [];

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          selects.push({ table, columns });
          order.push('select');

          const resolveRows = () =>
            options.selectError
              ? { data: null, error: options.selectError }
              : { data: options.rows ?? [], error: null };

          // Thenable AND chainable: `existingForPlanning()` awaits
          // `.select(...)` directly (resolves via `.then` below, the whole
          // row set), while `getMember()` chains `.eq(...).maybeSingle()`
          // (the first matching row, or null). One fake covers both without
          // either caller needing to know the other exists.
          return {
            eq(_column: string, _value: unknown) {
              return {
                maybeSingle() {
                  if (options.selectError) {
                    return Promise.resolve({
                      data: null,
                      error: options.selectError,
                    });
                  }

                  const rows = options.rows ?? [];

                  return Promise.resolve({
                    data: rows[0] ?? null,
                    error: null,
                  });
                },
              };
            },
            then<TResult1 = unknown, TResult2 = never>(
              onFulfilled?:
                | ((value: {
                    data: unknown;
                    error: unknown;
                  }) => TResult1 | PromiseLike<TResult1>)
                | null,
              onRejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ) {
              return Promise.resolve(resolveRows()).then(
                onFulfilled,
                onRejected,
              );
            },
          };
        },
      };
    },

    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'members_can_manage') {
        state.canManageCalls++;
        order.push('members_can_manage');

        return Promise.resolve(
          options.canManageError
            ? { data: null, error: options.canManageError }
            : { data: options.canManage ?? true, error: null },
        );
      }

      const call = { name, args };
      const index = rpcs.length;

      rpcs.push(call);
      order.push('rpc');

      const error = options.rpcError?.(call, index) ?? null;

      return Promise.resolve({ data: error ? null : options.rpcData, error });
    },

    auth: {
      admin: {
        createUser({ email }: { email: string }) {
          createUserEmails.push(email);
          order.push('createUser');

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
          order.push('listUsers');

          if (options.listUsersError)
            return Promise.resolve({
              data: { users: [] },
              error: options.listUsersError,
            });

          const requested = params?.perPage ?? 50;
          // A deployment may hand back fewer than were asked for.
          const perPage = Math.min(
            requested,
            options.authPerPageCap ?? requested,
          );
          const page = params?.page ?? 1;
          const start = (page - 1) * perPage;

          if (options.authAlwaysFull)
            return Promise.resolve({
              data: {
                users: Array.from({ length: perPage }, (_, i) => ({
                  id: `filler-${start + i}`,
                  email: `filler${start + i}@example.com`,
                })),
              },
              error: null,
            });

          return Promise.resolve({
            data: { users: authUsers.slice(start, start + perPage) },
            error: null,
          });
        },

        inviteUserByEmail(email: string) {
          inviteCalls.push(email);
          order.push('inviteUserByEmail');

          return Promise.resolve({ data: { user: null }, error: null });
        },
      },
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    selects,
    rpcs,
    get canManageCalls() {
      return state.canManageCalls;
    },
    createUserEmails,
    listUsersPages,
    inviteCalls,
    order,
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
