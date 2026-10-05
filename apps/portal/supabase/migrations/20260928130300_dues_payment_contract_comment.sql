-- Documents the online dues payment contract on the trigger function itself,
-- so a reader of the database finds the TypeScript side of it. Comment only;
-- no behaviour change.
comment on function kit.record_online_dues_period(uuid) is
  'Turns a succeeded dues payment into a dues_periods row. Contract with the app: '
  'payments.metadata carries the level under the top-level key ''dues_level'' '
  '(DUES_LEVEL_METADATA_KEY in packages/features/dues/src/lib/payment-metadata.ts, '
  'written by createPaymentAction/priceDues), and payments.amount is the level price '
  'in integer cents, compared to dues_levels.amount_cents. Renaming the key or '
  'changing the unit needs a new migration here in the same change. Pinned by '
  'supabase/tests/dues_payment_contract.test.sql and '
  '@kit/payments dues-payment-contract.test.ts.';
