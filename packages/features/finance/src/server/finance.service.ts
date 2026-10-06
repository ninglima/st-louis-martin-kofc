import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type {
  AgingBucket,
  AgingBucketKey,
  CollectionProgress,
  FinanceDashboard,
  FollowUpRow,
  ForecastMember,
  ForecastMonth,
  HostingCost,
  HostingCostInput,
  HostingProvider,
  LapsedMember,
  LatestBill,
  NetYear,
  PaymentToCheck,
  Retention,
} from '../types';
import type { DuesStatus } from '@kit/dues/types';

type Client = SupabaseClient<Database>;

/**
 * Typed wrapper over the finance RPCs. Pass the SIGNED-IN user's client
 * (getSupabaseServerClient), never the admin client: every function checks
 * the caller's permissions against auth.uid(). Dashboard reads accept
 * finance.view or dashboard_finance.view; the rest stay on finance.view /
 * finance.manage. Errors are thrown as-is so callers keep the
 * Postgres/PostgREST `code` (readDuesIfDeployed and the actions' message
 * mapping both rely on it).
 */
export class FinanceService {
  constructor(private readonly client: Client) {}

  async providers(): Promise<HostingProvider[]> {
    const { data, error } = await this.client
      .from('hosting_providers')
      .select('slug, name')
      .eq('active', true)
      .order('sort_order');
    if (error) throw error;
    return data ?? [];
  }

  async listCosts(year: number): Promise<HostingCost[]> {
    const { data, error } = await this.client.rpc('hosting_costs_list', {
      p_year: year,
    });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      provider: r.provider,
      providerName: r.provider_name,
      amountCents: r.amount_cents,
      paidOn: r.paid_on,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      note: r.note,
      recordedByEmail: r.recorded_by_email,
      updatedAt: r.updated_at,
    }));
  }

  async latestBills(): Promise<LatestBill[]> {
    const { data, error } = await this.client.rpc('hosting_cost_latest');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      provider: r.provider,
      amountCents: r.amount_cents,
      periodStart: r.period_start,
      periodEnd: r.period_end,
    }));
  }

  async overlaps(input: {
    provider: string;
    periodStart: string;
    periodEnd: string;
    excludeId?: string;
  }): Promise<string[]> {
    const { data, error } = await this.client.rpc('hosting_cost_overlaps', {
      p_provider: input.provider,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_exclude_id: input.excludeId,
    });
    if (error) throw error;
    return (data ?? []) as string[];
  }

  async saveCost(input: HostingCostInput): Promise<void> {
    const { error } = await this.client.rpc('hosting_cost_upsert', {
      p_provider: input.provider,
      p_amount_cents: input.amountCents,
      p_paid_on: input.paidOn,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_note: input.note ?? undefined,
      p_id: input.id ?? undefined,
    });
    if (error) throw error;
  }

  async deleteCost(id: string): Promise<void> {
    const { error } = await this.client.rpc('hosting_cost_delete', {
      p_id: id,
    });
    if (error) throw error;
  }

  async repeatLast(provider: string): Promise<void> {
    const { error } = await this.client.rpc('hosting_cost_repeat_last', {
      p_provider: provider,
    });
    if (error) throw error;
  }

  async dashboard(year: number): Promise<FinanceDashboard> {
    const { data, error } = await this.client.rpc('finance_dashboard', {
      p_year: year,
    });
    if (error) throw error;
    return data as unknown as FinanceDashboard;
  }

  async netByYear(): Promise<NetYear[]> {
    const { data, error } = await this.client.rpc('finance_net_by_year');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      year: r.year,
      duesCents: Number(r.dues_cents),
      hostingCents: Number(r.hosting_cents),
    }));
  }

  async followUp(): Promise<FollowUpRow[]> {
    const { data, error } = await this.client.rpc('finance_follow_up');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      duesStatus: r.dues_status as DuesStatus,
      paidThrough: r.paid_through,
      levelName: r.level_name,
      amountCents: r.amount_cents,
    }));
  }

  async paymentsToCheck(): Promise<PaymentToCheck[]> {
    const { data, error } = await this.client.rpc('finance_payments_to_check');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      paymentId: r.payment_id,
      createdAt: r.created_at,
      memberId: r.member_id,
      memberName: r.member_name,
      duesLevel: r.dues_level,
      amountCents: r.amount_cents,
      provider: r.provider,
    }));
  }

  async collectionProgress(year: number): Promise<CollectionProgress> {
    const { data, error } = await this.client.rpc(
      'finance_collection_progress',
      { p_year: year },
    );
    if (error) throw error;
    return data as unknown as CollectionProgress;
  }

  async renewalsForecast(): Promise<ForecastMonth[]> {
    const { data, error } = await this.client.rpc('finance_renewals_forecast');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      month: r.month,
      members: Number(r.members),
      cents: Number(r.cents),
    }));
  }

  async forecastMembers(month: string): Promise<ForecastMember[]> {
    const { data, error } = await this.client.rpc('finance_forecast_members', {
      p_month: month,
    });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      paidThrough: r.paid_through,
      levelName: r.level_name,
      amountCents: r.amount_cents,
    }));
  }

  async lapseAging(): Promise<AgingBucket[]> {
    const { data, error } = await this.client.rpc('finance_lapse_aging');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      bucket: r.bucket as AgingBucketKey,
      members: Number(r.members),
      cents: Number(r.cents),
    }));
  }

  async lapsedMembers(): Promise<LapsedMember[]> {
    const { data, error } = await this.client.rpc('finance_lapsed_members');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      membershipNumber: r.membership_number,
      daysUnpaid: r.days_unpaid,
      bucket: r.bucket as AgingBucketKey,
      levelName: r.level_name,
      amountCents: r.amount_cents,
      lastPaidOn: r.last_paid_on,
    }));
  }

  async retention(): Promise<Retention> {
    const { data, error } = await this.client.rpc('finance_retention');
    if (error) throw error;
    return data as unknown as Retention;
  }
}
