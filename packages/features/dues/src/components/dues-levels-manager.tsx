'use client';

import { useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import { formatAmountCents } from '../lib/format-amount';
import { restoreDuesLevelAction } from '../server/dues-level-actions';
import type { AdminDuesLevel } from '../types';
import { DuesLevelFormDialog } from './dues-level-form-dialog';
import { RetireDuesLevelDialog } from './retire-dues-level-dialog';

function lastChanged(level: AdminDuesLevel): string {
  if (!level.changedAt) return '—';

  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(level.changedAt));

  return level.changedByEmail ? `${level.changedByEmail}, ${day}` : day;
}

function RestoreButton({ level }: { level: AdminDuesLevel }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      data-test="restore-dues-level"
      aria-label={`Restore ${level.name}`}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreDuesLevelAction({ slug: level.slug });

          if (result.success) {
            toast.success(`${level.name} restored.`);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      Restore
    </Button>
  );
}

/**
 * Settings → Dues levels: every level, retired ones last and muted. Prices
 * live only here (in `dues_levels`); checkout charges them directly, so
 * there is nothing to change in Stripe or Square.
 */
export function DuesLevelsManager({ levels }: { levels: AdminDuesLevel[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Price changes apply to payments made from then on. Retiring a level
          moves its members to another level and keeps their recorded dues.
        </p>
        <DuesLevelFormDialog level={null} />
      </div>

      <div className="rounded-lg border">
        <Table data-test="dues-levels-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Members choose it</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last changed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {levels.map((level) => (
              <TableRow
                key={level.slug}
                data-test="dues-level-row"
                data-slug={level.slug}
                className={cn(!level.active && 'text-muted-foreground')}
              >
                <TableCell>{level.name}</TableCell>
                <TableCell>{formatAmountCents(level.amountCents)}</TableCell>
                <TableCell>{level.selfService ? 'Yes' : 'No'}</TableCell>
                <TableCell>{level.sortOrder}</TableCell>
                <TableCell>{level.memberCount}</TableCell>
                <TableCell data-test="dues-level-status">
                  {level.active ? 'Active' : 'Retired'}
                </TableCell>
                <TableCell>{lastChanged(level)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <DuesLevelFormDialog level={level} />
                    {level.active ? (
                      <RetireDuesLevelDialog level={level} levels={levels} />
                    ) : (
                      <RestoreButton level={level} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
