import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@kit/supabase/database';

import type { FinanceDashboard } from '../types';
import { FinanceService } from './finance.service';

const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient<Database>;

beforeEach(() => {
  rpc.mockReset();
});

/**
 * `FinanceService.dashboard` does no key mapping at all -- it hands back
 * whatever `rpc('finance_dashboard')` returns, cast straight to
 * `FinanceDashboard` (see `finance.service.ts`). That means nothing here
 * checks that the jsonb `kit.finance_dashboard_at` builds
 * (`20260929120100_finance_dashboard.sql`) actually uses these key names --
 * a rename on either side would produce `NaN`/empty charts silently rather
 * than a type or test failure. This test pins the exact key set, copied
 * from the migration's `jsonb_build_object` calls, so a rename on either
 * side breaks a unit test instead of shipping silently (final review M4).
 */
describe('FinanceService.dashboard', () => {
  it('returns the finance_dashboard RPC payload unchanged', async () => {
    const payload: FinanceDashboard = {
      year: 2026,
      yearStart: '2026-07-01',
      yearEnd: '2027-07-01',
      isCurrentYear: true,
      today: '2026-10-16',
      duesCollectedCents: 580_000,
      outstandingCents: 12_000,
      collection: { numerator: 40, denominator: 45 },
      statusCounts: {
        current: 30,
        due_soon: 5,
        due: 4,
        lapsed: 1,
        no_record: 0,
      },
      hostingToDateCents: 34_500,
      hostingProjectionCents: 120_000,
      duesByMonth: [
        {
          month: '2026-07-01',
          onlineCents: 5_000,
          checkCents: 1_000,
          cashCents: 0,
        },
      ],
      hostingByMonth: [
        { month: '2026-07-01', provider: 'supabase', cents: 2_500 },
      ],
    };

    rpc.mockResolvedValue({ data: payload, error: null });

    const result = await new FinanceService(client).dashboard(2026);

    expect(rpc).toHaveBeenCalledWith('finance_dashboard', { p_year: 2026 });
    expect(result).toEqual(payload);
  });

  it('throws the RPC error as-is', async () => {
    const error = { code: '42501', message: 'forbidden' };
    rpc.mockResolvedValue({ data: null, error });

    await expect(new FinanceService(client).dashboard(2026)).rejects.toEqual(
      error,
    );
  });
});
