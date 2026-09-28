'use client';

import { useMemo, useState, useTransition } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';

import { availableDuesLevels } from '@kit/dues/lib/available-levels';
import { formatAmountCents } from '@kit/dues/lib/format-amount';
import type { DuesLevel, MyDuesSummary } from '@kit/dues/types';

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

import { MIN_OPEN_AMOUNT_CENTS } from '../schemas/create-payment.schema';
import { createPaymentAction } from '../server/server-actions';
import type { PublicPaymentConfig } from '../types/payment.types';
import { StripePaymentForm } from './stripe-payment-form';
import { SquarePaymentForm } from './square-payment-form';

/**
 * The form's own shape, not `CreatePaymentSchema`: the member types dollars
 * (the action takes integer cents), and switching the type back and forth
 * must not lose what was typed in either branch. `onSubmit` turns it into
 * the discriminated-union payload `createPaymentAction` parses.
 */
function checkoutFormSchema(messages: {
  levelRequired: string;
  amountTooSmall: string;
}) {
  return z
    .object({
      payment_type: z.enum(['dues', 'donation', 'event_fee']),
      level: z.string(),
      amount: z.number(),
      description: z.string().optional(),
    })
    .superRefine((values, ctx) => {
      if (values.payment_type === 'dues') {
        if (!values.level) {
          ctx.addIssue({
            code: 'custom',
            path: ['level'],
            message: messages.levelRequired,
          });
        }
      } else if (
        // The same whole-cent value `onSubmit` sends, checked against the
        // server's own minimum, so the two can never disagree.
        !(toCents(values.amount) >= MIN_OPEN_AMOUNT_CENTS)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: messages.amountTooSmall,
        });
      }
    });
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

type CheckoutFormValues = z.infer<ReturnType<typeof checkoutFormSchema>>;

export function CheckoutForm({
  config,
  duesLevels,
  myDues,
}: {
  config: PublicPaymentConfig;
  /** Active levels (`DuesService.levels()`). */
  duesLevels: DuesLevel[];
  /** The member's own summary; `null` when the sign-in has no member row. */
  myDues: MyDuesSummary | null;
}) {
  const t = useTranslations('payments');
  const [isPending, startTransition] = useTransition();
  const [paymentIntent, setPaymentIntent] = useState<{
    clientSecret?: string;
    paymentId: string;
  } | null>(null);

  // Single source of truth for both the trigger's formatted label and the
  // dropdown's options, so a fourth `payment_type` can't silently fall
  // through to a hardcoded default the way a `switch` with a wildcard
  // `default:` case would (see `payment-settings-form.tsx` for the same
  // pattern applied to `PROVIDER_OPTIONS`/`ENVIRONMENT_OPTIONS`).
  const PAYMENT_TYPE_OPTIONS = [
    { value: 'dues', label: t('types.dues') },
    { value: 'donation', label: t('types.donation') },
    { value: 'event_fee', label: t('types.eventFee') },
  ] as const;

  // Same rule the server enforces in `createPaymentAction`.
  const offeredLevels = useMemo(
    () => availableDuesLevels(duesLevels, myDues),
    [duesLevels, myDues],
  );

  const defaultLevel =
    offeredLevels.find((level) => level.slug === myDues?.duesLevel)?.slug ??
    offeredLevels[0]?.slug ??
    '';

  const levelRequired = t('levelRequired');
  const amountTooSmall = t('amountTooSmall');
  const schema = useMemo(
    () => checkoutFormSchema({ levelRequired, amountTooSmall }),
    [levelRequired, amountTooSmall],
  );

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      payment_type: 'dues',
      level: defaultLevel,
      amount: 0,
      description: '',
    },
  });

  const paymentType = useWatch({
    control: form.control,
    name: 'payment_type',
  });
  const selectedSlug = useWatch({ control: form.control, name: 'level' });
  const selectedLevel = offeredLevels.find(
    (level) => level.slug === selectedSlug,
  );

  const isDues = paymentType === 'dues';
  const duesUnavailable = isDues && offeredLevels.length === 0;

  const onSubmit = (values: CheckoutFormValues) => {
    // Dues send only the level -- the server prices them. Everything else
    // sends the amount the member typed, in cents.
    const payload =
      values.payment_type === 'dues'
        ? { payment_type: 'dues' as const, level: values.level }
        : {
            payment_type: values.payment_type,
            amount: toCents(values.amount),
            currency: 'usd',
            description: values.description,
          };

    startTransition(async () => {
      try {
        const result = await createPaymentAction(payload);

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
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-test="checkout-type">
                        <SelectValue>
                          {(value: string | null) =>
                            PAYMENT_TYPE_OPTIONS.find(
                              (option) => option.value === value,
                            )?.label ?? value
                          }
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYMENT_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isDues ? (
              myDues === null ? (
                <p
                  data-test="checkout-dues-not-linked"
                  className="text-muted-foreground text-sm"
                >
                  {t('duesNotLinked')}
                </p>
              ) : offeredLevels.length === 0 ? (
                <p
                  data-test="checkout-dues-no-levels"
                  className="text-muted-foreground text-sm"
                >
                  {t('duesNoLevels')}
                </p>
              ) : (
                <>
                  <FormField
                    name="level"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans i18nKey="payments.duesLevel" />
                        </FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger data-test="checkout-dues-level">
                              <SelectValue>
                                {(value: string | null) => {
                                  const level = offeredLevels.find(
                                    (candidate) => candidate.slug === value,
                                  );

                                  return level
                                    ? `${level.name} — ${formatAmountCents(level.amountCents)}`
                                    : value;
                                }}
                              </SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {offeredLevels.map((level) => (
                              <SelectItem key={level.slug} value={level.slug}>
                                {level.name} —{' '}
                                {formatAmountCents(level.amountCents)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedLevel ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">
                        <Trans i18nKey="payments.duesPrice" />
                      </span>
                      <output
                        data-test="checkout-dues-price"
                        className="text-lg font-semibold"
                      >
                        {formatAmountCents(selectedLevel.amountCents)}
                      </output>
                    </div>
                  ) : null}
                </>
              )
            ) : (
              <>
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
                          data-test="checkout-amount"
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
                          data-test="checkout-description"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <div>
              <Button
                data-test="checkout-submit"
                disabled={isPending || duesUnavailable}
              >
                <Trans i18nKey="payments.proceedToPayment" />
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
