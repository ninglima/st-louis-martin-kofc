'use client';

import { useState, useTransition } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Trans } from '@kit/ui/trans';

import {
  CreatePaymentSchema,
  type CreatePaymentFormValues,
} from '../schemas/create-payment.schema';
import { createPaymentAction } from '../server/server-actions';
import type { PublicPaymentConfig } from '../types/payment.types';
import { StripePaymentForm } from './stripe-payment-form';
import { SquarePaymentForm } from './square-payment-form';

export function CheckoutForm({ config }: { config: PublicPaymentConfig }) {
  const t = useTranslations('payments');
  const [isPending, startTransition] = useTransition();
  const [paymentIntent, setPaymentIntent] = useState<{
    clientSecret?: string;
    paymentId: string;
  } | null>(null);

  const form = useForm({
    resolver: zodResolver(CreatePaymentSchema),
    defaultValues: {
      amount: 0,
      currency: 'usd',
      payment_type: 'dues' as const,
      description: '',
    },
  });

  const onSubmit = (values: CreatePaymentFormValues) => {
    const amountInCents = Math.round(values.amount * 100);

    startTransition(async () => {
      try {
        const result = await createPaymentAction({
          ...values,
          amount: amountInCents,
        });

        // Both providers require a further client-side step before the
        // payment is actually complete -- Stripe confirms the
        // PaymentIntent via Elements, Square tokenizes the card and calls
        // `confirmSquarePaymentAction` -- so this only stores the pending
        // payment info and lets the render branches below pick the right
        // form. Neither provider can succeed synchronously here, so there
        // is no case where redirecting straight to the success page would
        // be correct.
        setPaymentIntent({
          clientSecret: result.clientSecret,
          paymentId: result.paymentId,
        });
      } catch {
        toast.error(t('paymentError'));
      }
    });
  };

  if (paymentIntent?.clientSecret && config.activeProvider === 'stripe') {
    return (
      <StripePaymentForm
        clientSecret={paymentIntent.clientSecret}
        publishableKey={config.publishableKey ?? ''}
      />
    );
  }

  if (paymentIntent && config.activeProvider === 'square') {
    return (
      <SquarePaymentForm
        applicationId={config.publishableKey ?? ''}
        locationId={config.locationId ?? ''}
        paymentId={paymentIntent.paymentId}
        environment={config.environment}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans i18nKey="payments.makePayment" />
        </CardTitle>
        <CardDescription>
          <Trans i18nKey="payments.makePaymentDescription" />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="flex flex-col space-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              name="payment_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="payments.paymentType" />
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue>
                          {(value: string | null) => {
                            switch (value) {
                              case 'donation':
                                return t('types.donation');
                              case 'event_fee':
                                return t('types.eventFee');
                              case 'dues':
                              default:
                                return t('types.dues');
                            }
                          }}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="dues">{t('types.dues')}</SelectItem>
                      <SelectItem value="donation">
                        {t('types.donation')}
                      </SelectItem>
                      <SelectItem value="event_fee">
                        {t('types.eventFee')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="payments.amount" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.50"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseFloat(e.target.value) || 0)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans i18nKey="payments.description" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('descriptionPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <Button disabled={isPending}>
                <Trans i18nKey="payments.proceedToPayment" />
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
