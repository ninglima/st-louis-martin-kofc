import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fullMemberRow } from '../../test/fixtures/fake-supabase';
import { CHUNK_SIZE } from '../types/roster';
import type { RosterRecord } from '../types/roster';
import type { PlanAction, PlanRow } from './roster-plan';

const USER_ID = 'f530046b-751e-41a8-98b1-709d53c5b258';

/**
 * `enhanceAction`'s own job — captcha, zod, the auth redirect — is tested where
 * it lives. Stubbed here so these tests exercise the ACTION BODIES, and so the
 * module graph does not drag `server-only`, `next/headers` and GoTrue into a
 * plain vitest run.
 */
const h = vi.hoisted(() => ({
  perms: {} as Record<string, { canView: boolean; canManage: boolean }>,
  revalidated: [] as string[],
  officer: null as unknown,
  admin: null as unknown,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (fn: (params: never, user: { id: string }) => unknown) => (params: never) =>
      fn(params, { id: USER_ID }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    h.revalidated.push(path);
  },
}));

vi.mock('@kit/rbac/server/permissions.service', () => ({
  loadPermissionsForUser: () => Promise.resolve(h.perms),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => h.admin,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => h.officer,
}));

const { applyRosterChunkAction, previewRosterAction } =
  await import('./roster-actions');

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

interface TableCall {
  kind: 'select' | 'insert' | 'update';
  table: string;
  payload?: Record<string, unknown>;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface DbOptions {
  /** Rows `existingForPlanning()` reads. */
  memberRows?: Record<string, unknown>[];
  memberSelectError?: { message: string };
  insertId?: string;
  insertError?: { message: string };
  importRow?: { id: string; filename: string } | null;
  importSelectError?: { message: string };
  /** Plan `roster_import_load_plan` hands back. Default: null. */
  plan?: unknown;
  previousResults?: unknown;
  canManage?: boolean;
  /** `members_can_manage` answers with an error instead of a boolean. */
  canManageError?: { message: string };
  /** `members_can_manage` REJECTS, as a dead transport makes it. */
  canManageThrows?: string;
  savePlanError?: { message: string };
  upsertError?: { message: string };
  loadResultsError?: { message: string };
  saveResultsError?: { message: string };
  /** Keyed on the status being written, so 'applying' and 'complete' differ. */
  updateError?: (status: unknown) => { message: string } | null;
}

/**
 * The only shapes the two actions and the two services actually use:
 * `from().select/insert/update`, `rpc()`, and GoTrue's admin surface. Anything
 * else is absent on purpose — a caller reaching for it throws loudly here.
 */
function builder<T>(value: T) {
  const self = {
    select: () => self,
    eq: () => self,
    single: () => Promise.resolve(value),
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };

  return self;
}

function fakeDb(options: DbOptions = {}) {
  const tables: TableCall[] = [];
  const rpcs: RpcCall[] = [];
  const createdEmails: string[] = [];

  function selectFor(table: string) {
    if (table === 'members')
      return {
        data: options.memberSelectError ? null : (options.memberRows ?? []),
        error: options.memberSelectError ?? null,
      };

    return {
      data: options.importSelectError
        ? null
        : (options.importRow ?? { id: 'import-1', filename: 'roster.csv' }),
      error: options.importSelectError ?? null,
    };
  }

  const client = {
    from(table: string) {
      return {
        select() {
          tables.push({ kind: 'select', table });

          return builder(selectFor(table));
        },
        insert(payload: Record<string, unknown>) {
          tables.push({ kind: 'insert', table, payload });

          return builder({
            data: options.insertError
              ? null
              : { id: options.insertId ?? 'import-1' },
            error: options.insertError ?? null,
          });
        },
        update(payload: Record<string, unknown>) {
          tables.push({ kind: 'update', table, payload });

          return builder({
            data: null,
            error: options.updateError?.(payload.status) ?? null,
          });
        },
      };
    },

    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcs.push({ name, args });

      switch (name) {
        case 'members_can_manage':
          if (options.canManageThrows !== undefined)
            return Promise.reject(new Error(options.canManageThrows));

          return Promise.resolve({
            data: options.canManageError ? null : (options.canManage ?? true),
            error: options.canManageError ?? null,
          });
        case 'roster_import_load_plan':
          return Promise.resolve({ data: options.plan ?? null, error: null });
        case 'roster_import_load_results':
          return Promise.resolve({
            data: options.loadResultsError
              ? null
              : (options.previousResults ?? null),
            error: options.loadResultsError ?? null,
          });
        case 'roster_import_save_results':
          return Promise.resolve({
            data: null,
            error: options.saveResultsError ?? null,
          });
        case 'roster_import_save_plan':
          return Promise.resolve({
            data: null,
            error: options.savePlanError ?? null,
          });
        case 'member_upsert_from_roster':
          return Promise.resolve({
            data: options.upsertError ? null : 'member-id',
            error: options.upsertError ?? null,
          });
        default:
          return Promise.resolve({ data: null, error: null });
      }
    },

    auth: {
      admin: {
        createUser({ email }: { email: string }) {
          createdEmails.push(email);

          return Promise.resolve({
            data: { user: { id: `user-${createdEmails.length}`, email } },
            error: null,
          });
        },
        listUsers() {
          return Promise.resolve({ data: { users: [] }, error: null });
        },
      },
    },
  };

