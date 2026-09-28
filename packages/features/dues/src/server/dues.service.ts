import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type {
  DuesLedgerRow,
  DuesLevel,
  DuesMethodFs,
  DuesStatus,
  MemberDuesSummary,
  MyDuesSummary,
  MyLedgerRow,
} from '../types';

type Client = SupabaseClient<Database>;

type SummaryRow =
  Database['public']['Functions']['member_dues_summary']['Returns'][number];

type LedgerRow =
  Database['public']['Functions']['member_dues_ledger']['Returns'][number];

type OpeningBalancesResult = {
  applied: number;
  skipped: { membership_number: string; reason: string }[];
};

function toSummary(row: SummaryRow): MemberDuesSummary {
  return {
    memberId: row.member_id,
    duesLevel: row.dues_level,
    levelName: row.level_name,
    amountCents: row.amount_cents,
    acceptedOn: row.accepted_on,
    isStudent: row.is_student,
    paidThrough: row.paid_through,
    duesStatus: row.dues_status as DuesStatus,
  };
}

function toLedgerRow(row: LedgerRow): DuesLedgerRow {
  return {
    id: row.id,
    level: row.level,
    levelName: row.level_name,
    amountCents: row.amount_cents,
    method: row.method,
    checkNumber: row.check_number,
    receivedOn: row.received_on,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    recordedByEmail: row.recorded_by_email,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

/**
 * Typed wrapper over the dues RPCs and the `dues_levels` table. Every call
 * runs as the signed-in officer (the caller passes a client built by
 * `getSupabaseServerClient()`, never the admin client) so that
 * `kit.has_permission` / `kit.assert_finance_manage` on the Postgres side
 * sees the real caller -- the same reasoning `MembersService` documents for
 * the members list page. The admin client would bypass those checks
 * entirely, silently turning every RBAC gate in Tasks 1-3 into a no-op.
 */
export class DuesService {
  constructor(private readonly client: Client) {}

  async levels(): Promise<DuesLevel[]> {
    const { data, error } = await this.client
      .from('dues_levels')
      .select('slug, name, amount_cents, self_service')
      .eq('active', true)
      .order('sort_order');

    if (error) {
      throw error;
    }

    return data.map((level) => ({
      slug: level.slug,
      name: level.name,
      amountCents: level.amount_cents,
      selfService: level.self_service,
    }));
  }

  async summaries(
    memberIds: string[],
  ): Promise<Map<string, MemberDuesSummary>> {
    if (memberIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client.rpc('member_dues_summary', {
      p_member_ids: memberIds,
    });

    if (error) {
      throw error;
    }

    return new Map((data ?? []).map((row) => [row.member_id, toSummary(row)]));
  }

  async ledger(memberId: string): Promise<DuesLedgerRow[]> {
    const { data, error } = await this.client.rpc('member_dues_ledger', {
      p_member_id: memberId,
    });

    if (error) {
      throw error;
    }

    return (data ?? []).map(toLedgerRow);
  }

  async mySummary(): Promise<MyDuesSummary | null> {
    const { data, error } = await this.client.rpc('my_dues_summary');

    if (error) {
      throw error;
    }

    if (!data?.[0]) {
      return null;
    }

    const summary = toSummary(data[0]);

    // No `active` filter: an inactive assigned level must still be seen as
    // inactive (see `MyDuesSummary`). `dues_levels` is readable by every
    // authenticated user.
    const { data: level, error: levelError } = await this.client
      .from('dues_levels')
      .select('self_service, active')
      .eq('slug', summary.duesLevel)
      .maybeSingle();

    if (levelError) {
      throw levelError;
    }

    return {
      ...summary,
      // `my_dues_summary` inner-joins `dues_levels`, so the row exists; the
      // fallbacks only keep a vanished level from ever widening the offer.
      levelSelfService: level?.self_service ?? false,
      levelActive: level?.active ?? false,
    };
  }

  async myLedger(): Promise<MyLedgerRow[]> {
    const { data, error } = await this.client.rpc('my_dues_ledger');

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  async recordPayment(input: {
    memberId: string;
    level: string;
    method: DuesMethodFs;
    receivedOn: string;
    checkNumber?: string;
  }): Promise<void> {
    const { error } = await this.client.rpc('record_dues_payment', {
      p_member_id: input.memberId,
      p_level: input.level,
      p_method: input.method,
      p_received_on: input.receivedOn,
      p_check_number: input.checkNumber,
    });

    if (error) {
      throw error;
    }
  }

  async voidPeriod(periodId: string, reason: string): Promise<void> {
    const { error } = await this.client.rpc('void_dues_period', {
      p_period_id: periodId,
      p_reason: reason,
    });

    if (error) {
      throw error;
    }
  }

  async setAcceptedOn(memberId: string, acceptedOn: string): Promise<void> {
    const { error } = await this.client.rpc('set_member_accepted_on', {
      p_member_id: memberId,
      p_accepted_on: acceptedOn,
    });

    if (error) {
      throw error;
    }
  }

  async setLevel(memberId: string, level: string): Promise<void> {
    const { error } = await this.client.rpc('set_member_dues_level', {
      p_member_id: memberId,
      p_level: level,
    });

    if (error) {
      throw error;
    }
  }

  async setStudent(memberId: string, isStudent: boolean): Promise<void> {
    const { error } = await this.client.rpc('set_member_student', {
      p_member_id: memberId,
      p_is_student: isStudent,
    });

    if (error) {
      throw error;
    }
  }

  async applyOpeningBalances(
    rows: {
      membership_number: string;
      paid_through: string;
      dues_level?: string;
    }[],
  ): Promise<OpeningBalancesResult> {
    const { data, error } = await this.client.rpc(
      'dues_opening_balances_apply',
      {
        p_rows: rows,
      },
    );

    if (error) {
      throw error;
    }

    return data as unknown as OpeningBalancesResult;
  }
}
