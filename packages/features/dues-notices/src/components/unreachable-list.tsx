import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import type { Unreachable } from '../types';

const REASON_LABELS: Record<Unreachable['reason'], string> = {
  no_email: 'No email address',
  bounced: 'Last notice bounced',
  complained: 'Marked as spam',
};

export function UnreachableList({
  rows,
  canOpenMembers,
}: {
  rows: Unreachable[];
  canOpenMembers: boolean;
}) {
  return (
    <Card data-test="dues-notices-unreachable">
      <CardHeader>
        <CardTitle>Could not notify</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Everyone due a notice can be reached by email.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map((row) => {
              const name = `${row.firstName} ${row.lastName}`;

              return (
                <li
                  key={row.memberId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="font-medium">
                    {canOpenMembers ? (
                      <Link href={`/home/members/${row.memberId}`}>{name}</Link>
                    ) : (
                      name
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    #{row.membershipNumber}
                  </span>
                  <span className="text-muted-foreground">
                    — {REASON_LABELS[row.reason]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
