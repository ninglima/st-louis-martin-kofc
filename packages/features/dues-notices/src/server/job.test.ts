import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runDuesNoticesJob } from './job';

const claimed = [
  {
    notice_id: 'n1',
    member_id: 'm1',
    first_name: 'A',
    email: 'a@x.org',
    kind: 'before_30',
    cycle_date: '2026-11-14',
    first_dues: false,
    level_name: 'Regular',
    amount_cents: 5000,
  },
  {
    notice_id: 'n2',
    member_id: 'm2',
    first_name: 'B',
    email: 'b@x.org',
    kind: 'due_date',
    cycle_date: '2026-10-15',
    first_dues: false,
    level_name: 'Regular',
    amount_cents: 5000,
  },
];

function fakeClient(rows: unknown[] = claimed) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const runs: Record<string, unknown>[] = [];
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
  const client = {
    rpc,
    from: (table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        if (table === 'dues_notice_runs') runs.push(values);
        return { error: null };
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updates.push({ id, values });
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as never, rpc, updates, runs };
}

const live = {
  mode: 'live' as const,
  apiKey: 're_k',
  webhookSecret: '',
  jobsSecret: 's',
  from: 'FS <d@x.org>',
  replyTo: 'fs@x.org',
  siteUrl: 'https://x.org',
  missingForLive: [],
};

describe('runDuesNoticesJob', () => {
  it('does nothing but record a run when off', async () => {
    const { client, rpc, runs } = fakeClient();
    const result = await runDuesNoticesJob({
      client,
      config: { ...live, mode: 'off' },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'off', candidates: 0, sent: 0 });
    expect(runs).toEqual([expect.objectContaining({ mode: 'off' })]);
  });

  it('claims but sends nothing in dry run', async () => {
    const { client, rpc, runs } = fakeClient();
    const fetchImpl = vi.fn();
    const result = await runDuesNoticesJob({
      client,
      config: { ...live, mode: 'dry_run' },
      fetchImpl: fetchImpl as never,
    });
    expect(rpc).toHaveBeenCalledWith('dues_notices_claim', {
      p_mode: 'dry_run',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: 'dry_run',
      candidates: 2,
      sent: 0,
      skipped: 2,
      failed: 0,
    });
    expect(runs[0]).toMatchObject({
      mode: 'dry_run',
      candidates: 2,
      skipped: 2,
    });
  });

  it('sends live and marks each notice sent with its Resend id', async () => {
    const { client, updates } = fakeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: 're_1' }, { id: 're_2' }] }),
          { status: 200 },
        ),
    );
    const result = await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });
    expect(result).toMatchObject({
      mode: 'live',
      candidates: 2,
      sent: 2,
      failed: 0,
    });
    expect(updates).toEqual([
      {
        id: 'n1',
        values: expect.objectContaining({
          status: 'sent',
          resend_email_id: 're_1',
        }),
      },
      {
        id: 'n2',
        values: expect.objectContaining({
          status: 'sent',
          resend_email_id: 're_2',
        }),
      },
    ]);
  });

  it('marks notices failed when Resend fails, and still records the run', async () => {
    const { client, updates, runs } = fakeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'bad from' }), { status: 422 }),
    );
    const result = await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });
    expect(result).toMatchObject({ sent: 0, failed: 2 });
    expect(updates[0]!.values).toMatchObject({
      status: 'failed',
      error: 'Resend 422: bad from',
    });
    expect(runs[0]).toMatchObject({ failed: 2 });
  });

  it('claims nothing when live is missing configuration', async () => {
    const { client, rpc, runs } = fakeClient();
    const result = await runDuesNoticesJob({
      client,
      config: { ...live, apiKey: '', missingForLive: ['RESEND_API_KEY'] },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.error).toBe('Live mode needs RESEND_API_KEY');
    expect(runs[0]).toMatchObject({
      mode: 'live',
      error: 'Live mode needs RESEND_API_KEY',
    });
  });

  it('sends nothing when there is nothing new to claim', async () => {
    const { client } = fakeClient([]);
    const fetchImpl = vi.fn();
    expect(
      await runDuesNoticesJob({
        client,
        config: live,
        fetchImpl: fetchImpl as never,
      }),
    ).toMatchObject({ candidates: 0, sent: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
