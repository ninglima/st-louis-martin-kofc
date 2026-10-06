-- Once-per-payment receipt claim + last send error for ops.
alter table public.payments
  add column if not exists receipt_sent_at timestamptz null,
  add column if not exists receipt_error text null;

comment on column public.payments.receipt_sent_at is
  'Set when a payment receipt email is claimed (dry-run or live). Prevents double-sends from confirm + webhook.';
comment on column public.payments.receipt_error is
  'Last receipt send failure (or skip reason); null after a successful live send.';
