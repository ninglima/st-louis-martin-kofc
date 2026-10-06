import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendEmail = vi.fn();

vi.mock('@kit/email/resend', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { NOT_ON_ALLOWLIST_ERROR } from '@kit/email/allowlist';

import type { PaymentReceiptsConfig } from '../config';
import {
  INVALID_EMAIL_ERROR,
  NO_EMAIL_ERROR,
  sendPaymentReceiptOnce,
} from './send-receipt';

const PAYMENT_ID = '0f4c2a8e-1b9d-4c3a-9e7f-2d5b6a8c9e01';
const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';

type Row = Record<string, unknown>;

function liveConfig(
  overrides: Partial<PaymentReceiptsConfig> = {},
): PaymentReceiptsConfig {
  return {
    mode: 'live',
    apiKey: 're_x',
    from: 'Council <council@example.org>',
    replyTo: '',
    siteUrl: 'https://portal.example.org',
    allowlist: null,
    missingForLive: [],
    ...overrides,
  };
}

function paymentRow(overrides: Row = {}): Row {
  return {
    id: PAYMENT_ID,
    user_id: USER_ID,
    amount: 5800,
    currency: 'usd',
    payment_type: 'dues',
    description: 'Annual dues — Regular',
    provider: 'stripe',
    provider_payment_id: 'pi_1',
    status: 'succeeded',
    receipt_sent_at: null,
    created_at: '2026-10-06T12:00:00.000Z',
    updated_at: '2026-10-06T12:05:00.000Z',
    ...overrides,
  };
}

function fakeClient(opts: {
  payment?: Row | null;
  member?: Row | null;
  account?: Row | null;
} = {}) {
  const payment = opts.payment === undefined ? paymentRow() : opts.payment;
  const member =
    opts.member === undefined
      ? { primary_email: 'nick@example.com', first_name: 'Nick' }
      : opts.member;
  const account =
    opts.account === undefined
      ? { email: 'account@example.com', name: 'Account Name' }
      : opts.account;

  const updates: Row[] = [];
  let paymentState = payment ? { ...payment } : null;

  function paymentsTable() {
    return {
      select() {
        return {
          eq(_col: string, _id: string) {
            return {
              maybeSingle: async () => ({
                data: paymentState,
                error: null,
              }),
            };
          },
        };
      },
      update(values: Row) {
        updates.push(values);
        const chain = {
          eq() {
            return chain;
          },
          is(_col: string, value: unknown) {
            return {
              select: async () => {
                if (
                  paymentState &&
                  paymentState.receipt_sent_at == null &&
                  value === null
                ) {
                  paymentState = { ...paymentState, ...values };
                  return { data: [{ id: PAYMENT_ID }], error: null };
                }
                return { data: [], error: null };
              },
              then: (resolve: (v: unknown) => void) => {
                if (
                  paymentState &&
                  paymentState.receipt_sent_at == null &&
                  value === null
                ) {
                  paymentState = { ...paymentState, ...values };
                }
                resolve({ error: null });
              },
            };
          },
          then: (resolve: (v: unknown) => void) => {
            if (paymentState) paymentState = { ...paymentState, ...values };
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
  }

  function membersTable() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({ data: member, error: null }),
            };
          },
        };
      },
    };
  }

  function accountsTable() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({ data: account, error: null }),
            };
          },
        };
      },
    };
  }

  const client = {
    from(table: string) {
      if (table === 'payments') return paymentsTable();
      if (table === 'members') return membersTable();
      if (table === 'accounts') return accountsTable();
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { client: client as never, updates, getPayment: () => paymentState };
}

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, id: 're_1' });
});

describe('sendPaymentReceiptOnce', () => {
  it('does nothing when mode is off', async () => {
    const { client, updates } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig({ mode: 'off' }),
    });

    expect(updates).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('claims and sends once in live mode', async () => {
    const { client, updates } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates[0]).toMatchObject({
      receipt_sent_at: '2026-10-06T15:00:00.000Z',
      receipt_error: null,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![1]).toMatchObject({
      to: 'nick@example.com',
      subject: 'Payment receipt — Council dues',
    });
    expect(sendEmail.mock.calls[0]![2]).toMatchObject({
      idempotencyKey: `payment-receipt/${PAYMENT_ID}`,
    });
  });

  it('claims without calling Resend in dry_run', async () => {
    const { client, updates } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig({ mode: 'dry_run' }),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('is a no-op when already claimed', async () => {
    const { client, updates } = fakeClient({
      payment: paymentRow({ receipt_sent_at: '2026-10-01T00:00:00.000Z' }),
    });

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
    });

    expect(updates).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('second concurrent claim does not send twice', async () => {
    const { client } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:00:00.000Z',
    });
    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:01:00.000Z',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('records no-email and does not call Resend', async () => {
    const { client, updates } = fakeClient({
      member: { primary_email: null, first_name: 'Nick' },
      account: { email: null, name: 'Nick' },
    });

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates[0]).toMatchObject({
      receipt_sent_at: '2026-10-06T15:00:00.000Z',
      receipt_error: NO_EMAIL_ERROR,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('records invalid email', async () => {
    const { client, updates } = fakeClient({
      member: { primary_email: 'not-an-email', first_name: 'Nick' },
    });

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates[0]).toMatchObject({
      receipt_error: INVALID_EMAIL_ERROR,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('records allowlist misses', async () => {
    const { client, updates } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig({ allowlist: new Set(['other@example.com']) }),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates[0]).toMatchObject({
      receipt_error: NOT_ON_ALLOWLIST_ERROR,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('clears the claim after a retryable Resend failure', async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: 'Resend 429',
      retryable: true,
    });
    const { client, updates } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates.at(-1)).toMatchObject({
      receipt_sent_at: null,
      receipt_error: 'Resend 429',
    });
  });

  it('keeps the claim after a permanent Resend failure', async () => {
    sendEmail.mockResolvedValue({
      ok: false,
      error: 'Resend 400 bad',
      retryable: false,
    });
    const { client, updates } = fakeClient();

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
      now: () => '2026-10-06T15:00:00.000Z',
    });

    expect(updates[0]).toMatchObject({
      receipt_sent_at: '2026-10-06T15:00:00.000Z',
    });
    expect(updates.at(-1)).toMatchObject({
      receipt_error: 'Resend 400 bad',
    });
  });

  it('falls back to accounts.email when member has none', async () => {
    const { client } = fakeClient({
      member: { primary_email: null, first_name: null },
      account: { email: 'account@example.com', name: 'Ada Lovelace' },
    });

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig(),
    });

    expect(sendEmail.mock.calls[0]![1]).toMatchObject({
      to: 'account@example.com',
    });
    expect(sendEmail.mock.calls[0]![1].html).toContain('Dear Ada,');
  });

  it('skips when live config is incomplete', async () => {
    const { client, updates } = fakeClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendPaymentReceiptOnce(client, PAYMENT_ID, {
      config: liveConfig({
        missingForLive: ['PAYMENT_RECEIPTS_FROM'],
      }),
    });

    expect(updates).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
