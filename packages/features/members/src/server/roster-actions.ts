'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { enhanceAction } from '@kit/next/actions';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { hasPermission } from '@kit/rbac/types';
import type { Database, Json } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { CHUNK_SIZE } from '../types/roster';
import { MembersService } from './members.service';
import { RosterImportService } from './roster-import.service';
import type { ChunkResult } from './roster-import.service';
import { parseRoster } from './roster-parser';
import type { RowError } from './roster-parser';
import { buildPlan } from './roster-plan';
import type { ImportPlan } from './roster-plan';
import type { SheetRow } from './roster-reader';
import { RosterReadError, readRoster } from './roster-reader';

type Client = SupabaseClient<Database>;

/** The plan as the preview hands it out: the plan plus the rows that failed to parse. */
export interface PreviewPlan extends ImportPlan {
  rowErrors: RowError[];
}

/**
 * Next.js redacts thrown Server Action error messages in production builds, so
 * every expected failure here is RETURNED. A parse error the officer cannot
 * read is the same as no error message at all.
 */
export type PreviewResult =
  | { success: true; importId: string; plan: PreviewPlan }
  | { success: false; error: string };

/**
 * `failures` exists ONLY on the success branch, and it means "these rows were
 * examined and these ones did not land". A run that was refused outright is the
 * other branch and carries no `failures` at all — not an empty list, which
 * would read as "nothing went wrong", and emphatically not one entry per row,
 * which would read as ordinary data trouble.
 *
 * `denied` says the run was refused rather than broken, so the caller stops
 * feeding chunks to an import that can never write and the officer is told to
 * ask for the grant back rather than to go and fix 372 spreadsheet rows.
 */
export type ApplyResult =
  | {
      success: true;
      applied: number;
      failures: ChunkResult['failures'];
      done: boolean;
    }
  | { success: false; error: string; denied: boolean };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5_000;

const UNAUTHORIZED_MESSAGE = 'You do not have permission to import the roster.';

const WITHDRAWN_MESSAGE =
  'Your permission to import the roster was withdrawn while it was running. Nothing further was written.';

const NO_PLAN_MESSAGE =
  'That import has no saved plan, so there is nothing to apply. Upload the file again to generate a new preview.';

/**
 * The rows landed; only the record of them did not. Says so plainly, because
 * "it failed" would send an officer looking for members who are already there,
 * and re-running is safe: the plan is persisted and the upsert is idempotent.
 */
function appliedButUnrecorded(applied: number, reason: string) {
  return `${applied} rows were applied, but the import record could not be updated: ${reason}. Re-run the import — applying it again is safe.`;
}

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message !== ''
    ? cause.message
    : fallback;
}

/**
 * Whether the database will say, in as many words, that this caller may no
 * longer manage members.
 *
 * Called only from `applyRosterChunkAction`'s catch block, and therefore
 * written so that it cannot itself throw. `applyChunk` most often throws
 * BECAUSE the transport failed, and this probe rides the same transport — an
 * unguarded probe would reject too and escape the action uncaught, which is
 * the redacted digest this whole file exists to avoid, reached from the
 * handler meant to avoid it.
 *
 * Only a definite `false` counts. A probe that errored or answered null has
 * not answered at all, and reporting "your grant was withdrawn" on the
 * strength of a failed round trip sends an officer to ask for a role they
 * already hold — and tells the browser to stop rather than retry.
 */
async function wasRefused(client: Client): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('members_can_manage');

    return error === null && data === false;
  } catch {
    return false;
  }
}

/**
 * The client an import runs on, which is two clients wearing one coat.
 *
 * Every gate an import passes through — the `roster_imports` RLS policy,
 * `members_list`, `member_upsert_from_roster`, `members_can_manage` and the
 * four `roster_import_*` accessors — is `kit.has_permission(...)`, which reads
 * `auth.uid()`. The service-role key carries no `sub`, so under it `auth.uid()`
 * is null and every one of those answers "denied" (checked against the real
 * database: as `service_role`, `members_can_manage()` returns false; as
 * `authenticated` carrying the officer's claims, true). That is deliberate —
 * 20260922221437_members_fixes.sql says so in as many words — so PostgREST has
 * to speak as the officer, not as the service role.
 *
 * `auth.admin.createUser` is the exact opposite: GoTrue's admin endpoints
 * refuse an end-user token.
 *
 * supabase-js hands `global.headers` to its PostgREST client AND its GoTrue
 * client from the same object, so no single `createClient` can hold one
 * identity for one and a different identity for the other. Hence a proxy:
 * reads, writes and RPCs run as the officer, `auth` runs as the service role.
 * Everything else is forwarded untouched, so a method this file has not
 * thought about cannot silently arrive as `undefined`.
 */
