import { afterEach, describe, expect, it, vi } from 'vitest';

const sendPaymentReceiptOnce = vi.fn(async () => undefined);

vi.mock('./send-receipt', () => ({
  sendPaymentReceiptOnce,
}));

const { PaymentService } = await import('./payment.service');

type Filter = [op: string, column: string, value: unknown];

/**
 * Records the UPDATE body and every filter applied to it. `rows` is what the
 * UPDATE returns; `existing` is what a follow-up plain SELECT returns.
 */
function fakeClient(
  rows: unknown[] = [{ id: 'row-1' }],
  existing: unknown[] = [],
) {
  const seen = { table: '', update: null as unknown, filters: [] as Filter[] };

  const builder = {
    eq(column: string, value: unknown) {
      seen.filters.push(['eq', column, value]);
      return builder;
    },
    neq(column: string, value: unknown) {
      seen.filters.push(['neq', column, value]);
      return builder;
    },
    select: async () => ({ data: rows, error: null }),
  };

  const client = {
    from(table: string) {
      seen.table = table;
      return {
        update(body: unknown) {
          seen.update = body;
          return builder;
        },
        select: () => ({
          eq: async () => ({ data: existing, error: null }),
        }),
      };
    },
  };

  return { seen, client: client as never };
}

describe('PaymentService.updatePaymentStatus', () => {
  it('writes the status with a plain UPDATE keyed by provider id', async () => {
    const { seen, client } = fakeClient();

    await new PaymentService(client).updatePaymentStatus(
      client,
      'pi_1',
      'refunded',
    );

    expect(seen.table).toBe('payments');
    expect(seen.update).toMatchObject({ status: 'refunded' });
    expect(seen.filters).toEqual([['eq', 'provider_payment_id', 'pi_1']]);
    expect(sendPaymentReceiptOnce).not.toHaveBeenCalled();
  });

  it('never moves a refunded payment back to another status', async () => {
    const { seen, client } = fakeClient();

    await new PaymentService(client).updatePaymentStatus(
      client,
      'pi_1',
      'succeeded',
    );

    expect(seen.filters).toContainEqual(['neq', 'status', 'refunded']);
  });

  it('only applies succeeded to rows that are not already succeeded', async () => {
    const { seen, client } = fakeClient([{ id: 'row-1' }]);

    await new PaymentService(client).updatePaymentStatus(
      client,
      'pi_1',
      'succeeded',
    );

    expect(seen.filters).toContainEqual(['neq', 'status', 'succeeded']);
    expect(sendPaymentReceiptOnce).toHaveBeenCalledWith(client, 'row-1');
  });

  it('does not send a receipt when no row transitions to succeeded', async () => {
    const { client } = fakeClient([]);

    await new PaymentService(client).updatePaymentStatus(
      client,
      'pi_1',
      'succeeded',
    );

    expect(sendPaymentReceiptOnce).not.toHaveBeenCalled();
  });

  it('only refunds a payment whose amount matches when asked to', async () => {
    const { seen, client } = fakeClient();

    await new PaymentService(client).updatePaymentStatus(
      client,
      'sq_1',
      'refunded',
      { onlyIfAmount: 5000 },
    );

    expect(seen.filters).toContainEqual(['eq', 'amount', 5000]);
  });

  it('logs a partial refund filtered out by the amount guard as such', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = fakeClient([], [{ id: 'row-1', amount: 5000 }]);

    await new PaymentService(client).updatePaymentStatus(
      client,
      'sq_1',
      'refunded',
      { onlyIfAmount: 1000 },
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/partial refund ignored/i),
      expect.objectContaining({ providerPaymentId: 'sq_1' }),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringMatching(/matched no payment/i),
      expect.anything(),
    );
  });

  it('logs a refund for an unknown payment as unmatched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = fakeClient([], []);

    await new PaymentService(client).updatePaymentStatus(
      client,
      'sq_404',
      'refunded',
      { onlyIfAmount: 1000 },
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/matched no payment/i),
      expect.anything(),
    );
  });
});

afterEach(() => {
  sendPaymentReceiptOnce.mockClear();
  vi.restoreAllMocks();
});
