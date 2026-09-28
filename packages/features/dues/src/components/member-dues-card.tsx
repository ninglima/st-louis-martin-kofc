'use client';

import { useState, useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Switch } from '@kit/ui/switch';
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
import {
  setAcceptedOnAction,
  setDuesLevelAction,
  setStudentAction,
} from '../server/dues-actions';
import type {
  DuesLedgerRow,
  DuesLevel,
  DuesMethod,
  MemberDuesSummary,
} from '../types';
import { DuesStatusBadge } from './dues-status-badge';
import { RecordPaymentForm } from './record-payment-form';
import { VoidPeriodButton } from './void-period-button';

const METHOD_LABELS: Record<DuesMethod, string> = {
  check: 'Check',
  cash: 'Cash',
  waived: 'Waived',
  online: 'Online',
  opening_balance: 'Opening balance',
};

function methodLabel(row: DuesLedgerRow): string {
  const label = METHOD_LABELS[row.method];

  return row.method === 'check' && row.checkNumber
    ? `${label} #${row.checkNumber}`
    : label;
}

/**
 * The Financial Secretary's dues card on the member detail page: the
 * member's current standing, and -- when `canManage` -- every control that
 * changes it. Read-only entirely without `canManage`: the level, the
 * student switch and the "Accepted on" input all disappear, leaving just the
 * status, the balance and the ledger.
 */
export function MemberDuesCard({
  summary,
  ledger,
  levels,
  canManage,
  memberId,
}: {
  summary: MemberDuesSummary;
  ledger: DuesLedgerRow[];
  levels: DuesLevel[];
  canManage: boolean;
  memberId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [acceptedOnDraft, setAcceptedOnDraft] = useState(
    summary.acceptedOn ?? '',
  );

  const hasActivePeriod = ledger.some((row) => row.voidedAt === null);
  const level = levels.find((l) => l.slug === summary.duesLevel);

  const onSaveAcceptedOn = () => {
    if (!acceptedOnDraft) return;

    startTransition(async () => {
      const result = await setAcceptedOnAction({
        memberId,
        acceptedOn: acceptedOnDraft,
      });

      if (result.success) {
        toast.success('Acceptance date saved.');
      } else {
        toast.error(result.error);
      }
    });
  };

  const onChangeLevel = (next: string | null) => {
    const nextLevel = levels.find((l) => l.slug === next);
    if (!nextLevel || next === null) return;

    // The brief's confirmation text names the member ("Change {name}'s
    // dues level..."), but `MemberDuesCard`'s props (as specified) carry no
    // member name -- only `summary`, `ledger`, `levels`, `canManage` and
    // `memberId`. "This member" says the same thing without a name this
    // component was never given.
    const confirmed = window.confirm(
      `Change this member's dues level to ${nextLevel.name}?`,
    );

    if (!confirmed) return;

    startTransition(async () => {
      const result = await setDuesLevelAction({ memberId, level: next });

      if (result.success) {
        toast.success('Dues level updated.');
      } else {
        toast.error(result.error);
      }
    });
  };

  const onToggleStudent = (checked: boolean) => {
    startTransition(async () => {
      const result = await setStudentAction({ memberId, isStudent: checked });

      if (result.success) {
        toast.success(
          checked ? 'Marked as a student.' : 'Student status removed.',
        );
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card data-test="dues-card">
      <CardHeader className="flex flex-col gap-y-3">
        <CardTitle>Dues</CardTitle>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* `DuesStatusBadge` (Task 4) carries `data-status`, not
              `data-test` -- it takes no extra props, so the hook the e2e
              test needs goes on a wrapper rather than on the badge itself. */}
          <span data-test="dues-status">
            <DuesStatusBadge status={summary.duesStatus} />
          </span>

          <span data-test="dues-paid-through" className="text-sm">
            Paid through {summary.paidThrough ?? '—'}
          </span>

          <span className="text-sm">
            {summary.levelName}
            {level ? ` — ${formatAmountCents(level.amountCents)}` : null}
          </span>

          <span className="text-muted-foreground text-sm">
            Accepted on {summary.acceptedOn ?? '—'}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-y-6">
        <If condition={canManage}>
          <div className="flex flex-col gap-y-4 rounded-lg border p-3">
            <If condition={!hasActivePeriod}>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="accepted-on">Accepted on</Label>
                  <Input
                    id="accepted-on"
                    type="date"
                    data-test="set-accepted-on-input"
                    value={acceptedOnDraft}
                    onChange={(event) => setAcceptedOnDraft(event.target.value)}
                  />
                </div>
                <Button
                  data-test="set-accepted-on-submit"
                  disabled={isPending || !acceptedOnDraft}
                  onClick={onSaveAcceptedOn}
                >
                  Save
                </Button>
              </div>
            </If>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="dues-level">Level</Label>
                <Select value={summary.duesLevel} onValueChange={onChangeLevel}>
                  <SelectTrigger id="dues-level" data-test="dues-level-select">
                    <SelectValue>
                      {(value: string | null) =>
                        levels.find((l) => l.slug === value)?.name ??
                        summary.levelName
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((l) => (
                      <SelectItem key={l.slug} value={l.slug}>
                        {l.name} — {formatAmountCents(l.amountCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-x-2">
                <Switch
                  id="is-student"
                  data-test="dues-student-switch"
                  checked={summary.isStudent}
                  disabled={isPending}
                  onCheckedChange={onToggleStudent}
                />
                <Label htmlFor="is-student">Student</Label>
              </div>

              <RecordPaymentForm
                memberId={memberId}
                levels={levels}
                defaultLevel={summary.duesLevel}
                paidThrough={summary.paidThrough}
                acceptedOn={summary.acceptedOn}
                trigger={
                  <Button data-test="record-payment-open">
                    Record payment
                  </Button>
                }
              />
            </div>
          </div>
        </If>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Covers</TableHead>
                <TableHead>Recorded by</TableHead>
                <If condition={canManage}>
                  <TableHead />
                </If>
              </TableRow>
            </TableHeader>

            <TableBody>
              <If condition={ledger.length === 0}>
                <TableRow data-test="dues-ledger-empty">
                  <TableCell
                    colSpan={canManage ? 7 : 6}
                    className="text-muted-foreground"
                  >
                    No dues recorded yet.
                  </TableCell>
                </TableRow>
              </If>

              {ledger.map((row) => {
                const voided = row.voidedAt !== null;

                return (
                  <TableRow key={row.id} data-test="ledger-row">
                    <TableCell className={cn(voided && 'line-through')}>
                      {row.receivedOn}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {row.levelName}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {methodLabel(row)}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {formatAmountCents(row.amountCents)}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {row.periodStart} → {row.periodEnd}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {row.recordedByEmail ?? '—'}
                    </TableCell>
                    <If condition={canManage}>
                      <TableCell>
                        <If
                          condition={!voided}
                          fallback={
                            <span
                              className="text-muted-foreground text-xs"
                              data-test="void-reason"
                            >
                              {row.voidReason}
                            </span>
                          }
                        >
                          <VoidPeriodButton periodId={row.id} />
                        </If>
                      </TableCell>
                    </If>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
