'use client';

import { useState, useTransition } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
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
import { If } from '@kit/ui/if';

import {
  PaymentConfigSchema,
  type PaymentConfigFormValues,
} from '../schemas/payment-config.schema';
import { savePaymentConfigAction, testConnectionAction } from '../server/server-actions';
import type { PaymentConfig } from '../types/payment.types';

export function PaymentSettingsForm({
  config,
  webhookBaseUrl,
}: {
  config: PaymentConfig;
  webhookBaseUrl: string;
}) {
  const t = useTranslations('payments');
  const [isPending, startTransition] = useTransition();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const form = useForm({
    resolver: zodResolver(PaymentConfigSchema),
    defaultValues: {
      active_provider: config.active_provider,
      stripe_publishable_key: config.stripe_publishable_key ?? '',
      stripe_secret_key: config.stripe_secret_key ?? '',
      stripe_webhook_secret: config.stripe_webhook_secret ?? '',
      square_application_id: config.square_application_id ?? '',
      square_access_token: config.square_access_token ?? '',
      square_location_id: config.square_location_id ?? '',
      square_webhook_signature_key: config.square_webhook_signature_key ?? '',
      environment: config.environment,
    },
  });

  const activeProvider = useWatch({ control: form.control, name: 'active_provider' });

  const onSubmit = (values: PaymentConfigFormValues) => {
    startTransition(async () => {
      const promise = savePaymentConfigAction(values);
      toast.promise(() => promise, {
        success: t('configSaved'),
        error: t('configSaveError'),
        loading: t('savingConfig'),
      });
    });
  };

  const onTestConnection = () => {
    startTransition(async () => {
      try {
        const result = await testConnectionAction({ provider: activeProvider });
        setTestResult(result);
        if (result.success) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error(t('connectionTestError'));
      }
    });
  };

  return (
    <div className="flex flex-col gap-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey="payments.providerSettings" />
          </CardTitle>
          <CardDescription>
            <Trans i18nKey="payments.providerSettingsDescription" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              className="flex flex-col space-y-4"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <FormField
                name="active_provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans i18nKey="payments.activeProvider" />
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="square">Square</SelectItem>
                        <SelectItem value="stripe">Stripe</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                name="environment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <Trans i18nKey="payments.environment" />
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sandbox">Sandbox</SelectItem>
                        <SelectItem value="production">Production</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <If condition={activeProvider === 'stripe'}>
                <FormField
                  name="stripe_publishable_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.stripePublishableKey" />
                      </FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="pk_..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="stripe_secret_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.stripeSecretKey" />
                      </FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="sk_..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="stripe_webhook_secret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.stripeWebhookSecret" />
                      </FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="whsec_..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </If>

              <If condition={activeProvider === 'square'}>
                <FormField
                  name="square_application_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.squareApplicationId" />
                      </FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="sq0idp-..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="square_access_token"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.squareAccessToken" />
                      </FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="EAA..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="square_location_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.squareLocationId" />
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="L..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="square_webhook_signature_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans i18nKey="payments.squareWebhookSignatureKey" />
                      </FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </If>

              <div className="flex items-center gap-x-2">
                <Button disabled={isPending}>
                  <Trans i18nKey="payments.saveSettings" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={onTestConnection}
                >
                  <Trans i18nKey="payments.testConnection" />
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans i18nKey="payments.webhookUrls" />
          </CardTitle>
          <CardDescription>
            <Trans i18nKey="payments.webhookUrlsDescription" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-y-3 text-sm">
            <div>
              <span className="font-medium">Stripe: </span>
              <code className="rounded bg-muted px-2 py-1">
                {webhookBaseUrl}/api/webhooks/stripe
              </code>
            </div>
            <div>
              <span className="font-medium">Square: </span>
              <code className="rounded bg-muted px-2 py-1">
                {webhookBaseUrl}/api/webhooks/square
              </code>
            </div>
          </div>
        </CardContent>
      </Card>

      <If condition={!!testResult}>
        <Card>
          <CardContent className="pt-6">
            <div
              className={`rounded-lg p-3 text-sm ${
                testResult?.success
                  ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
              }`}
            >
              {testResult?.message}
            </div>
          </CardContent>
        </Card>
      </If>
    </div>
  );
}
