import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { formatDay, formatTimeRange } from '../lib/format';
import { CATEGORY_LABELS, type VolunteerReport } from '../types';
import { ExportReportButton } from './export-report-button';

export function VolunteerReportView({ report }: { report: VolunteerReport }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Hours</CardTitle>
          </CardHeader>
          <CardContent
            data-test="report-total-hours"
            className="text-3xl font-semibold"
          >
            {report.totals.hours}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Volunteers</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {report.totals.volunteers}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Events held</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {report.totals.events}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-2" data-test="report-by-category">
        <h2 className="font-heading font-semibold">By program category</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Volunteers</TableHead>
              <TableHead>Events</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.byCategory.map((c) => (
              <TableRow key={c.category}>
                <TableCell>{CATEGORY_LABELS[c.category]}</TableCell>
                <TableCell>{c.hours}</TableCell>
                <TableCell>{c.volunteers}</TableCell>
                <TableCell>{c.events}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" data-test="report-by-type">
        <h2 className="font-heading font-semibold">By event type</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Volunteers</TableHead>
              <TableHead>Events</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.byType.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No confirmed hours this year.
                </TableCell>
              </TableRow>
            ) : (
              report.byType.map((t) => (
                <TableRow key={t.typeId}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell>{CATEGORY_LABELS[t.category]}</TableCell>
                  <TableCell>{t.hours}</TableCell>
                  <TableCell>{t.volunteers}</TableCell>
                  <TableCell>{t.events}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" data-test="report-by-member">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold">By member</h2>
          <ExportReportButton rows={report.byMember} year={report.year} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Member #</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.byMember.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No confirmed hours this year.
                </TableCell>
              </TableRow>
            ) : (
              report.byMember.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{m.membershipNumber}</TableCell>
                  <TableCell>{m.events}</TableCell>
                  <TableCell>{m.hours}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2" data-test="report-pending">
        <h2 className="font-heading font-semibold">Attendance not taken</h2>
        {report.pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Every past shift has its attendance.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {report.pending.map((p) => (
              <li
                key={p.shiftId}
                className="flex flex-wrap justify-between gap-2 p-3"
              >
                <Link
                  href={`/home/events/${p.eventId}`}
                  className="font-medium"
                >
                  {p.title}
                </Link>
                <span className="text-muted-foreground">
                  {formatDay(p.startsAt)} ·{' '}
                  {formatTimeRange(p.startsAt, p.endsAt)} · {p.waiting} waiting
                  · Lead: {p.leadName ?? 'none'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
