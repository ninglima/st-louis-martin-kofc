import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { SquareProvider } from '@kit/payments/providers/square.provider';
import { PaymentService } from '@kit/payments/server/payment.service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-square-hmacsha256-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    const adminClient = getSupabaseServerAdminClient();

    const { data: config } = await adminClient
      .from('payment_config')
      .select('square_access_token, square_location_id, square_webhook_signature_key, environment')
      .single();

    if (!config?.square_access_token || !config?.square_location_id) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 500 });
    }

    const provider = new SquareProvider(
      config.square_access_token,
      config.square_location_id,
      config.square_webhook_signature_key ?? '',
      config.environment === 'sandbox',
    );

    const isValid = await provider.verifyWebhookSignature(body, signature);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = await provider.parseWebhookEvent(body);

    const paymentService = new PaymentService(adminClient);
    await paymentService.updatePaymentStatus(adminClient, event.providerPaymentId, event.status);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Square webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
