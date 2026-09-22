'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

function StripeCheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const t = useTranslations('payments');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMessage(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/home/checkout/success`,
      },
    });

    if (error) {
      setErrorMessage(error.message ?? t('paymentError'));
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey="payments.completePayment" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-y-4">
          <PaymentElement />

          {errorMessage && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              {errorMessage}
            </div>
          )}

          <Button disabled={!stripe || isProcessing}>
            {isProcessing ? t('processing') : t('payNow')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function StripePaymentForm({
  clientSecret,
  publishableKey,
}: {
  clientSecret: string;
  publishableKey: string;
}) {
  const stripePromise = loadStripe(publishableKey);

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <StripeCheckoutForm />
    </Elements>
  );
}
