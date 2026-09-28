'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type * as z from 'zod';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { formatAmountCents } from '../lib/format-amount';
import { periodPreview } from '../lib/period-preview';
import { RecordPaymentSchema } from '../schemas';
import { recordDuesPaymentAction } from '../server/dues-actions';
import type { DuesLevel, DuesMethodFs } from '../types';

const METHOD_LABELS: Record<DuesMethodFs, string> = {
  check: 'Check',
  cash: 'Cash',
  waived: 'Waived',
};

/** The browser's own local date, as `YYYY-MM-DD` -- never the server's or
 * UTC's idea of "today". `RecordPaymentSchema` compares this against
 * America/Chicago separately (see `schemas.ts`); this is only ever the
 * form's starting point, and the officer can still change it. */
function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

type RecordPaymentValues = z.infer<typeof RecordPaymentSchema>;

function buildDefaultValues(memberId: string, defaultLevel: string) {
  return {
    memberId,
    level: defaultLevel,
    method: 'check' as DuesMethodFs,
    receivedOn: localToday(),
    checkNumber: '',
  };
}

/**
 * Records a check, cash or waived dues payment for one member. No amount
 * field: `record_dues_payment` prices the payment off the chosen level
 * itself (or zero, for a waiver), so an amount here could only ever disagree
 * with the level and never actually change what gets charged.
 */
export function RecordPaymentForm({
  memberId,
  levels,
  defaultLevel,
  paidThrough,
  acceptedOn,
  trigger,
}: {
  memberId: string;
  levels: DuesLevel[];
  defaultLevel: string;
  paidThrough: string | null;
  acceptedOn: string | null;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(RecordPaymentSchema),
    defaultValues: buildDefaultValues(memberId, defaultLevel),
  });

  // Re-seed every time the dialog opens, so a cancelled entry never leaks
  // into the next time this same dialog instance is opened.
  useEffect(() => {
    if (open) {
      setFormError(null);
      form.reset(buildDefaultValues(memberId, defaultLevel));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const method = useWatch({ control: form.control, name: 'method' });
  const preview = periodPreview(paidThrough, acceptedOn);

  const onSubmit = (values: RecordPaymentValues) => {
    setFormError(null);

    startTransition(async () => {
      const result = await recordDuesPaymentAction(values);

      if (result.success) {
        toast.success('Payment recorded');
        setOpen(false);
      } else {
        setFormError(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />

      <DialogContent data-test="record-payment-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Check, cash or a waiver -- online payments record themselves.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger
                        data-test="record-payment-level"
                        className="w-full"
                      >
                        <SelectValue placeholder="Select a level">
                          {(value: string | null) => {
                            const level = levels.find((l) => l.slug === value);

                            return level
                              ? `${level.name} — ${formatAmountCents(level.amountCents)}`
                              : 'Select a level';
                          }}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {levels.map((level) => (
                        <SelectItem key={level.slug} value={level.slug}>
                          {level.name} — {formatAmountCents(level.amountCents)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger
                        data-test="record-payment-method"
                        className="w-full"
                      >
                        <SelectValue>
                          {(value: string | null) =>
                            METHOD_LABELS[(value as DuesMethodFs) ?? 'check']
                          }
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.keys(METHOD_LABELS) as DuesMethodFs[]).map(
                        (option) => (
                          <SelectItem key={option} value={option}>
                            {METHOD_LABELS[option]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <If condition={method === 'check'}>
              <FormField
                control={form.control}
                name="checkNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check number</FormLabel>
                    <FormControl>
                      <Input
                        data-test="record-payment-check-number"
                        placeholder="1042"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </If>

            <FormField
              control={form.control}
              name="receivedOn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Received on</FormLabel>
                  <FormControl>
                    <Input
                      data-test="record-payment-received-on"
                      type="date"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p
              className="text-muted-foreground text-xs"
              data-test="record-payment-period-preview"
            >
              {preview
                ? `Covers ${preview.start} → ${preview.end}`
                : 'Set the acceptance date first'}
            </p>

            <If condition={formError}>
              {(error) => (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              )}
            </If>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                data-test="cancel-record-payment"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="record-payment-submit"
                disabled={isPending || !preview}
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
