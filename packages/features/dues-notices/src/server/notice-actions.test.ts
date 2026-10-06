import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const adminFrom = vi.fn();

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: adminFrom,
  }),
}));

vi.mock('../config', () => ({
  readNoticesConfig: vi.fn(),
}));

vi.mock('./send-claimed', () => ({
  sendClaimedNotices: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (fn: (data: unknown) => unknown) => fn,
}));

import { readNoticesConfig } from '../config';
import { sendManualNoticesAction } from './notice-actions';
import { sendClaimedNotices } from './send-claimed';

const liveConfig = {
  mode: 'live' as const,
  apiKey: 're_k',
  webhookSecret: '',
  jobsSecret: 's',
  from: 'FS <d@x.org>',
  replyTo: '',
  siteUrl: 'https://x.org',
  allowlist: null,
  missingForLive: [] as string[],
};

describe('sendManualNoticesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it('refuses when mode is not live', async () => {
    vi.mocked(readNoticesConfig).mockReturnValue({
      ...liveConfig,
      mode: 'dry_run',
    });

    const result = await sendManualNoticesAction({
      kind: 'due_date',
      memberIds: ['00000000-0000-4000-8000-000000000001'],
    });

    expect(result).toEqual({
      success: false,
      error: 'Dues notices must be in live mode to send test emails.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('claims and sends when live', async () => {
    vi.mocked(readNoticesConfig).mockReturnValue(liveConfig);
    rpc.mockResolvedValue({
      data: [
        {
          notice_id: 'n1',
          member_id: '00000000-0000-4000-8000-000000000001',
          first_name: 'Ada',
          email: 'ada@example.com',
          kind: 'due_date',
          cycle_date: '2026-11-14',
          first_dues: false,
          level_name: 'Regular',
          amount_cents: 5000,
        },
      ],
      error: null,
    });
    vi.mocked(sendClaimedNotices).mockResolvedValue({
      sent: 1,
      skipped: 0,
      failed: 0,
      error: null,
    });

    const result = await sendManualNoticesAction({
      kind: 'due_date',
      memberIds: ['00000000-0000-4000-8000-000000000001'],
    });

    expect(rpc).toHaveBeenCalledWith('dues_notices_manual_claim', {
      p_kind: 'due_date',
      p_member_ids: ['00000000-0000-4000-8000-000000000001'],
    });
    expect(sendClaimedNotices).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      candidates: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
  });
});
