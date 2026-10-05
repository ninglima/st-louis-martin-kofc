import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type {
  LastNotice,
  MemberNoticeHistoryRow,
  NoticeEvent,
  NoticeKind,
  NoticeRow,
  NoticeRun,
  NoticesMode,
  Tracking,
  Unreachable,
} from '../types';

type Client = SupabaseClient<Database>;

/**
 * Typed wrapper over the dues-notices reads, same convention as
 * FinanceService: pass the signed-in user's client (getSupabaseServerClient),
 * never the admin client -- every RPC is `security definer` and checks
 * finance.view / finance.manage against auth.uid() internally. Errors are
 * thrown as-is so readDuesIfDeployed and the action's message mapping both
 * keep the original Postgres/PostgREST `code`.
 */
export class NoticesService {
  constructor(private readonly client: Client) {}

  async list(input: {
    kind?: string;
    tracking?: string;
    limit?: number;
  }): Promise<NoticeRow[]> {
    const { data, error } = await this.client.rpc('dues_notices_list', {
      p_kind: input.kind,
      p_tracking: input.tracking,
      p_limit: input.limit,
    });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      email: r.email,
      kind: r.kind as NoticeKind,
      cycleDate: r.cycle_date,
      status: r.status,
      tracking: r.tracking as Tracking,
      sentAt: r.sent_at,
      createdAt: r.created_at,
    }));
  }

  async events(noticeId: string): Promise<NoticeEvent[]> {
    const { data, error } = await this.client.rpc('dues_notice_events_for', {
      p_notice_id: noticeId,
    });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      type: r.type,
      occurredAt: r.occurred_at,
    }));
  }

  async lastRun(): Promise<NoticeRun | null> {
    const { data, error } = await this.client.rpc('dues_notices_last_run');
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) return null;
    return {
      ranAt: row.ran_at,
      mode: row.mode as NoticesMode,
      candidates: row.candidates,
      sent: row.sent,
      skipped: row.skipped,
      failed: row.failed,
      error: row.error,
    };
  }

  async unreachable(): Promise<Unreachable[]> {
    const { data, error } = await this.client.rpc('dues_notices_unreachable');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      reason: r.reason as Unreachable['reason'],
      detail: r.detail,
    }));
  }

  async lastNotices(memberIds: string[]): Promise<Record<string, LastNotice>> {
    if (memberIds.length === 0) return {};

    const { data, error } = await this.client.rpc('dues_last_notices', {
      p_member_ids: memberIds,
    });
    if (error) throw error;

    const result: Record<string, LastNotice> = {};

    for (const r of data ?? []) {
      result[r.member_id] = {
        memberId: r.member_id,
        kind: r.kind as NoticeKind,
        sentAt: r.sent_at,
        tracking: r.tracking as Tracking,
      };
    }

    return result;
  }

  async memberHistory(memberId: string): Promise<MemberNoticeHistoryRow[]> {
    const { data, error } = await this.client.rpc('member_dues_notices', {
      p_member_id: memberId,
    });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      kind: r.kind as NoticeKind,
      cycleDate: r.cycle_date,
      sentAt: r.sent_at,
      tracking: r.tracking as Tracking,
    }));
  }

  async optOut(memberId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc(
      'member_dues_notices_opt_out',
      { p_member_id: memberId },
    );
    if (error) throw error;
    return data === true;
  }

  async setOptOut(memberId: string, optOut: boolean): Promise<void> {
    const { error } = await this.client.rpc('set_member_dues_notices', {
      p_member_id: memberId,
      p_opt_out: optOut,
    });
    if (error) throw error;
  }
}
