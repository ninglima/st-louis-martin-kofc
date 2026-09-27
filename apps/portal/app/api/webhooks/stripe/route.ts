import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { StripeProvider } from '@kit/payments/providers/stripe.provider';
import { PaymentService } from '@kit/payments/server/payment.service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    const adminClient = getSupabaseServerAdminClient();

    const { data: config } = await adminClient
      .from('payment_config')
      .select('stripe_secret_key, stripe_webhook_secret')
      .single();

    if (!config?.stripe_secret_key || !config?.stripe_webhook_secret) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const provider = new StripeProvider(config.stripe_secret_key, config.stripe_webhook_secret);

    const isValid = await provider.verifyWebhookSignature(body, signature);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = await provider.parseWebhookEvent(body);

    const paymentService = new PaymentService(adminClient);
    await paymentService.updatePaymentStatus(adminClient, event.providerPaymentId, event.status);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
