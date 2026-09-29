'use client';

import { useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';

import { formatDay, formatTimeRange } from '../lib/format';
import { cancelSignupAction } from '../server/events-actions';
import {
  CATEGORY_LABELS,
  type MyVolunteering,
  type SignupStatus,
} from '../types';

const STATUS_LABELS: Record<SignupStatus, string> = {
  signed_up: 'Awaiting attendance',
  cancelled: 'Cancelled',
  attended: 'Attended',
  no_show: 'No-show',
};

export function MyVolunteeringView({ data }: { data: MyVolunteering }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!data.linked) {
    return (
      <p className="text-muted-foreground" data-test="volunteering-unlinked">
        Your sign-in is not linked to a council member record yet. Ask the
        Financial Secretary to link it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>This fraternal year</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-3xl font-semibold"
              data-test="volunteering-year-hours"
            >
              {data.yearHours} hours
            </p>
            <ul className="text-muted-foreground mt-2 grid grid-cols-2 text-sm">
              {data.byCategory.map((c) => (
                <li key={c.category}>
                  <span>{CATEGORY_LABELS[c.category]}</span>: {c.hours}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>All time</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-3xl font-semibold"
              data-test="volunteering-all-hours"
            >
              {data.allTimeHours} hours
            </p>
          </CardContent>
        </Card>
      </div>

      <section
        data-test="volunteering-upcoming"
        className="flex flex-col gap-2"
      >
        <h2 className="font-heading font-semibold">Upcoming</h2>
        {data.upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing scheduled.{' '}
            <Link className="underline" href="/home/events">
              Find an event
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.upcoming.map((u) => (
              <li
                key={u.signupId}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <Link
                  href={`/home/events/${u.eventId}`}
                  className="flex flex-col"
                >
                  <span className="font-medium">{u.title}</span>
                  <span className="text-muted-foreground text-sm">
                    {formatDay(u.startsAt)} ·{' '}
                    {formatTimeRange(u.startsAt, u.endsAt)}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await cancelSignupAction({
                        signupId: u.signupId,
                      });
                      if (result.success) {
                        toast.success('Your sign-up was cancelled.');
                        router.refresh();
                      } else {
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-test="volunteering-history" className="flex flex-col gap-2">
        <h2 className="font-heading font-semibold">History</h2>
        {data.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">No past events yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.history.map((h) => (
              <li
                key={h.signupId}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span className="flex flex-col">
                  <Link
                    href={`/home/events/${h.eventId}`}
                    className="font-medium"
                  >
                    {h.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {h.typeName} · {formatDay(h.startsAt)}
                  </span>
                </span>
                <span>
                  {h.eventCancelled
                    ? 'Event cancelled'
                    : STATUS_LABELS[h.status]}
                  {h.hours !== null && !h.eventCancelled
                    ? ` · ${h.hours} h`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
