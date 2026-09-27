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
   *
   * Permission is re-probed here, on every chunk, BEFORE anything irreversible
   * happens. An unauthorised chunk throws rather than reporting per-row
   * failures: a revoked grant is not 372 data problems for an officer to
   * reconcile, it is one fact about the whole run, and a caller that keeps
   * feeding chunks to a denied import is doing nothing useful.
   */
  async applyChunk(rows: PlanRow[], sourceFile: string): Promise<ChunkResult> {
    await this.assertCanManage();

    const failures: ChunkResult['failures'] = [];
    let applied = 0;

    for (const row of rows) {
      if (row.action === 'skip' || row.action === 'nochange' || !row.record)
        continue;

      try {
        const email = row.record.primaryEmail;
        // A create always brings an account. So does an update that fills a
        // blank stored address, which is the only way the members who have
        // never given the council an email ever become account holders — the
        // planner decided that in `fillsPrimaryEmail` and it is carried in the
        // plan, so the preview can say so before anybody presses apply.
        const needsAccount =
          row.action === 'create' || row.fillsPrimaryEmail === true;
        const userId =
          needsAccount && email ? await this.ensureAuthUser(email) : null;

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
   * The authoritative check lives inside `member_upsert_from_roster`, but it
   * runs per row and therefore AFTER `ensureAuthUser` has already created a
   * real, durable, sign-in-capable account for a real member. A grant revoked
   * between the preview and a later chunk would leave those accounts behind
   * for every remaining row and then report 42501 — a denied import that
   * nevertheless created up to 372 auth users, none of which a failed row
   * rolls back or a re-run cleans up.
   *
   * So the same question is asked first, through a side-effect-free wrapper,
   * and refused loudly. This does not replace the RPC's own gate: that one is
   * still what actually protects the table, and it closes the window between
   * this probe and the write.
   */
  private async assertCanManage(): Promise<void> {
    const { data, error } = await this.client.rpc('members_can_manage');

    if (error) throw new Error(error.message);

    if (data !== true)
      throw new Error(
        'insufficient_privilege: members.manage is required to apply a roster import',
      );
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
   * `nextPage`, which auth-js parses one character wide
   * (`parseInt(...).substring(0, 1)`) and so reads page 10 as 1.
   *
   * "Short" is measured against the PREVIOUS page, not against what was asked
   * for. A deployment may cap `perPage` below `AUTH_PAGE_SIZE` and hand back a
   * page that merely looks short; stopping there truncates the directory at
   * the cap, and a truncated directory is not harmless — it makes a registered
   * address look unregistered, which is the null this service exists to avoid.
   * Comparing against what the server last gave costs one extra request at the
   * end and removes the assumption entirely.
   *
   * And if the pages never run out, that is reported rather than absorbed: a
   * quietly truncated listing at `AUTH_PAGE_LIMIT` would do the same damage.
   */
  private async loadAuthUserIds(): Promise<Map<string, string>> {
    const byEmail = new Map<string, string>();
    let previousPage: number | null = null;

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

      if (data.users.length === 0) return byEmail;
      if (previousPage !== null && data.users.length < previousPage)
        return byEmail;

      previousPage = data.users.length;
    }

    throw new Error(
      `Auth directory did not end within ${AUTH_PAGE_LIMIT} pages; refusing to resolve an account against a truncated listing`,
    );
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
