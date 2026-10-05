'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { formatTimeRange } from '../lib/format';
import { cancelSignupAction, signupAction } from '../server/events-actions';
import type { EventDetail } from '../types';

export function ShiftList({ event }: { event: EventDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const now = Date.now();

  const run = (
    fn: () => Promise<{ success: boolean; error?: string }>,
    done: string,
  ) =>
    start(async () => {
      const result = await fn();
      if (result.success) {
        toast.success(done);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <ul className="flex flex-col gap-3">
      {event.shifts.map((shift) => {
        const mine = shift.signups.find(
          (s) => s.memberId === event.myMemberId && s.status === 'signed_up',
        );
        const started = new Date(shift.startsAt).getTime() <= now;
        const full = shift.filled >= shift.capacity;
        const open = event.status === 'scheduled' && !started;

        return (
          <li
            key={shift.id}
            className="rounded-lg border p-3"
            data-test={`shift-${shift.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">
                  {formatTimeRange(shift.startsAt, shift.endsAt)}
                  {shift.label ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · {shift.label}
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground text-sm">
                  {shift.filled} of {shift.capacity} volunteers
                </div>
              </div>
              {event.myMemberId && open ? (
                mine ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    data-test={`shift-cancel-${shift.id}`}
                    onClick={() =>
                      run(
                        () => cancelSignupAction({ signupId: mine.id }),
                        'Your sign-up was cancelled.',
                      )
                    }
                  >
                    Cancel my sign-up
                  </Button>
                ) : full ? (
                  <Badge variant="outline" data-test={`shift-full-${shift.id}`}>
                    Full
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={pending}
                    data-test={`shift-signup-${shift.id}`}
                    onClick={() =>
                      run(
                        () => signupAction({ shiftId: shift.id }),
                        'You are signed up.',
                      )
                    }
                  >
                    Sign up
                  </Button>
                )
              ) : null}
            </div>
            {shift.signups.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {shift.signups.map((s) => (
                  <li key={s.id}>
                    <Badge
                      variant={
                        s.memberId === event.myMemberId
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {s.name}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
