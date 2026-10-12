import Link from 'next/link';

import { formatAmountCents } from '@kit/dues/lib/format-amount';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Label } from '@kit/ui/label';

import { worksheetMonthLabel } from '../lib/worksheet-month';
import type { MonthlyWorksheet, PaymentPacket } from '../types';
import { PaymentPacketForm } from './payment-packet-form';
import { EmailPacketForm, EmailWorksheetForm } from './report-email-form';

const STATUS_LABELS = [
  ['current', 'Current'],
  ['due_soon', 'Due soon'],
  ['due', 'Due'],
  ['lapsed', 'Lapsed'],
  ['no_record', 'No record'],
] as const;

function amountOrBlank(cents: number | null): string {
  return cents === null ? 'blank' : formatAmountCents(cents);
}

export function ReportsScreen({
  worksheet,
  packets,
  month,
  monthOptions,
  emailBlocker,
  editing,
}: {
  worksheet: MonthlyWorksheet;
  packets: PaymentPacket[];
  month: string;
  monthOptions: string[];
  emailBlocker: string | null;
  editing: PaymentPacket | null;
}) {
  const monthLabel = worksheetMonthLabel(month);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Monthly worksheet</h2>

        <form method="get" className="flex items-end gap-2">
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="worksheet-month">Month</Label>
            <select
              key={month}
              id="worksheet-month"
              name="month"
              data-test="worksheet-month"
              defaultValue={month}
              className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
            >
              {monthOptions.map((option) => (
                <option key={option} value={option}>
                  {worksheetMonthLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            variant="outline"
            data-test="worksheet-month-show"
          >
            Show
          </Button>
        </form>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-test="worksheet-roster">
            <CardHeader>
              <CardTitle>Roster, as of {worksheet.asOf}</CardTitle>
              <CardDescription>{monthLabel}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-2xl font-semibold">Total {worksheet.roster}</p>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {STATUS_LABELS.map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>{worksheet.statusCounts[key]}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card data-test="worksheet-received">
            <CardHeader>
              <CardTitle>Dues received</CardTitle>
              <CardDescription>{monthLabel}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="text-2xl font-semibold">
                Total {formatAmountCents(worksheet.receivedCents)}
              </p>
              <p>Card {formatAmountCents(worksheet.onlineCents)}</p>
              <p>Check {formatAmountCents(worksheet.checkCents)}</p>
              <p>Cash {formatAmountCents(worksheet.cashCents)}</p>
            </CardContent>
          </Card>
        </div>

        <EmailWorksheetForm month={month} emailBlocker={emailBlocker} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Payment packets</h2>
          {editing ? (
            <Link
              href={`?month=${month}`}
              className="text-sm underline underline-offset-2"
            >
              Cancel
            </Link>
          ) : null}
        </div>

        {emailBlocker ? (
          <p className="text-muted-foreground text-sm">{emailBlocker}</p>
        ) : null}

        {packets.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No payment packets yet.
          </p>
        ) : (
          <ul className="divide-y">
            {packets.map((packet) => (
              <li
                key={packet.id}
                data-test="payment-packet-row"
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{packet.label}</p>
                  <p className="text-muted-foreground text-sm">
                    Supreme {amountOrBlank(packet.supremeCents)} · State{' '}
                    {amountOrBlank(packet.stateCents)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`?month=${month}&packet=${packet.id}`}
                    className="text-sm underline underline-offset-2"
                  >
                    Edit
                  </Link>
                  <EmailPacketForm id={packet.id} emailBlocker={emailBlocker} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-base font-medium">
          {editing ? 'Edit packet' : 'New packet'}
        </h3>
        <PaymentPacketForm
          key={editing ? `${editing.id}:${editing.updatedAt}` : 'new'}
          editing={editing}
          month={month}
        />
      </section>
    </div>
  );
}
