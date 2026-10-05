import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isPlausibleEmail, runDuesNoticesJob } from './job';

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

function fakeClient({
  rows = claimed,
  claimError = null as { message: string } | null,
  updateErrorFor = {} as Record<string, string>,
} = {}) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const runs: Record<string, unknown>[] = [];
  const rpc = vi
    .fn()
    .mockResolvedValue(
      claimError
        ? { data: null, error: claimError }
        : { data: rows, error: null },
    );
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
          const message = updateErrorFor[id];
          return { error: message ? { message } : null };
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
  allowlist: null,
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

  it('skips addresses not on EMAIL_ALLOWLIST and never calls Resend for them', async () => {
    const { client, updates } = fakeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 're_1' }] }), {
          status: 200,
        }),
    );
    const result = await runDuesNoticesJob({
      client,
      config: { ...live, allowlist: new Set(['a@x.org']) },
      fetchImpl: fetchImpl as never,
    });
    expect(result).toMatchObject({
      candidates: 2,
      sent: 1,
      skipped: 1,
      failed: 0,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(updates).toEqual(
      expect.arrayContaining([
        {
          id: 'n2',
          values: {
            status: 'failed',
            error: 'not on EMAIL_ALLOWLIST',
          },
        },
        {
          id: 'n1',
          values: expect.objectContaining({
            status: 'sent',
            resend_email_id: 're_1',
          }),
        },
      ]),
    );
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
    const { client } = fakeClient({ rows: [] });
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

  it('records a run with the error when the claim fails', async () => {
    const { client, rpc, runs } = fakeClient({
      claimError: { message: 'db down' },
    });
    const result = await runDuesNoticesJob({ client, config: live });
    expect(rpc).toHaveBeenCalledWith('dues_notices_claim', { p_mode: 'live' });
    expect(result).toMatchObject({ candidates: 0, sent: 0, error: 'db down' });
    expect(runs[0]).toMatchObject({ error: 'db down' });
  });

  it('sends the right payload to Resend: to, from, reply-to and tags', async () => {
    const { client } = fakeClient({ rows: [claimed[0]!] });
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 're_1' }] }), {
          status: 200,
        }),
    );
    await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>[];

    expect(body[0]).toMatchObject({
      from: live.from,
      to: ['a@x.org'],
      reply_to: live.replyTo,
      tags: [
        { name: 'notice_id', value: 'n1' },
        { name: 'kind', value: 'before_30' },
      ],
    });
  });

  it('handles a mixed batch: one email succeeds, one fails', async () => {
    const { client, updates } = fakeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 're_1' }, {}] }), {
          status: 200,
        }),
    );
    const result = await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });
    expect(result).toMatchObject({ sent: 1, failed: 1 });
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
          status: 'failed',
          error: 'Resend returned no id',
        }),
      },
    ]);
  });

  it('marks a bad address failed without sending it, and still sends the rest', async () => {
    const { client, updates, runs } = fakeClient({
      rows: [{ ...claimed[0]!, email: 'john@gmail' }, claimed[1]!],
    });
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 're_2' }] }), {
          status: 200,
        }),
    );
    const result = await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String(init.body)) as { to: string[] }[];
    expect(body.map((e) => e.to)).toEqual([['b@x.org']]);

    expect(result).toMatchObject({ candidates: 2, sent: 1, failed: 1 });
    expect(updates).toEqual([
      {
        id: 'n1',
        values: { status: 'failed', error: 'invalid email address' },
      },
      {
        id: 'n2',
        values: expect.objectContaining({
          status: 'sent',
          resend_email_id: 're_2',
        }),
      },
    ]);
    expect(runs[0]).toMatchObject({ sent: 1, failed: 1 });
  });

  it('counts Resend failures and invalid addresses together, and skips Resend when none are valid', async () => {
    const { client, updates } = fakeClient({
      rows: [
        { ...claimed[0]!, email: 'a@b.com; c@d.com' },
        { ...claimed[1]!, email: 'no-at-sign.org' },
      ],
    });
    const fetchImpl = vi.fn();
    const result = await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, failed: 2, error: null });
    expect(updates.map((u) => u.values.error)).toEqual([
      'invalid email address',
      'invalid email address',
    ]);
  });

  it('counts an invalid address and a Resend failure in the same run', async () => {
    const { client } = fakeClient({
      rows: [{ ...claimed[0]!, email: 'a b@x.org' }, claimed[1]!],
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'down' }), { status: 500 }),
    );
    const result = await runDuesNoticesJob({
      client,
      config: live,
      fetchImpl: fetchImpl as never,
    });

    expect(result).toMatchObject({ sent: 0, failed: 2 });
  });

  it.each([
    ['a@x.org', true],
    ['first.last+tag@mail.example.co.uk', true],
    ['john@gmail', false],
    ['a@b.com; c@d.com', false],
    ['a@b.com,c@d.com', false],
    ['a@@x.org', false],
    ['a b@x.org', false],
    ['@x.org', false],
    ['a@x.', false],
    ['', false],
  ])('isPlausibleEmail(%j) is %s', (email, expected) => {
    expect(isPlausibleEmail(email)).toBe(expected);
  });

  it('says the notice was sent but not recorded when the update fails, and sets result.error', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { client, updates, runs } = fakeClient({
      updateErrorFor: { n1: 'connection reset' },
    });
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

    expect(result.sent).toBe(2);
    expect(result.error).toBe(
      'Could not record 1 notice outcome(s): connection reset',
    );
    expect(updates[0]).toMatchObject({
      id: 'n1',
      values: expect.objectContaining({
        status: 'sent',
        resend_email_id: 're_1',
      }),
    });
    expect(runs[0]).toMatchObject({
      error: 'Could not record 1 notice outcome(s): connection reset',
    });
    expect(consoleError).toHaveBeenCalled();
    for (const call of consoleError.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(live.apiKey);
    }

    consoleError.mockRestore();
  });
});
