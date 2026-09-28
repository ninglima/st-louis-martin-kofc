'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type * as z from 'zod';

import { chicagoToday } from '@kit/dues/schemas';
import { formatAmountCents } from '@kit/dues/lib/format-amount';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Textarea } from '@kit/ui/textarea';

import { addDaysIso, monthlyEquivalentCents } from '../lib/dates';
import { centsToDollarsInput, parseDollarsToCents } from '../lib/money';
import { HostingCostFormSchema } from '../schemas';
import {
  hostingOverlapsAction,
  saveHostingCostAction,
} from '../server/hosting-actions';
import type { HostingCost, HostingProvider } from '../types';

type FormValues = z.infer<typeof HostingCostFormSchema>;

function buildDefaultValues(
  providers: HostingProvider[],
  cost?: HostingCost,
): FormValues {
  if (cost) {
    return {
      id: cost.id,
      provider: cost.provider,
      amount: centsToDollarsInput(cost.amountCents),
      paidOn: cost.paidOn,
      coversFrom: cost.periodStart,
      coversTo: addDaysIso(cost.periodEnd, -1),
      note: cost.note ?? '',
    };
  }

  const today = chicagoToday();

  return {
    provider: providers[0]?.slug ?? '',
    amount: '',
    paidOn: today,
    coversFrom: today,
    coversTo: today,
    note: '',
  };
}

/**
 * Add or edit one hosting bill. The overlap check runs on the first submit
 * of a given form state; a second submit -- with the provider and covered
 * dates unchanged -- skips straight to saving, which is what "Save anyway"
 * means.
 */
export function HostingCostFormDialog({
  providers,
  cost,
  trigger,
}: {
  providers: HostingProvider[];
  cost?: HostingCost;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [overlapCount, setOverlapCount] = useState<number | null>(null);
  // Set when the overlap check itself fails (a network/server error, not an
  // actual overlap). There is nothing more to check, so the officer is
  // offered the same "Save anyway" escape hatch as a real overlap, rather
  // than being stuck unable to save at all.
  const [checkFailed, setCheckFailed] = useState(false);
  const acknowledged = overlapCount !== null || checkFailed;

  const form = useForm({
    resolver: zodResolver(HostingCostFormSchema),
    defaultValues: buildDefaultValues(providers, cost),
  });

  // Re-seed every time the dialog opens, so a cancelled entry never leaks
  // into the next time this same dialog instance is opened.
  useEffect(() => {
    if (open) {
      setOverlapCount(null);
      setCheckFailed(false);
      form.reset(buildDefaultValues(providers, cost));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [provider, amount, coversFrom, coversTo] = useWatch({
    control: form.control,
    name: ['provider', 'amount', 'coversFrom', 'coversTo'],
  });

  const cents = parseDollarsToCents(amount ?? '');
  const datesInOrder = Boolean(
    coversFrom && coversTo && coversTo >= coversFrom,
  );
  const monthly =
    cents !== null && datesInOrder
      ? formatAmountCents(
          monthlyEquivalentCents(cents, coversFrom, addDaysIso(coversTo, 1)),
        )
      : null;

  const providerName =
    providers.find((p) => p.slug === provider)?.name ?? provider;

  const resetAcknowledgement = () => {
    setOverlapCount(null);
    setCheckFailed(false);
  };

  const onSubmit = (values: FormValues) => {
    startTransition(async () => {
      if (!acknowledged) {
        const check = await hostingOverlapsAction({
          provider: values.provider,
          periodStart: values.coversFrom,
          periodEnd: addDaysIso(values.coversTo, 1),
          excludeId: values.id,
        });

        if (!check.success) {
          // The check itself failed -- not an actual overlap. Nothing more
          // to check, so offer the same "Save anyway" escape hatch rather
          // than silently falling through to save, or leaving the officer
          // stuck unable to save at all.
          toast.error(check.error);
          setCheckFailed(true);
          return;
        }

        if (check.overlaps.length > 0) {
          setOverlapCount(check.overlaps.length);
          return;
        }
      }

      const result = await saveHostingCostAction(values);

      if (result.success) {
        toast.success('Hosting cost saved');
        setOpen(false);
        setOverlapCount(null);
        setCheckFailed(false);
        form.reset(buildDefaultValues(providers, cost));
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />

      <DialogContent data-test="hosting-cost-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {cost ? 'Edit hosting bill' : 'Add hosting bill'}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="hosting-cost-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => {
                if (value === null) return;

                form.setValue('provider', value, { shouldValidate: true });
                resetAcknowledgement();
              }}
            >
              <SelectTrigger
                id="hosting-cost-provider"
                data-test="hosting-cost-provider"
                className="w-full"
              >
                <SelectValue placeholder="Select a provider">
                  {(value: string | null) =>
                    providers.find((p) => p.slug === value)?.name ??
                    'Select a provider'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.provider ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.provider.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-y-1">
            <Label htmlFor="hosting-cost-amount">Amount</Label>
            <Input
              id="hosting-cost-amount"
              data-test="hosting-cost-amount"
              inputMode="decimal"
              placeholder="25.00"
              {...form.register('amount')}
            />
            {form.formState.errors.amount ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.amount.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-y-1">
            <Label htmlFor="hosting-cost-paid-on">Paid on</Label>
            <Input
              id="hosting-cost-paid-on"
              data-test="hosting-cost-paid-on"
              type="date"
              {...form.register('paidOn')}
            />
            {form.formState.errors.paidOn ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.paidOn.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-y-1">
            <Label htmlFor="hosting-cost-covers-from">Covers from</Label>
            <Input
              id="hosting-cost-covers-from"
              data-test="hosting-cost-covers-from"
              type="date"
              {...form.register('coversFrom', {
                onChange: resetAcknowledgement,
              })}
            />
            {form.formState.errors.coversFrom ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.coversFrom.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-y-1">
            <Label htmlFor="hosting-cost-covers-to">Covers to</Label>
            <Input
              id="hosting-cost-covers-to"
              data-test="hosting-cost-covers-to"
              type="date"
              {...form.register('coversTo', {
                onChange: resetAcknowledgement,
              })}
            />
            {form.formState.errors.coversTo ? (
              <p className="text-destructive text-sm">
                {form.formState.errors.coversTo.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-y-1">
            <Label htmlFor="hosting-cost-note">Note</Label>
            <Textarea
              id="hosting-cost-note"
              data-test="hosting-cost-note"
              rows={2}
              {...form.register('note')}
            />
          </div>

          {monthly ? (
            <p
              data-test="hosting-cost-monthly"
              className="text-muted-foreground text-sm"
            >
              ≈ {monthly} a month
            </p>
          ) : null}

          {overlapCount !== null ? (
            <p
              data-test="hosting-cost-overlap-warning"
              className="text-destructive text-sm"
            >
              This overlaps {overlapCount} other {providerName} bill(s). Save
              anyway?
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-test="hosting-cost-save"
              disabled={isPending}
            >
              {acknowledged ? 'Save anyway' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
