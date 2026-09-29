'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { cancelEventAction } from '../server/events-actions';

export function CancelEventButtons({
  eventId,
  inSeries,
}: {
  eventId: string;
  inSeries: boolean;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  const cancel = (scope: 'this' | 'following') =>
    start(async () => {
      const result = await cancelEventAction({ eventId, scope });
      if (result.success) {
        toast.success('Event cancelled.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  if (!armed) {
    return (
      <Button
        variant="outline"
        data-test="event-cancel"
        onClick={() => setArmed(true)}
      >
        Cancel event
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="destructive"
        disabled={pending}
        data-test="event-cancel-confirm"
        onClick={() => cancel('this')}
      >
        Cancel this event
      </Button>
      {inSeries ? (
        <Button
          variant="destructive"
          disabled={pending}
          data-test="event-cancel-following"
          onClick={() => cancel('following')}
        >
          Cancel this and all later
        </Button>
      ) : null}
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Keep it
      </Button>
    </>
  );
}
