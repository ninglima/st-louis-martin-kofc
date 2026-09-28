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
import { If } from '@kit/ui/if';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { addDaysIso } from '../lib/dates';
import { deleteHostingCostAction } from '../server/hosting-actions';
import type { HostingCost, HostingProvider, LatestBill } from '../types';
import { HostingCostFormDialog } from './hosting-cost-form-dialog';
import { RepeatLastBill } from './repeat-last-bill';

function coversLabel(cost: HostingCost): string {
  return `${cost.periodStart} – ${addDaysIso(cost.periodEnd, -1)}`;
}

export function HostingCostsTable({
  costs,
  providers,
  latest,
  canManage,
}: {
  costs: HostingCost[];
  providers: HostingProvider[];
  latest: LatestBill[];
  canManage: boolean;
}) {
  const [deleting, setDeleting] = useState<HostingCost | null>(null);
  const [isPending, startTransition] = useTransition();

  const onDelete = () => {
    const cost = deleting;
    if (!cost) return;

    startTransition(async () => {
      const result = await deleteHostingCostAction({ id: cost.id });

      if (result.success) {
        toast.success('Hosting cost deleted');
        setDeleting(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-y-4">
      <If condition={canManage}>
        <div className="flex items-center gap-x-2">
          <HostingCostFormDialog
            providers={providers}
            trigger={<Button data-test="hosting-cost-add">Add bill</Button>}
          />
          <RepeatLastBill providers={providers} latest={latest} />
        </div>
      </If>

      <If condition={costs.length === 0}>
        <p data-test="hosting-costs-empty" className="text-muted-foreground">
          No hosting costs recorded for this year.
        </p>
      </If>

      <If condition={costs.length > 0}>
        <div className="rounded-lg border">
          <Table data-test="hosting-costs-table">
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Paid on</TableHead>
                <TableHead>Covers</TableHead>
                <TableHead>Note</TableHead>
                <If condition={canManage}>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </If>
              </TableRow>
            </TableHeader>

            <TableBody>
              {costs.map((cost) => {
                const covers = coversLabel(cost);

                return (
                  <TableRow key={cost.id} data-test="hosting-cost-row">
                    <TableCell>{cost.providerName}</TableCell>
                    <TableCell>{formatAmountCents(cost.amountCents)}</TableCell>
                    <TableCell>{cost.paidOn}</TableCell>
                    <TableCell>{covers}</TableCell>
                    <TableCell>{cost.note ?? '—'}</TableCell>
                    <If condition={canManage}>
                      <TableCell>
                        <div className="flex gap-x-2">
                          <HostingCostFormDialog
                            providers={providers}
                            cost={cost}
                            trigger={
                              <Button
                                variant="outline"
                                size="sm"
                                data-test="hosting-cost-edit"
                                aria-label={`Edit ${cost.providerName} bill ${covers}`}
                              >
                                Edit
                              </Button>
                            }
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            data-test="hosting-cost-delete"
                            aria-label={`Delete ${cost.providerName} bill ${covers}`}
                            onClick={() => setDeleting(cost)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </If>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </If>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete hosting bill</AlertDialogTitle>
            <If condition={deleting}>
              {(cost) => (
                <AlertDialogDescription>
                  Delete the {cost.providerName} bill of{' '}
                  {formatAmountCents(cost.amountCents)}?
                </AlertDialogDescription>
              )}
            </If>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-test="hosting-cost-delete-confirm"
              disabled={isPending}
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
