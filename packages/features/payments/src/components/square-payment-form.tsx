'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Trans } from '@kit/ui/trans';

import type { PaymentEnvironment } from '../types/payment.types';

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => Promise<SquarePayments>;
    };
  }
}

interface SquarePayments {
  card: () => Promise<SquareCard>;
}

interface SquareCard {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>;
}

export function SquarePaymentForm({
  applicationId,
  locationId,
  paymentId,
  environment,
}: {
  applicationId: string;
  locationId: string;
  paymentId: string;
  environment: PaymentEnvironment;
}) {
  const t = useTranslations('payments');
  const router = useRouter();
  const cardRef = useRef<SquareCard | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scriptUrl = environment === 'sandbox'
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';

  const initializeSquare = async () => {
    if (!window.Square) return;

    try {
      const payments = await window.Square.payments(applicationId, locationId);
      const card = await payments.card();
      await card.attach('#square-card-container');
      cardRef.current = card;
      setIsReady(true);
    } catch {
      setErrorMessage(t('squareInitError'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cardRef.current) return;

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const result = await cardRef.current.tokenize();

      if (result.status === 'OK' && result.token) {
        router.push('/home/checkout/success');
      } else {
        const message = result.errors?.[0]?.message ?? t('paymentError');
        setErrorMessage(message);
      }
    } catch {
      setErrorMessage(t('paymentError'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Script src={scriptUrl} onReady={() => { initializeSquare(); }} />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey="payments.completePayment" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-y-4">
            <div
              id="square-card-container"
              className="min-h-[100px] rounded border border-border p-2"
            />

            {errorMessage && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                {errorMessage}
              </div>
            )}

            <Button disabled={!isReady || isProcessing}>
              {isProcessing ? t('processing') : t('payNow')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
