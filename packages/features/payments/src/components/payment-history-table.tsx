'use client';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Badge } from '@kit/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Trans } from '@kit/ui/trans';

import type { Payment, PaymentStatus } from '../types/payment.types';
import type { Payer } from '../lib/payers';

const statusVariants: Record<PaymentStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  processing: 'secondary',
  succeeded: 'default',
  failed: 'destructive',
  refunded: 'secondary',
  cancelled: 'destructive',
};

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateString));
}

export function PaymentHistoryTable({
  payments,
  showMember,
  payers,
  linkMembers,
}: {
  payments: Payment[];
  showMember?: boolean;
  /** Keyed by the payment's `user_id`; see `PaymentService.getPayers`. */
  payers?: Record<string, Payer>;
  /** `members.view`: the name links to the member's page. */
  linkMembers?: boolean;
}) {
  const t = useTranslations('payments');

  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Trans i18nKey="payments.noPayments" />
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans i18nKey="payments.date" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="payments.description" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="payments.type" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="payments.amount" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="payments.status" />
          </TableHead>
          <TableHead>
            <Trans i18nKey="payments.provider" />
          </TableHead>
          {showMember && (
            <TableHead>
              <Trans i18nKey="payments.member" />
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment.id}>
            <TableCell className="whitespace-nowrap">
              {formatDate(payment.created_at)}
            </TableCell>
            <TableCell>
              {payment.description ?? '—'}
            </TableCell>
            <TableCell>
              {t(`types.${payment.payment_type.replace('_', '')}`)}
            </TableCell>
            <TableCell className="font-medium">
              {formatAmount(payment.amount, payment.currency)}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariants[payment.status]}>
                {t(`statuses.${payment.status}`)}
              </Badge>
            </TableCell>
            <TableCell className="capitalize">
              {payment.provider}
            </TableCell>
            {showMember && (
              <TableCell data-test="payment-member">
                <PayerName
                  payer={payers?.[payment.user_id]}
                  linkMembers={linkMembers}
                />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PayerName({
  payer,
  linkMembers,
}: {
  payer: Payer | undefined;
  linkMembers?: boolean;
}) {
  if (!payer) return <span className="text-muted-foreground">—</span>;

  if (payer.memberId && linkMembers) {
    return (
      <Link
        href={`/home/members/${payer.memberId}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {payer.name}
      </Link>
    );
  }

  return <span>{payer.name}</span>;
}