function importClient(officer: Client, admin: Client): Client {
  return new Proxy(officer, {
    get(target, property) {
      if (property === 'auth') return admin.auth;

      // TWO arguments, deliberately. `Reflect.get`'s third parameter is the
      // receiver, and omitting it defaults the receiver to `target`, so
      // supabase-js's `storage` and `functions` GETTERS run with `this` bound
      // to the officer's client and build themselves from the officer's
      // headers. Passing `receiver` (the proxy) here — the obvious tidy-up —
      // would re-enter this trap for every `this.` inside those getters and
      // silently change which identity they speak as. Verified empirically:
      // with the two-argument form, PostgREST and RPC carry the anon key with
      // the officer's JWT and only `/auth/v1/admin/*` carries the service key.
      const value = Reflect.get(target, property) as unknown;

      // Bound to the real client rather than to the proxy, for the same reason.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Role grants sit behind `roles.manage`-gated RLS, so an officer cannot read
 * their own permissions; they are loaded with the admin client, the same shape
 * as `apps/web/lib/server/require-permission.ts`.
 */
async function requireManage(userId: string): Promise<Client | null> {
  const admin = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(admin, userId);

  if (!hasPermission(perms, 'members', 'manage')) return null;

  return importClient(getSupabaseServerClient(), admin);
}

export const previewRosterAction = enhanceAction(
  async (formData: FormData, user): Promise<PreviewResult> => {
    const client = await requireManage(user.id);

    if (!client) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    const file = formData.get('file');

    if (!(file instanceof File)) {
      return { success: false, error: 'Choose a roster file to upload.' };
    }

    if (file.size > MAX_BYTES) {
      return { success: false, error: 'That file is larger than 5 MB.' };
    }

    // Read into memory and parsed from there. The upload is never written to
    // storage: the buffer is unreachable the moment this action returns, and a
    // spreadsheet holding every member's address does not need a second home.
    const buffer = Buffer.from(await file.arrayBuffer());

    let rows: SheetRow[];

    try {
      rows = await readRoster(buffer, file.name);
    } catch (cause) {
      return {
        success: false,
        error:
          cause instanceof RosterReadError
            ? cause.message
            : 'That file could not be read.',
      };
    }

    if (rows.length - 1 > MAX_ROWS) {
      return {
        success: false,
        error: `That file has more than ${MAX_ROWS} rows.`,
      };
    }

    const parsed = parseRoster(rows);

    // A missing required header is fatal, and is reported before any preview
    // is generated and before anything is written.
    if (parsed.missingHeaders.length > 0) {
      return {
        success: false,
        error: `That export is missing required columns: ${parsed.missingHeaders.join(', ')}.`,
      };
    }

    let plan: PreviewPlan;

    try {
      const existing = await new MembersService(client).existingForPlanning();

      plan = {
        ...buildPlan(parsed.records, existing),
        rowErrors: parsed.rowErrors,
      };
    } catch (cause) {
      return {
        success: false,
        error: messageOf(
          cause,
          'The roster could not be compared with the current membership.',
        ),
      };
    }

    // The row first, the plan into it second. `plan_enc` holds every member's
    // PII, so it is written through the accessor that encrypts it rather than
    // handed to PostgREST as a column — and that accessor needs a row to update.
    const { data, error } = await client
      .from('roster_imports')
      .insert({
        uploaded_by: user.id,
        filename: file.name,
        status: 'previewed',
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    const { error: saveError } = await client.rpc('roster_import_save_plan', {
      p_import: data.id,
      p_plan: plan as unknown as Json,
    });

    // The row survives with a null `plan_enc`. It is inert — nothing reads an
    // import except by its plan, and `applyRosterChunkAction` refuses one that
    // has none — so it is left as a record that the upload was attempted rather
    // than deleted on a path that has already shown the database is unhappy.
    if (saveError) return { success: false, error: saveError.message };

    return { success: true, importId: data.id, plan };
  },
  {},
);

export const applyRosterChunkAction = enhanceAction(
  async (
    input: { importId: string; offset: number },
    user,
  ): Promise<ApplyResult> => {
    // Re-checked on every chunk, never trusted from the upload. This is the
    // fast, readable half of the check; `RosterImportService.applyChunk` asks
    // the database the same question again immediately before it touches auth,
    // which closes the window that opens inside a chunk.
    const client = await requireManage(user.id);

    if (!client) {
      return { success: false, error: UNAUTHORIZED_MESSAGE, denied: true };
    }

    if (!Number.isInteger(input.offset) || input.offset < 0) {
      return {
        success: false,
        error: 'That import cannot be resumed from there.',
        denied: false,
      };
    }

    const { data: record, error: loadError } = await client
      .from('roster_imports')
      .select('id, filename')
      .eq('id', input.importId)
      .single();

    if (loadError)
      return { success: false, error: loadError.message, denied: false };

    const { data: planData, error: planError } = await client.rpc(
      'roster_import_load_plan',
      { p_import: input.importId },
    );

    if (planError)
      return { success: false, error: planError.message, denied: false };

    const plan = planData as unknown as ImportPlan | null;

    // `plan_enc` is nullable: the row is inserted and the plan saved into it as
    // two calls, and the accessor also answers null for an import this officer
    // may not read. Either way there is no plan, which is reported rather than
    // walked into — `plan.rows` on a null plan is a crash, and a crashed Server
    // Action reaches the officer as a redacted digest.
    if (!plan || !Array.isArray(plan.rows)) {
      return { success: false, error: NO_PLAN_MESSAGE, denied: false };
    }

    const chunk = plan.rows.slice(input.offset, input.offset + CHUNK_SIZE);

    if (input.offset === 0) {
      const { error: statusError } = await client
        .from('roster_imports')
        .update({ status: 'applying' })
        .eq('id', input.importId);

      // Refused here and the `complete` write at the end is refused too, so
      // the run would apply every row and then look as though it had never
      // started. Stopped BEFORE anything is applied rather than after.
      if (statusError)
        return { success: false, error: statusError.message, denied: false };
    }

    let result: ChunkResult;

    try {
      result = await new RosterImportService(client).applyChunk(
        chunk,
        record.filename,
      );
    } catch (cause) {
      // `applyChunk` collects ROW problems into `failures` and returns them; a
      // throw from it is never a row problem, it is a precondition about the
      // whole run. Returned as an error value, and deliberately NOT recorded as
      // `results.failures`: doing that would file a revoked grant as 372 data
      // problems, mark the import "complete with failures", and leave the
      // browser feeding chunks to an import that can never write a thing.
      //
      // Whether it was a refusal is settled by asking the database again rather
      // than by matching the prose of another module's Error message.
      const refused = await wasRefused(client);

      return {
        success: false,
        denied: refused,
        error: refused
          ? WITHDRAWN_MESSAGE
          : messageOf(cause, 'That chunk could not be applied.'),
      };
    }

    const done = input.offset + CHUNK_SIZE >= plan.rows.length;

    // Accumulated rather than replaced: each chunk is its own call, so a plain
    // save would leave the history showing only whatever the last chunk did.
    //
    // That makes the running total a READ-MODIFY-WRITE, and a dropped error on
    // either half is not one missing line in the history. A failed load reads
    // as "nothing applied yet" and the save then flattens every earlier chunk
    // to zero; a failed save leaves the next chunk to read a stale total and
    // overwrite it, taking this chunk's count with it. Either way an officer
    // reads "312 applied" when 337 landed, with nothing to tell them
    // otherwise — so both halves are checked.
    const { data: previousData, error: previousError } = await client.rpc(
      'roster_import_load_results',
      { p_import: input.importId },
    );

    if (previousError)
      return {
        success: false,
        denied: false,
        error: appliedButUnrecorded(result.applied, previousError.message),
      };

    const previous = previousData as unknown as Partial<ChunkResult> | null;

    const { error: saveError } = await client.rpc(
      'roster_import_save_results',
      {
        p_import: input.importId,
        p_results: {
          applied: (previous?.applied ?? 0) + result.applied,
          failures: [
            ...(Array.isArray(previous?.failures) ? previous.failures : []),
            ...result.failures,
          ],
        } as unknown as Json,
      },
    );

    if (saveError)
      return {
        success: false,
        denied: false,
        error: appliedButUnrecorded(result.applied, saveError.message),
      };

    if (done) {
      const { error: completeError } = await client
        .from('roster_imports')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', input.importId);

      // Every row landed but the import still reads as `applying`. Surfaced
      // rather than swallowed: a run that silently never finishes is one an
      // officer re-runs forever waiting for it to say it is done.
      if (completeError)
        return {
          success: false,
          denied: false,
          error: appliedButUnrecorded(result.applied, completeError.message),
        };

      revalidatePath('/home/members');
    }

    return {
      success: true,
      applied: result.applied,
      failures: result.failures,
      done,
    };
  },
  {},
);
