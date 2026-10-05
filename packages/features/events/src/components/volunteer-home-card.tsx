import Link from 'next/link';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { formatDay, formatTimeRange } from '../lib/format';
import type { MyVolunteering } from '../types';

export function VolunteerHomeCard({ data }: { data: MyVolunteering }) {
  if (!data.linked) return null;

  const next = data.upcoming[0];

  return (
    <Card data-test="volunteer-home-card">
      <CardHeader>
        <CardTitle>Volunteering</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p>
          Volunteer hours this year: <strong>{data.yearHours}</strong>
        </p>
        <p className="text-muted-foreground text-sm">
          {next
            ? `Next: ${next.title}, ${formatDay(next.startsAt)} · ${formatTimeRange(next.startsAt, next.endsAt)}`
            : 'No upcoming shifts.'}
        </p>
        <Button
          variant="outline"
          className="self-start"
          nativeButton={false}
          render={<Link href="/home/volunteering" />}
        >
          My volunteering
        </Button>
      </CardContent>
    </Card>
  );
}
