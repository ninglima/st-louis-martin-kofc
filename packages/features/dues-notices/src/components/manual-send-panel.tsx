'use client';

import { useMemo, useState, useTransition } from 'react';

import { toast } from 'sonner';

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
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';

import { sendManualNoticesAction } from '../server/notice-actions';
import { KIND_LABELS } from '../tracking';
import type { ManualEligibleMember, NoticeKind } from '../types';

const KINDS = Object.keys(KIND_LABELS) as NoticeKind[];

const NO_MEMBERS: ManualEligibleMember[] = [];

export function ManualSendPanel({
  membersByKind,
  allowlistActive,
  liveReady,
}: {
  membersByKind: Record<NoticeKind, ManualEligibleMember[]>;
  allowlistActive: boolean;
  liveReady: boolean;
}) {
  const [kind, setKind] = useState<NoticeKind>('due_date');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const members = membersByKind[kind] ?? NO_MEMBERS;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const hay = [m.firstName, m.lastName, m.membershipNumber, m.email]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [members, query]);

  const selectable = filtered;

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of selectable) next.add(m.memberId);
      return next;
    });
  }

  function clearFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of filtered) next.delete(m.memberId);
      return next;
    });
  }

  function onKindChange(next: NoticeKind) {
    setKind(next);
    setSelected(new Set());
  }

  const selectedCount = [...selected].filter((id) =>
    members.some((m) => m.memberId === id),
  ).length;

  function send() {
    const memberIds = [...selected].filter((id) =>
      members.some((m) => m.memberId === id),
    );

    startTransition(async () => {
      const result = await sendManualNoticesAction({ kind, memberIds });
      setConfirmOpen(false);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.candidates === 0) {
        toast.message('No notices were claimed for the selected members.');
      } else {
        toast.success(
          `Sent ${result.sent} of ${result.candidates}` +
            (result.skipped || result.failed
              ? ` (${result.skipped} skipped, ${result.failed} failed)`
              : ''),
        );
      }

      setSelected(new Set());
    });
  }

  return (
    <Card data-test="dues-notices-manual-send">
      <CardHeader>
        <CardTitle>Send a test notice</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Claim and send a live dues notice for the selected members. Uses their
          current cycle and dues level, even if today is outside that timing
          window. Re-sending replaces any prior live notice for that timing and
          cycle (daily automatic sends still only go once).
        </p>

        {!liveReady ? (
          <p className="text-destructive text-sm" role="alert">
            Live mode must be configured before test sends work.
          </p>
        ) : null}

        {allowlistActive ? (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            EMAIL_ALLOWLIST is set: only allowlisted addresses will actually
            send; others are recorded as failed.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-notice-kind">Notice timing</Label>
            <select
              id="manual-notice-kind"
              data-test="manual-notice-kind"
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={kind}
              onChange={(e) => onKindChange(e.target.value as NoticeKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="manual-notice-search">Search members</Label>
            <Input
              id="manual-notice-search"
              data-test="manual-notice-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, membership number, or email"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-test="manual-notice-select-all"
            onClick={selectAllFiltered}
            disabled={selectable.length === 0}
          >
            Select all shown
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-test="manual-notice-clear"
            onClick={clearFiltered}
            disabled={selectedCount === 0}
          >
            Clear shown
          </Button>
        </div>

        <div
          className="max-h-72 overflow-y-auto rounded-md border"
          data-test="manual-notice-member-list"
        >
          {filtered.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">
              No eligible members match.
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((m) => {
                const checked = selected.has(m.memberId);

                return (
                  <li
                    key={m.memberId}
                    className="flex items-start gap-3 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      data-test={`manual-notice-member-${m.membershipNumber}`}
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggle(m.memberId, value === true)
                      }
                      aria-label={`Select ${m.firstName} ${m.lastName}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {m.lastName}, {m.firstName}{' '}
                        <span className="text-muted-foreground font-normal">
                          #{m.membershipNumber}
                        </span>
                      </div>
                      <div className="text-muted-foreground truncate">
                        {m.email}
                        {m.alreadySent
                          ? ' · previously sent (re-send replaces it)'
                          : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Button
          type="button"
          data-test="manual-notice-send"
          disabled={!liveReady || selectedCount === 0 || isPending}
          onClick={() => setConfirmOpen(true)}
        >
          Send to {selectedCount} member{selectedCount === 1 ? '' : 's'}
        </Button>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send real dues notices?</AlertDialogTitle>
              <AlertDialogDescription>
                This sends {selectedCount} {KIND_LABELS[kind].toLowerCase()}{' '}
                notice{selectedCount === 1 ? '' : 's'} through Resend. Any prior
                live notice for the same timing and cycle is replaced.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-test="manual-notice-confirm"
                disabled={isPending}
                onClick={send}
              >
                Send emails
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
