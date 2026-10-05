'use client';

import { useState, useTransition } from 'react';

import { toast } from 'sonner';

import { formatAmountCents } from '@kit/dues/lib/format-amount';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { If } from '@kit/ui/if';

import { addDaysIso, nextPeriod } from '../lib/dates';
import { repeatLastHostingCostAction } from '../server/hosting-actions';
import type { HostingProvider, LatestBill } from '../types';

/**
 * One click to bill the same provider again for the next period, off the
 * most recent bill on file. Only offered for providers that have a bill to
 * repeat -- there is nothing to base a first bill on.
 */
export function RepeatLastBill({
  providers,
  latest,
}: {
  providers: HostingProvider[];
  latest: LatestBill[];
}) {
  const [pending, setPending] = useState<LatestBill | null>(null);
  const [isPending, startTransition] = useTransition();

  const billable = latest.filter((bill) =>
    providers.some((p) => p.slug === bill.provider),
  );

  if (billable.length === 0) {
    return null;
  }

  const providerName = (slug: string) =>
    providers.find((p) => p.slug === slug)?.name ?? slug;

  const onConfirm = () => {
    const bill = pending;
    if (!bill) return;

    startTransition(async () => {
      const result = await repeatLastHostingCostAction({
        provider: bill.provider,
      });

      if (result.success) {
        toast.success('Hosting cost saved');
        setPending(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  const preview = pending
    ? nextPeriod(pending.periodStart, pending.periodEnd)
    : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" data-test="hosting-repeat-last">
              Repeat last bill
            </Button>
          }
        />
        <DropdownMenuContent>
          {billable.map((bill) => (
            <DropdownMenuItem
              key={bill.provider}
              data-test={`hosting-repeat-last-${bill.provider}`}
              onClick={() => setPending(bill)}
            >
              {providerName(bill.provider)} —{' '}
              {formatAmountCents(bill.amountCents)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Repeat last bill</AlertDialogTitle>
            <If condition={pending && preview}>
              {() => (
                <AlertDialogDescription data-test="hosting-repeat-preview">
                  Add {providerName(pending!.provider)}{' '}
                  {formatAmountCents(pending!.amountCents)} for {preview!.start}{' '}
                  – {addDaysIso(preview!.end, -1)}?
                </AlertDialogDescription>
              )}
            </If>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-test="hosting-repeat-confirm"
              disabled={isPending}
              onClick={onConfirm}
            >
              Add bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
