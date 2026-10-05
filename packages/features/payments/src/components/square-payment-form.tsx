'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useTranslations } from 'next-intl';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Trans } from '@kit/ui/trans';

import { confirmSquarePaymentAction } from '../server/server-actions';
import type { PaymentEnvironment } from '../types/payment.types';

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => Promise<SquarePayments>;
    };
  }
}

interface SquareTokenResult {
  status: string;
  token?: string;
  errors?: Array<{ message: string }>;
}

interface SquarePayments {
  card: () => Promise<SquareCard>;
  ach: (options: {
    redirectURI: string;
    transactionId: string;
  }) => Promise<SquareAch>;
}

interface SquareCard {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<SquareTokenResult>;
}

/**
 * Square's bank (ACH) method. `tokenize` opens Square's Plaid bank-login
 * window; the token arrives later through the `ontokenization` event, not
 * as the return value.
 */
interface SquareAch {
  addEventListener: (
    type: 'ontokenization',
    listener: (
      event: CustomEvent<{
        tokenResult?: SquareTokenResult;
        error?: { message?: string };
      }>,
    ) => void,
  ) => void;
  tokenize: (options: {
    accountHolderName: string;
    intent: 'CHARGE';
    amount: string;
    currency: 'USD';
  }) => Promise<void>;
}

type Method = 'card' | 'bank';

export function SquarePaymentForm({
  applicationId,
  locationId,
  paymentId,
  amountCents,
  environment,
}: {
  applicationId: string;
  locationId: string;
  paymentId: string;
  /** Server-priced; shown to the member in Square's bank authorization. */
  amountCents: number;
  environment: PaymentEnvironment;
}) {
  const t = useTranslations('payments');
  const router = useRouter();
  const cardRef = useRef<SquareCard | null>(null);
  const achRef = useRef<SquareAch | null>(null);
  const achResolver = useRef<((result: SquareTokenResult) => void) | null>(
    null,
  );
  const [method, setMethod] = useState<Method>('card');
  const [achAvailable, setAchAvailable] = useState(false);
  const [accountHolderName, setAccountHolderName] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scriptUrl =
    environment === 'sandbox'
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

      // Bank payments are optional: if Square won't start ACH for this
      // account (not enabled, or outside the US), the card still works and
      // the bank option simply isn't offered.
      try {
        const ach = await payments.ach({
          redirectURI: `${window.location.origin}/home/checkout`,
          transactionId: paymentId,
        });

        ach.addEventListener('ontokenization', (event) => {
          const { tokenResult, error } = event.detail;

          achResolver.current?.(
            tokenResult ?? {
              status: 'Error',
              errors: [{ message: error?.message ?? t('paymentError') }],
            },
          );
          achResolver.current = null;
        });

        achRef.current = ach;
        setAchAvailable(true);
      } catch {
        setAchAvailable(false);
      }
    } catch {
      setErrorMessage(t('squareInitError'));
    }
  };

  /** Opens Square's bank login and waits for the token it hands back. */
  const tokenizeBank = (ach: SquareAch) =>
    new Promise<SquareTokenResult>((resolve, reject) => {
      achResolver.current = resolve;

      ach
        .tokenize({
          accountHolderName: accountHolderName.trim(),
          intent: 'CHARGE',
          amount: (amountCents / 100).toFixed(2),
          currency: 'USD',
        })
        .catch(reject);
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const bank = method === 'bank';

    if (bank ? !achRef.current : !cardRef.current) return;

    if (bank && accountHolderName.trim() === '') {
      setErrorMessage(t('accountHolderNameRequired'));
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const result =
        bank && achRef.current
          ? await tokenizeBank(achRef.current)
          : await cardRef.current!.tokenize();

      if (result.status === 'OK' && result.token) {
        const confirmResult = await confirmSquarePaymentAction({
          paymentId,
          sourceToken: result.token,
        });

        if (confirmResult.success) {
          // A card completes at once; a bank payment is `processing` until
          // it clears, and the success page says so.
          router.push(
            `/home/checkout/success?redirect_status=${confirmResult.status}`,
          );
        } else {
          setErrorMessage(confirmResult.error);
        }
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
      <Script
        src={scriptUrl}
        onReady={() => {
          initializeSquare();
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey="payments.completePayment" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-y-4">
            {achAvailable && (
              <div
                className="flex gap-x-2"
                role="radiogroup"
                aria-label={t('paymentMethod')}
              >
                {(['card', 'bank'] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={method === option}
                    variant={method === option ? 'default' : 'outline'}
                    data-test={`square-method-${option}`}
                    onClick={() => {
                      setMethod(option);
                      setErrorMessage(null);
                    }}
                  >
                    {option === 'card' ? t('methodCard') : t('methodBank')}
                  </Button>
                ))}
              </div>
            )}

            {/*
              Kept mounted (only hidden) while the bank option is chosen:
              Square attached its card iframe here once, at init.
            */}
            <div
              id="square-card-container"
              className={
                method === 'card'
                  ? 'min-h-[100px] rounded border border-border p-2'
                  : 'hidden'
              }
            />

            {method === 'bank' && (
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="square-account-holder">
                  {t('accountHolderName')}
                </Label>
                <Input
                  id="square-account-holder"
                  data-test="square-account-holder"
                  autoComplete="name"
                  value={accountHolderName}
                  onChange={(event) => setAccountHolderName(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t('bankPaymentNote')}
                </p>
              </div>
            )}

            {errorMessage && (
              <div className="flex flex-col gap-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                <p>{errorMessage}</p>
                {/*
                  A hard decline (or any other terminal failure) writes the
                  row to a non-`pending` status server-side, so re-submitting
                  this same form is a dead end -- the atomic claim in
                  `confirmSquarePaymentAction` rejects it. This always gives
                  the member a way out: back to checkout to start a fresh
                  payment. A soft `next/link` navigation is fine here (unlike
                  `update-password-form.tsx`'s forced full reload) since
                  there's no stale-session/claims concern involved.
                */}
                <Link
                  href="/home/checkout"
                  className="font-medium underline underline-offset-4"
                  data-test="square-payment-restart-link"
                >
                  {t('backToCheckout')}
                </Link>
              </div>
            )}

            <Button type="submit" disabled={!isReady || isProcessing}>
              {isProcessing ? t('processing') : t('payNow')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
