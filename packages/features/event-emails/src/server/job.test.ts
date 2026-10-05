import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { fakeClient, liveConfig, row } from './fakes';
import { runEventEmailsJob } from './job';

describe('runEventEmailsJob', () => {
  it('records an off run and enqueues nothing', async () => {
    const { client, rpc, runs } = fakeClient();
    const r = await runEventEmailsJob({
      client,
      config: { ...liveConfig, mode: 'off' },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(runs).toEqual([
      {
        mode: 'off',
        candidates: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        error: null,
      },
    ]);
    expect(r.mode).toBe('off');
  });

  it('enqueues reminders then dispatches, recording a dry_run run', async () => {
    const { client, rpc, runs } = fakeClient({
      pages: [[row({ mode: 'dry_run' })]],
    });
    const fetchImpl = vi.fn();
    await runEventEmailsJob({
      client,
      config: { ...liveConfig, mode: 'dry_run' },
      fetchImpl: fetchImpl as never,
    });
    expect(rpc.mock.calls[0]).toEqual([
      'event_reminders_enqueue',
      { p_mode: 'dry_run' },
    ]);
    expect(runs[0]).toMatchObject({
      mode: 'dry_run',
      candidates: 1,
      skipped: 1,
      sent: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records a live run with the send counts', async () => {
    const { client, runs } = fakeClient({ pages: [[row()]] });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }),
    );
    await runEventEmailsJob({
      client,
      config: liveConfig,
      fetchImpl: fetchImpl as never,
    });
    expect(runs[0]).toMatchObject({
      mode: 'live',
      candidates: 1,
      sent: 1,
      failed: 0,
      error: null,
    });
  });
});