  return { client, tables, rpcs, createdEmails };
}

function install(options: DbOptions = {}) {
  const officer = fakeDb(options);
  const admin = fakeDb(options);

  h.officer = officer.client;
  h.admin = admin.client;

  return { officer, admin };
}

/* -------------------------------------------------------------------------- */
/* Input helpers                                                               */
/* -------------------------------------------------------------------------- */

const HEADER = 'Membership Number,First Name,Last Name,Primary Email';

function csvFile(body: string, name = 'roster.csv') {
  return new File([body], name, { type: 'text/csv' });
}

function rosterForm(body: string, name = 'roster.csv') {
  const form = new FormData();

  form.set('file', csvFile(body, name));

  return form;
}

function record(overrides: Partial<RosterRecord> = {}): RosterRecord {
  return {
    membershipNumber: '1000001',
    prefix: null,
    firstName: 'Ada',
    middleName: null,
    lastName: 'Lovelace',
    suffix: null,
    primaryEmail: 'ada@example.com',
    emailSecondary: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    primaryType: null,
    phoneCell: null,
    phoneResidence: null,
    phoneBusiness: null,
    secondaryAddress: null,
    badAddress: false,
    sourceRow: 2,
    ...overrides,
  };
}

function planRow(index: number, action: PlanAction = 'create'): PlanRow {
  const number = String(1_000_000 + index);
  const r = record({
    membershipNumber: number,
    primaryEmail: `member${index}@example.com`,
  });

  return {
    membershipNumber: number,
    displayName: `${r.firstName} ${r.lastName}`,
    sourceRow: index + 2,
    action,
    conflicts: [],
    record: r,
  };
}

function plan(rowCount: number) {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => planRow(i)),
    counts: { create: rowCount, update: 0, nochange: 0, skip: 0 },
    absentFromFile: [],
  };
}

/** The arguments of one named rpc call, or a loud failure if it never happened. */
function rpcArgs(rpcs: RpcCall[], name: string): Record<string, unknown> {
  const call = rpcs.find((c) => c.name === name);

  if (!call) throw new Error(`expected an rpc call to ${name}`);

  return call.args;
}

const MANAGE = { members: { canView: true, canManage: true } };
const VIEW_ONLY = { members: { canView: true, canManage: false } };

beforeEach(() => {
  h.perms = MANAGE;
  h.revalidated = [];
});

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

