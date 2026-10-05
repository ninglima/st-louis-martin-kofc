import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sendBatch } from './resend';

const email = (i: number) => ({
  from: 'FS <dues@example.org>',
  to: `m${i}@example.com`,
  subject: 's',
  html: 'h',
  text: 't',
  tags: [{ name: 'notice_id', value: `n${i}` }],
});

describe('sendBatch', () => {
  it('posts batches of 100 and returns ids in order', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[];
      return new Response(
        JSON.stringify({ data: body.map((_, i) => ({ id: `re_${i}` })) }),
        { status: 200 },
      );
    });
    const results = await sendBatch(
      're_key',
      Array.from({ length: 150 }, (_, i) => email(i)),
      fetchImpl as never,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.resend.com/emails/batch',
    );
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer re_key',
    });
    expect(
      JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body))[0],
    ).toMatchObject({
      to: ['m0@example.com'],
      tags: [{ name: 'notice_id', value: 'n0' }],
    });
    expect(results).toHaveLength(150);
    expect(results[0]).toEqual({ ok: true, id: 're_0' });
    expect(results[120]).toEqual({ ok: true, id: 're_20' });
  });

  it('marks a whole batch failed on an HTTP error', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Invalid from' }), {
          status: 422,
        }),
    );
    const results = await sendBatch(
      're_key',
      [email(1), email(2)],
      fetchImpl as never,
    );
    expect(results).toEqual([
      { ok: false, error: 'Resend 422: Invalid from' },
      { ok: false, error: 'Resend 422: Invalid from' },
    ]);
  });

  it('marks a batch failed when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('timeout');
    });
    expect(await sendBatch('re_key', [email(1)], fetchImpl as never)).toEqual([
      { ok: false, error: 'timeout' },
    ]);
  });

  it('sends an abort signal, timing out after 30s by default', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 're_0' }] })),
    );

    await sendBatch('re_key', [email(0)], fetchImpl as never);

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );

    timeoutSpy.mockRestore();
  });

  it('accepts an injectable timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: 're_0' }] })),
    );

    await sendBatch('re_key', [email(0)], fetchImpl as never, 5_000);

    expect(timeoutSpy).toHaveBeenCalledWith(5_000);

    timeoutSpy.mockRestore();
  });

  it('appends the cause message when fetch throws with a cause', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed', { cause: new Error('ECONNRESET') });
    });

    expect(await sendBatch('re_key', [email(1)], fetchImpl as never)).toEqual([
      { ok: false, error: 'fetch failed: ECONNRESET' },
    ]);
  });

  it('redacts the API key if it leaks into a thrown error message', async () => {
    const apiKey = 're_super_secret_key';
    const fetchImpl = vi.fn(async () => {
      throw new Error(`invalid header value: Bearer ${apiKey}`);
    });

    const results = await sendBatch(apiKey, [email(1)], fetchImpl as never);

    expect(results).toEqual([
      { ok: false, error: 'invalid header value: Bearer [redacted]' },
    ]);
    expect(JSON.stringify(results)).not.toContain(apiKey);
  });

  it('caps a thrown error message at 300 characters', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('x'.repeat(1000));
    });

    const results = await sendBatch('re_key', [email(1)], fetchImpl as never);

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toHaveLength(300);
  });
});
