import { describe, expect, it } from 'vitest';

import { PaymentService } from './payment.service';

type Filter = [op: string, column: string, value: unknown];

/** Records the UPDATE body and every filter applied to it. */
function fakeClient(rows: unknown[] = [{ id: 'row-1' }]) {
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
});