describe('previewRosterAction', () => {
  it('saves the plan through the encrypting accessor, never as a column', async () => {
    // A distinct id, so `importId` has to come back from the insert rather
    // than from anywhere else.
    const { officer } = install({ insertId: 'import-xyz' });

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toMatchObject({ success: true, importId: 'import-xyz' });

    const insert = officer.tables.find((call) => call.kind === 'insert');

    expect(insert?.table).toBe('roster_imports');
    // `plan_enc` holds every member's PII. If the plan ever rides in on the
    // insert it is either plaintext or rejected, and both are wrong.
    expect(Object.keys(insert?.payload ?? {})).toEqual([
      'uploaded_by',
      'filename',
      'status',
    ]);

    const save = rpcArgs(officer.rpcs, 'roster_import_save_plan');

    expect(save.p_import).toBe('import-xyz');
    expect((save.p_plan as { rows: PlanRow[] }).rows[0]?.membershipNumber).toBe(
      '1000001',
    );
  });

  it('carries the rows that could not be parsed into the saved plan', async () => {
    // MINE-4. `PreviewPlan` exists for exactly this: a file with malformed
    // rows must not preview as clean, or the officer approves an import that
    // silently drops the members nobody told them about.
    const { officer } = install();

    const result = await previewRosterAction(
      rosterForm(
        [
          HEADER,
          '1000001,Ada,Lovelace,ada@example.com',
          ',Nameless,Row,nobody@example.com',
          '1000003,Grace,Hopper,not-an-address',
        ].join('\n'),
      ),
    );

    const expected = [
      { sourceRow: 3, reason: 'Cannot identify the member' },
      {
        sourceRow: 4,
        reason:
          'No usable email address for member 1000003 — create this account manually',
      },
    ];

    expect(result).toMatchObject({ success: true });
    expect(
      (result as { plan: { rowErrors: unknown[] } }).plan.rowErrors,
    ).toEqual(expected);

    // And persisted, not merely returned: the apply step and any later reading
    // of the import both go through the saved plan.
    const save = rpcArgs(officer.rpcs, 'roster_import_save_plan');

    expect((save.p_plan as { rowErrors: unknown[] }).rowErrors).toEqual(
      expected,
    );
  });

  it('returns a failed membership read as a value', async () => {
    // MINE-6, the worst survivor: `existingForPlanning()` THROWS on a select
    // error, so without the try/catch a PostgREST hiccup escapes the action
    // and reaches the officer as a redacted digest with no message in it.
    const { officer } = install({
      memberSelectError: { message: 'permission denied for table members' },
    });

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toEqual({
      success: false,
      error: 'permission denied for table members',
    });
    // The read is what failed, so no import row was created for it.
    expect(officer.tables.filter((c) => c.kind === 'insert')).toEqual([]);
    expect(officer.rpcs).toEqual([]);
  });

  it('plans a member already on file as no change and makes no account', async () => {
    const { officer, admin } = install({
      memberRows: [
        fullMemberRow({
          membership_number: '1000001',
          primary_email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
        }),
      ],
    });

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toMatchObject({ success: true });

    const save = rpcArgs(officer.rpcs, 'roster_import_save_plan');
    const saved = save.p_plan as { counts: Record<string, number> };

    expect(saved.counts).toMatchObject({ create: 0, nochange: 1 });
    // A preview writes nothing and enrols nobody, whatever the plan says.
    expect(admin.createdEmails).toEqual([]);
    expect(officer.rpcs.map((c) => c.name)).not.toContain(
      'member_upsert_from_roster',
    );
  });

  it('refuses an officer without members.manage before reading anything', async () => {
    h.perms = VIEW_ONLY;

    const { officer } = install();

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toEqual({
      success: false,
      error: 'You do not have permission to import the roster.',
    });
    expect(officer.tables).toEqual([]);
    expect(officer.rpcs).toEqual([]);
  });

  it('reports a missing required column before any row is written', async () => {
    const { officer } = install();

    const result = await previewRosterAction(
      rosterForm(
        'Membership Number,First Name,Last Name\n1000001,Ada,Lovelace',
      ),
    );

    expect(result).toEqual({
      success: false,
      error: 'That export is missing required columns: Primary Email.',
    });
    // Nothing was inserted, so no import row exists for a file that can never
    // be applied.
    expect(officer.tables.filter((c) => c.kind === 'insert')).toEqual([]);
    expect(officer.rpcs).toEqual([]);
  });

  it('returns an unreadable file as a value rather than throwing', async () => {
    install();

    const result = await previewRosterAction(
      rosterForm('anything at all', 'roster.pdf'),
    );

    expect(result).toEqual({
      success: false,
      error:
        'Unsupported file type. Upload the Officers Online export as .xlsx or .csv, not "roster.pdf".',
    });
  });

  it('refuses a file over 5 MB without reading it', async () => {
    const { officer } = install();

    const oversized = `${HEADER}\n${'x'.repeat(5 * 1024 * 1024)}`;

    const result = await previewRosterAction(rosterForm(oversized));

    expect(result).toEqual({
      success: false,
      error: 'That file is larger than 5 MB.',
    });
    expect(officer.tables).toEqual([]);
  });

  function rosterOf(dataRows: number) {
    return [
      HEADER,
      ...Array.from(
        { length: dataRows },
        (_, i) => `${1_000_000 + i},Ada,Lovelace,member${i}@example.com`,
      ),
    ].join('\n');
  }

  it('refuses a file over 5,000 rows', async () => {
    const { officer } = install();

    const result = await previewRosterAction(rosterForm(rosterOf(5_001)));

    expect(result).toEqual({
      success: false,
      error: 'That file has more than 5000 rows.',
    });
    expect(officer.tables).toEqual([]);
  });

  it('accepts a file of exactly 5,000 rows', async () => {
    // MINE-1. The ceiling counts DATA rows, so the header must be subtracted
    // before the comparison. Dropping that `- 1` still refuses 5,001 — which
    // is why the test above cannot see it — and wrongly refuses the file that
    // sits exactly on the spec's limit.
    const { officer } = install();

    const result = await previewRosterAction(rosterForm(rosterOf(5_000)));

    expect(result).toMatchObject({ success: true });
    expect(officer.tables.filter((c) => c.kind === 'insert')).toHaveLength(1);
  });

  it('returns a failed insert as a value and saves no plan', async () => {
    const { officer } = install({ insertError: { message: 'insert refused' } });

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toEqual({ success: false, error: 'insert refused' });
    expect(officer.rpcs).toEqual([]);
  });

  it('returns a failed plan save as a value', async () => {
    install({ savePlanError: { message: 'insufficient_privilege' } });

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toEqual({ success: false, error: 'insufficient_privilege' });
  });
});

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

