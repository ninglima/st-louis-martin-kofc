import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  savePlanError?: { message: string };
  upsertError?: { message: string };
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

          return builder({ data: null, error: null });
        },
      };
    },

    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcs.push({ name, args });

      switch (name) {
        case 'members_can_manage':
          return Promise.resolve({
            data: options.canManage ?? true,
            error: null,
          });
        case 'roster_import_load_plan':
          return Promise.resolve({ data: options.plan ?? null, error: null });
        case 'roster_import_load_results':
          return Promise.resolve({
            data: options.previousResults ?? null,
            error: null,
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
    const { officer } = install();

    const result = await previewRosterAction(
      rosterForm(`${HEADER}\n1000001,Ada,Lovelace,ada@example.com`),
    );

    expect(result).toMatchObject({ success: true, importId: 'import-1' });

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

    expect(save.p_import).toBe('import-1');
    expect((save.p_plan as { rows: PlanRow[] }).rows[0]?.membershipNumber).toBe(
      '1000001',
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

  it('refuses a file over 5,000 rows', async () => {
    const { officer } = install();

    const body = [
      HEADER,
      ...Array.from(
        { length: 5_001 },
        (_, i) => `${1_000_000 + i},Ada,Lovelace,member${i}@example.com`,
      ),
    ].join('\n');

    const result = await previewRosterAction(rosterForm(body));

    expect(result).toEqual({
      success: false,
      error: 'That file has more than 5000 rows.',
    });
    expect(officer.tables).toEqual([]);
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
