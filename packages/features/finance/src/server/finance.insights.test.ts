import { describe, expect, it, vi } from 'vitest';

import { FinanceService } from './finance.service';

function clientReturning(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { client: { rpc } as never, rpc };
}

describe('FinanceService insights', () => {
  it('passes collection progress through', async () => {
    const progress = {
      expected: 4,
      renewed: 2,
      expectedCents: 23200,
      collectedCents: 12700,
      byMonth: [{ month: '2040-07-01', cents: 0, cumulativeCents: 0 }],
    };
    const { client, rpc } = clientReturning(progress);
    await expect(
      new FinanceService(client).collectionProgress(2040),
    ).resolves.toEqual(progress);
    expect(rpc).toHaveBeenCalledWith('finance_collection_progress', {
      p_year: 2040,
    });
  });

  it('maps lapsed members', async () => {
    const { client } = clientReturning([
      {
        member_id: 'm1',
        first_name: 'A',
        last_name: 'B',
        membership_number: '1',
        days_unpaid: 31,
        bucket: '31-90',
        level_name: 'Regular',
        amount_cents: 5000,
        last_paid_on: null,
      },
    ]);
    await expect(new FinanceService(client).lapsedMembers()).resolves.toEqual([
      {
        memberId: 'm1',
        firstName: 'A',
        lastName: 'B',
        membershipNumber: '1',
        daysUnpaid: 31,
        bucket: '31-90',
        levelName: 'Regular',
        amountCents: 5000,
        lastPaidOn: null,
      },
    ]);
  });

  it('requests forecast members for a month', async () => {
    const { client, rpc } = clientReturning([]);
    await new FinanceService(client).forecastMembers('2040-10-01');
    expect(rpc).toHaveBeenCalledWith('finance_forecast_members', {
      p_month: '2040-10-01',
    });
  });

  it('throws the raw error so its code survives', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'x' },
    });
    await expect(
      new FinanceService({ rpc } as never).retention(),
    ).rejects.toMatchObject({ code: 'PGRST202' });
  });
});
