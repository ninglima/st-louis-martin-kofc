import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { PlanRow } from './roster-plan';

export interface ChunkResult {
  applied: number;
  failures: { membershipNumber: string; error: string }[];
}

/** Supabase auth rate-limits account creation; back off rather than hammer. */
const RETRY_DELAYS_MS = [250, 1_000, 3_000];

/** GoTrue's admin user listing is paged; 1000 is its largest accepted page. */
const AUTH_PAGE_SIZE = 1_000;

/** Guard against an unbounded loop if a page never shrinks. */
const AUTH_PAGE_LIMIT = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GoTrue reports a taken address either by code (`email_exists`) or, on older
 * deployments, only in the message.
 */
function isAlreadyRegistered(error: { message: string; code?: string }) {
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    /already (been )?registered|already exists/i.test(error.message)
  );
}

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

export class RosterImportService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * auth.users by lowercased email, read once and then kept current by this
   * service's own creations. Built lazily: a council whose members all have
   * fresh addresses never pays for it.
   */
  private authUserIds: Map<string, string> | null = null;

  /**
   * Applies one chunk. A row that fails is collected rather than thrown, so
   * one bad row cannot cost the rest of the chunk — and because the plan is
   * persisted, re-running processes what did not land and no-ops on what did.
   */
  async applyChunk(rows: PlanRow[], sourceFile: string): Promise<ChunkResult> {
    const failures: ChunkResult['failures'] = [];
    let applied = 0;

    for (const row of rows) {
      if (row.action === 'skip' || row.action === 'nochange' || !row.record)
        continue;

      try {
        const userId =
          row.action === 'create' && row.record.primaryEmail
            ? await this.ensureAuthUser(row.record.primaryEmail)
            : null;

        const { error } = await this.client.rpc('member_upsert_from_roster', {
          p: {
            ...this.toPayload(row),
            user_id: userId,
            source_file: sourceFile,
          },
        });

        if (error) throw new Error(error.message);

        applied++;
      } catch (cause) {
        failures.push({
          membershipNumber: row.membershipNumber,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    return { applied, failures };
  }

  /**
   * `createUser` sends no email, unlike `inviteUserByEmail`. Accounts are
   * created silently on purpose: deciding to email hundreds of members is a
   * separate, explicit action.
   *
   * An address that is already registered RESOLVES to the id of the account
   * holding it. Returning null there would write `user_id = null` onto that
   * member, and the upsert's `coalesce(m.user_id, excluded.user_id)` makes a
   * null sticky — so the members most likely to already have an account (the
   * ones who signed up) would be the ones permanently unlinked, and no later
   * import would repair it. When the address is taken but its owner cannot be
   * found, the row FAILS rather than quietly landing unlinked: a failure is
   * reported and retried, a null is not.
   */
  private async ensureAuthUser(email: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await this.client.auth.admin.createUser({
        email,
        email_confirm: false,
      });

      if (!error) {
        const id = data.user?.id ?? null;

        if (id !== null) this.authUserIds?.set(emailKey(email), id);

        return id;
      }

      // Already registered: find and reuse rather than fail the row.
      if (isAlreadyRegistered(error)) {
        const existing = await this.findAuthUser(email);

        if (existing === null)
          throw new Error(
            `Auth account for ${email} is already registered but could not be found`,
          );

        return existing;
      }

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new Error(error.message);
      await sleep(delay);
    }
  }

  private async findAuthUser(email: string): Promise<string | null> {
    this.authUserIds ??= await this.loadAuthUserIds();

    return this.authUserIds.get(emailKey(email)) ?? null;
  }

  /**
   * GoTrue's admin API has no lookup-by-email, so the directory is paged in
   * once. Paging stops on a short page rather than on the response's
   * `nextPage`, which auth-js parses one character wide and so gets wrong from
   * page 10 on.
   */
  private async loadAuthUserIds(): Promise<Map<string, string>> {
    const byEmail = new Map<string, string>();

    for (let page = 1; page <= AUTH_PAGE_LIMIT; page++) {
      const { data, error } = await this.client.auth.admin.listUsers({
        page,
        perPage: AUTH_PAGE_SIZE,
      });

      if (error) throw new Error(error.message);

      for (const user of data.users) {
        const key = user.email ? emailKey(user.email) : '';

        if (key !== '' && !byEmail.has(key)) byEmail.set(key, user.id);
      }

      if (data.users.length < AUTH_PAGE_SIZE) break;
    }

    return byEmail;
  }

  /**
   * Deliberately carries no dues, level, expiry or paid-through field. The RPC
   * has no parameter for one either, so this is belt and braces: an import
   * cannot change dues state even by mistake.
   */
  private toPayload(row: PlanRow) {
    const r = row.record!;

    return {
      membership_number: r.membershipNumber,
      prefix: r.prefix,
      first_name: r.firstName,
      middle_name: r.middleName,
      last_name: r.lastName,
      suffix: r.suffix,
      primary_email: r.primaryEmail,
      city: r.city,
      state: r.state,
      country: r.country,
      primary_type: r.primaryType,
      bad_address: r.badAddress,
      address_line1: r.addressLine1,
      address_line2: r.addressLine2,
      postal_code: r.postalCode,
      phone_cell: r.phoneCell,
      phone_residence: r.phoneResidence,
      phone_business: r.phoneBusiness,
      email_secondary: r.emailSecondary,
      secondary_address: r.secondaryAddress
        ? JSON.stringify(r.secondaryAddress)
        : null,
    };
  }
}
