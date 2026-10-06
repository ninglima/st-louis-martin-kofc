import { describe, expect, it, vi } from 'vitest';

import { NoticesService } from './notices.service';

describe('NoticesService', () => {
  it('maps last notices into a map keyed by member', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          member_id: 'm1',
          kind: 'after_30',
          sent_at: '2026-10-03T14:00:00Z',
          tracking: 'opened',
        },
      ],
      error: null,
    });
    await expect(
      new NoticesService({ rpc } as never).lastNotices(['m1', 'm2']),
    ).resolves.toEqual({
      m1: {
        memberId: 'm1',
        kind: 'after_30',
        sentAt: '2026-10-03T14:00:00Z',
        tracking: 'opened',
      },
    });
    expect(rpc).toHaveBeenCalledWith('dues_last_notices', {
      p_member_ids: ['m1', 'm2'],
    });
  });

  it('skips the call for no members', async () => {
    const rpc = vi.fn();
    await expect(
      new NoticesService({ rpc } as never).lastNotices([]),
    ).resolves.toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns null when there has been no run', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await expect(
      new NoticesService({ rpc } as never).lastRun(),
    ).resolves.toBeNull();
  });

  it('throws raw errors so the code survives', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'x' },
    });
    await expect(
      new NoticesService({ rpc } as never).list({}),
    ).rejects.toMatchObject({
      code: 'PGRST202',
    });
  });

  it('maps list rows including the send error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'n1',
          member_id: 'm1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          membership_number: '100',
          email: 'ada@example.com',
          kind: 'due_date',
          cycle_date: '2026-11-14',
          status: 'failed',
          tracking: 'failed',
          error: 'Resend 422: Invalid from',
          sent_at: null,
          created_at: '2026-10-06T10:00:00Z',
        },
      ],
      error: null,
    });
    await expect(
      new NoticesService({ rpc } as never).list({}),
    ).resolves.toEqual([
      {
        id: 'n1',
        memberId: 'm1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        membershipNumber: '100',
        email: 'ada@example.com',
        kind: 'due_date',
        cycleDate: '2026-11-14',
        status: 'failed',
        tracking: 'failed',
        error: 'Resend 422: Invalid from',
        sentAt: null,
        createdAt: '2026-10-06T10:00:00Z',
      },
    ]);
  });
});
