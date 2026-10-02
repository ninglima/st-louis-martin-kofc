import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { readNoticesConfig } from '@kit/dues-notices/config';
import { duesNoticesSink } from '@kit/dues-notices/server/webhook';
import { handleResendWebhookWithSinks } from '@kit/email/webhook';
import { eventEmailsSink } from '@kit/event-emails/server/webhook-sink';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const admin = getSupabaseServerAdminClient();
    const { status } = await handleResendWebhookWithSinks({
      sinks: [duesNoticesSink(admin), eventEmailsSink(admin)],
      secret: readNoticesConfig().webhookSecret,
      headers: request.headers,
      body,
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    return NextResponse.json({ received: status === 200 }, { status });
  } catch (error) {
    console.error('Resend webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
