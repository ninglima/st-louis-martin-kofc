'use client';

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
}: {
  payments: Payment[];
  showMember?: boolean;
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
              <TableCell>
                {payment.user_id.slice(0, 8)}...
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
