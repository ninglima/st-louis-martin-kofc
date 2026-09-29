'use client';

import { useState, useTransition } from 'react';

import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Label } from '@kit/ui/label';
import { Switch } from '@kit/ui/switch';

import { setDuesNoticesOptOutAction } from '../server/notice-actions';
import { KIND_LABELS } from '../tracking';
import type { MemberNoticeHistoryRow } from '../types';
import { TrackingBadge } from './tracking-badge';

export function MemberNoticesCard({
  memberId,
  history,
  optOut,
  canManage,
}: {
  memberId: string;
  history: MemberNoticeHistoryRow[];
  optOut: boolean;
  canManage: boolean;
}) {
  // Bound to the server-sent `optOut` while idle, and set optimistically on
  // toggle so the switch moves right away -- reverted if the action fails.
  const [checked, setChecked] = useState(optOut);
  const [isPending, startTransition] = useTransition();

  const onToggle = (next: boolean) => {
    setChecked(next);

    startTransition(async () => {
      const result = await setDuesNoticesOptOutAction({
        memberId,
        optOut: next,
      });

      if (result.success) {
        toast.success(
          next
            ? 'Automatic dues notices turned off.'
            : 'Automatic dues notices turned on.',
        );
      } else {
        setChecked(!next);
        toast.error(result.error);
      }
    });
  };

  return (
    <Card data-test="member-notices">
      <CardHeader>
        <CardTitle>Dues notices</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-4">
        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">No dues notices sent.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {history.map((notice) => (
              <li key={notice.id} className="flex flex-wrap items-center gap-2">
                <span>{KIND_LABELS[notice.kind]}</span>
                <span className="text-muted-foreground">
                  {notice.sentAt.slice(0, 10)}
                </span>
                <TrackingBadge tracking={notice.tracking} />
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="flex items-center gap-x-2">
            <Switch
              id="notices-opt-out"
              data-test="member-notices-opt-out"
              checked={checked}
              disabled={isPending}
              onCheckedChange={onToggle}
            />
            <Label htmlFor="notices-opt-out">No automatic dues notices</Label>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Automatic notices: {optOut ? 'off' : 'on'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
