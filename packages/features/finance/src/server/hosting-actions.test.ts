import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock('@kit/next/actions', () => ({ enhanceAction: (fn: unknown) => fn }));
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));

import {
  deleteHostingCostAction,
  hostingOverlapsAction,
  repeatLastHostingCostAction,
  saveHostingCostAction,
} from './hosting-actions';

const bill = {
  provider: 'supabase',
  amount: '25',
  paidOn: '2026-10-01',
  coversFrom: '2026-10-01',
  coversTo: '2026-10-31',
};

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe('hosting actions', () => {
  it('saves a bill with cents and an exclusive end, then revalidates both pages', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(saveHostingCostAction(bill)).resolves.toEqual({
      success: true,
    });
    expect(rpc).toHaveBeenCalledWith('hosting_cost_upsert', {
      p_provider: 'supabase',
      p_amount_cents: 2500,
      p_paid_on: '2026-10-01',
      p_period_start: '2026-10-01',
      p_period_end: '2026-11-01',
      p_note: undefined,
      p_id: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/home/hosting-costs');
    expect(revalidatePath).toHaveBeenCalledWith('/home');
  });

  it('rejects bad input without calling the database', async () => {
    const result = await saveHostingCostAction({ ...bill, amount: 'abc' });
    expect(result.success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      { code: '42501', message: 'forbidden' },
      'You do not have permission to manage hosting costs.',
    ],
    [
      { code: 'P0001', message: 'unknown hosting provider: aws' },
      'unknown hosting provider: aws',
    ],
    [
      { code: 'XX000', message: 'boom' },
      'Something went wrong saving the hosting cost.',
    ],
  ])('maps %o to a message', async (error, message) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(saveHostingCostAction(bill)).resolves.toEqual({
      success: false,
      error: message,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('deletes and repeats', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      deleteHostingCostAction({ id: '11111111-1111-4111-8111-111111111111' }),
    ).resolves.toEqual({ success: true });
    await expect(
      repeatLastHostingCostAction({ provider: 'supabase' }),
    ).resolves.toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith('hosting_cost_repeat_last', {
      p_provider: 'supabase',
    });
  });

  it('returns overlapping ids', async () => {
    rpc.mockResolvedValue({ data: ['a', 'b'], error: null });
    await expect(
      hostingOverlapsAction({
        provider: 'supabase',
        periodStart: '2026-10-01',
        periodEnd: '2026-11-01',
      }),
    ).resolves.toEqual({ success: true, overlaps: ['a', 'b'] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