describe('applyRosterChunkAction', () => {
  it('reports a missing plan instead of crashing on it', async () => {
    // `plan_enc` is nullable: the row is inserted and the plan saved into it as
    // two separate calls. A row caught between them has no plan, and reading
    // `plan.rows` off null is a TypeError -- which Next.js shows the officer as
    // a redacted digest with no message at all.
    const { officer } = install({ plan: null });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      error:
        'That import has no saved plan, so there is nothing to apply. Upload the file again to generate a new preview.',
      denied: false,
    });
    // Nothing was applied and nothing was marked, so a re-uploaded preview is
    // still the way out.
    expect(officer.rpcs.map((c) => c.name)).not.toContain(
      'member_upsert_from_roster',
    );
    expect(officer.tables.filter((c) => c.kind === 'update')).toEqual([]);
  });

  it('reports a denied chunk as a refusal, not as one failure per row', async () => {
    // `applyChunk` THROWS when the grant has gone, before it touches auth. That
    // is one fact about the whole run, not 30 data problems: filing it as
    // `failures` would mark the import "complete with 30 failures" -- which
    // reads exactly like genuine spreadsheet trouble -- and would leave the
    // browser feeding chunks to an import that can never write.
    const { officer, admin } = install({ canManage: false, plan: plan(30) });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      denied: true,
      error:
        'Your permission to import the roster was withdrawn while it was running. Nothing further was written.',
    });
    expect('failures' in result).toBe(false);

    // No results row, so the history cannot later be read as data trouble.
    expect(officer.rpcs.map((c) => c.name)).not.toContain(
      'roster_import_save_results',
    );
    // Not complete, and no account made for anybody.
    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'complete',
      ),
    ).toEqual([]);
    expect(admin.createdEmails).toEqual([]);
  });

  it('separates a refusal from rows that genuinely failed', async () => {
    const { officer } = install({
      plan: plan(2),
      upsertError: {
        message: 'duplicate key value violates members_user_id_uk',
      },
    });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    // The same run, refused for data reasons instead: success, with the rows
    // named. This is the shape a denial must NOT be able to produce.
    expect(result).toMatchObject({ success: true, applied: 0, done: true });
    expect(
      (result as { failures: { membershipNumber: string }[] }).failures,
    ).toHaveLength(2);

    const saved = rpcArgs(officer.rpcs, 'roster_import_save_results');

    expect((saved.p_results as { failures: unknown[] }).failures).toHaveLength(
      2,
    );
  });

  it('re-checks permission on every chunk rather than trusting the upload', async () => {
    h.perms = VIEW_ONLY;

    const { officer } = install({ plan: plan(30) });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 25,
    });

    expect(result).toEqual({
      success: false,
      denied: true,
      error: 'You do not have permission to import the roster.',
    });
    expect(officer.rpcs).toEqual([]);
    expect(officer.tables).toEqual([]);
  });

  it('applies CHUNK_SIZE rows and only reports done on the last chunk', async () => {
    const { officer } = install({ plan: plan(CHUNK_SIZE + 5) });

    const first = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(first).toMatchObject({
      success: true,
      applied: CHUNK_SIZE,
      done: false,
    });
    expect(h.revalidated).toEqual([]);
    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'complete',
      ),
    ).toEqual([]);

    const second = await applyRosterChunkAction({
      importId: 'import-1',
      offset: CHUNK_SIZE,
    });

    expect(second).toMatchObject({ success: true, applied: 5, done: true });
    expect(h.revalidated).toEqual(['/home/members']);
    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'complete',
      ),
    ).toHaveLength(1);
  });

  it('finishes a plan that is an exact multiple of CHUNK_SIZE in one chunk', async () => {
    // The boundary `>=` exists for: a plan of exactly CHUNK_SIZE rows is
    // finished by its first chunk. Under `>` the officer is told the import is
    // still running, the browser asks for an offset past the end, and the
    // import is only marked complete by a round trip that applied nothing.
    const { officer } = install({ plan: plan(CHUNK_SIZE) });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toMatchObject({
      success: true,
      applied: CHUNK_SIZE,
      done: true,
    });
    expect(h.revalidated).toEqual(['/home/members']);
    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'complete',
      ),
    ).toHaveLength(1);
  });

  it('adds each chunk to the recorded results instead of replacing them', async () => {
    const { officer } = install({
      plan: plan(CHUNK_SIZE + 5),
      previousResults: {
        applied: 10,
        failures: [{ membershipNumber: '9999999', error: 'earlier' }],
      },
    });

    await applyRosterChunkAction({ importId: 'import-1', offset: CHUNK_SIZE });

    const saved = rpcArgs(officer.rpcs, 'roster_import_save_results');

    expect(saved.p_results).toEqual({
      applied: 15,
      failures: [{ membershipNumber: '9999999', error: 'earlier' }],
    });
  });

  it('runs the database as the officer and GoTrue as the service role', async () => {
    // Every gate an import passes is `kit.has_permission()`, which reads
    // `auth.uid()`; the service key carries no `sub`, so a service-role
    // PostgREST call is refused by all of them. GoTrue admin is the reverse.
    const { officer, admin } = install({ plan: plan(1) });

    await applyRosterChunkAction({ importId: 'import-1', offset: 0 });

    expect(officer.rpcs.map((c) => c.name)).toContain(
      'member_upsert_from_roster',
    );
    expect(admin.rpcs).toEqual([]);
    expect(admin.createdEmails).toEqual(['member0@example.com']);
    expect(officer.createdEmails).toEqual([]);
  });

  it('returns a failed import lookup as a value', async () => {
    install({ importSelectError: { message: 'no rows' }, plan: plan(1) });

    const result = await applyRosterChunkAction({
      importId: 'missing',
      offset: 0,
    });

    expect(result).toEqual({ success: false, error: 'no rows', denied: false });
  });

  it('reports a broken chunk as broken, not as a withdrawn grant', async () => {
    // MINE-2. `applyChunk` throws for reasons other than a refusal -- here the
    // permission probe inside it cannot reach the database at all. Classifying
    // that as "your grant was withdrawn" sends an officer to ask for a role
    // they already hold, and `denied: true` tells the loop to stop rather than
    // retry something that may well work in a minute.
    const { officer } = install({
      plan: plan(30),
      canManageError: { message: 'could not connect to server' },
    });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      denied: false,
      error: 'could not connect to server',
    });
    // Still a refusal-shaped return, so it is still not confused with rows.
    expect('failures' in result).toBe(false);
    expect(officer.rpcs.map((c) => c.name)).not.toContain(
      'roster_import_save_results',
    );
  });

  it('survives a permission probe that rejects inside the error handler', async () => {
    // D1. `applyChunk` most often throws BECAUSE the transport died, and the
    // re-probe rides the same transport. Unguarded, the probe rejects too and
    // the action escapes uncaught -- the redacted digest this file exists to
    // prevent, reached from the handler meant to prevent it.
    install({ plan: plan(30), canManageThrows: 'fetch failed' });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      denied: false,
      error: 'fetch failed',
    });
  });

  it('marks the import as applying on the first chunk and not on later ones', async () => {
    // MINE-3. 'applying' is a spec-named state: it is how a run that died
    // mid-flight is told apart from one nobody ever started.
    const { officer } = install({ plan: plan(CHUNK_SIZE + 5) });

    await applyRosterChunkAction({ importId: 'import-1', offset: 0 });

    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'applying',
      ),
    ).toHaveLength(1);

    await applyRosterChunkAction({ importId: 'import-1', offset: CHUNK_SIZE });

    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'applying',
      ),
    ).toHaveLength(1);
  });

  it('stops before applying anything if the applying mark cannot be written', async () => {
    // D2. Refused here and the `complete` write is refused too, so the run
    // would apply every row and then look as though it never started.
    const { officer } = install({
      plan: plan(30),
      updateError: (status) =>
        status === 'applying' ? { message: 'row-level security' } : null,
    });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      error: 'row-level security',
      denied: false,
    });
    expect(officer.rpcs.map((c) => c.name)).not.toContain(
      'member_upsert_from_roster',
    );
  });

  it('surfaces a results save that failed, because the next chunk overwrites it', async () => {
    // D2, the nastiest variant. The running total is a read-modify-write, so a
    // dropped save is not one missing line: the next chunk reads the stale
    // total and overwrites it, and this chunk's count is gone for good.
    const { officer } = install({
      plan: plan(CHUNK_SIZE + 5),
      saveResultsError: { message: '503 Service Unavailable' },
    });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      denied: false,
      error: `${CHUNK_SIZE} rows were applied, but the import record could not be updated: 503 Service Unavailable. Re-run the import — applying it again is safe.`,
    });
    // Not marked complete off the back of a record that is already wrong.
    expect(
      officer.tables.filter(
        (c) => c.kind === 'update' && c.payload?.status === 'complete',
      ),
    ).toEqual([]);
  });

  it('surfaces a results read that failed, rather than flattening the total to this chunk', async () => {
    // The other half of the read-modify-write. A failed load reads as "nothing
    // applied yet", and saving on top of that zeroes every earlier chunk.
    const { officer } = install({
      plan: plan(CHUNK_SIZE + 5),
      previousResults: { applied: 10, failures: [] },
      loadResultsError: { message: 'statement timeout' },
    });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: CHUNK_SIZE,
    });

    expect(result).toEqual({
      success: false,
      denied: false,
      error:
        '5 rows were applied, but the import record could not be updated: statement timeout. Re-run the import — applying it again is safe.',
    });
    expect(officer.rpcs.map((c) => c.name)).not.toContain(
      'roster_import_save_results',
    );
  });

  it('surfaces a completion mark that failed instead of reporting a clean finish', async () => {
    // D2. Every row landed but the import still reads as `applying`; an
    // officer waiting for it to say it is done re-runs it forever.
    const { officer } = install({
      plan: plan(CHUNK_SIZE),
      updateError: (status) =>
        status === 'complete' ? { message: 'deadlock detected' } : null,
    });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: 0,
    });

    expect(result).toEqual({
      success: false,
      denied: false,
      error: `${CHUNK_SIZE} rows were applied, but the import record could not be updated: deadlock detected. Re-run the import — applying it again is safe.`,
    });
    // The members list is not revalidated on the strength of a finish that
    // never got recorded.
    expect(h.revalidated).toEqual([]);
    expect(officer.rpcs.map((c) => c.name)).toContain(
      'roster_import_save_results',
    );
  });

  it('names the stored filename as the source of every applied row', async () => {
    const { officer } = install({
      plan: plan(1),
      importRow: { id: 'import-1', filename: 'october-roster.xlsx' },
    });

    await applyRosterChunkAction({ importId: 'import-1', offset: 0 });

    const upsert = rpcArgs(officer.rpcs, 'member_upsert_from_roster');

    expect((upsert.p as { source_file: string }).source_file).toBe(
      'october-roster.xlsx',
    );
  });

  it('refuses an offset that is not a whole number', async () => {
    // MINE-5. `NaN` slices to an empty chunk and `NaN + 25 >= 30` is false, so
    // `done` never becomes true and the browser loops forever applying nothing.
    const { officer } = install({ plan: plan(30) });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: Number.NaN,
    });

    expect(result).toEqual({
      success: false,
      error: 'That import cannot be resumed from there.',
      denied: false,
    });
    expect(officer.rpcs).toEqual([]);
    expect(officer.tables).toEqual([]);
  });

  it('refuses a negative offset rather than slicing from the end', async () => {
    const { officer } = install({ plan: plan(30) });

    const result = await applyRosterChunkAction({
      importId: 'import-1',
      offset: -5,
    });

    expect(result).toEqual({
      success: false,
      error: 'That import cannot be resumed from there.',
      denied: false,
    });
    expect(officer.rpcs).toEqual([]);
  });
});
