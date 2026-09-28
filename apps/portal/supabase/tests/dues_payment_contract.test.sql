-- The online dues money path, database side (final review I3). Feeds
-- kit.record_online_dues_period EXACTLY the payments row that
-- createPaymentAction writes (pinned field for field by
-- packages/features/payments/src/server/dues-payment-contract.test.ts), then
-- drives it the way the webhooks do (PaymentService.updatePaymentStatus: an
-- update by provider_payment_id as service_role), and reads the result back
-- the way /home/payments does (my_dues_summary / my_dues_ledger as the member).
begin;
\ir helpers/dues_fixtures.inc
select plan(12);

select tests.make_user('contract-payer@example.com', 'member') as payer \gset
select tests.make_member('310001', :'payer') as m \gset
select (now() at time zone 'America/Chicago')::date as today \gset
-- Accepted ten days ago, never paid: the first online period starts on
-- accepted_on and runs 365 days, so paid-through is today + 355 (current).
update public.members set accepted_on = :'today'::date - 10 where id = :'m';

-- Stripe: exactly PaymentService.createPayment's insert for a Regular level.
set local role service_role;
insert into public.payments
  (id, user_id, provider, provider_payment_id, amount, currency, status, payment_type, description, metadata)
values
  ('00000000-0000-0000-0000-00000000c001', :'payer', 'stripe', 'pi_contract_1', 5000, 'usd', 'pending',
   'dues', 'Annual dues — Regular', '{"dues_level": "regular"}');

-- payment_intent.succeeded -> updatePaymentStatus('pi_contract_1', 'succeeded').
update public.payments set status = 'succeeded', updated_at = now()
 where provider_payment_id = 'pi_contract_1' and status <> 'refunded';
reset role;

select tests.act_as(:'payer');
select is((select paid_through from public.my_dues_summary()), :'today'::date + 355,
  'a succeeded Stripe dues payment moves the member''s paid-through');
select is((select dues_status from public.my_dues_summary()), 'current', 'and the member is current');
select is((select count(*)::int from public.my_dues_ledger() where voided_at is null and method = 'online'), 1,
  'the member sees one online period');
select is((select amount_cents from public.my_dues_ledger()), 5000, 'priced in cents at the level price');
reset role;

-- charge.refunded (full) -> updatePaymentStatus('pi_contract_1', 'refunded').
set local role service_role;
update public.payments set status = 'refunded', updated_at = now()
 where provider_payment_id = 'pi_contract_1';
reset role;

select tests.act_as(:'payer');
select is((select paid_through from public.my_dues_summary()), null::date, 'a full refund takes the paid-through back');
select is((select dues_status from public.my_dues_summary()), 'due', 'and the member is due again');
select isnt((select voided_at from public.my_dues_ledger()), null, 'the period shows as voided');
reset role;

-- Square: createPayment stores a placeholder provider id; confirmSquarePaymentAction
-- claims the row by id, then writes the real Square id and the status.
set local role service_role;
insert into public.payments
  (id, user_id, provider, provider_payment_id, amount, currency, status, payment_type, description, metadata)
values
  ('00000000-0000-0000-0000-00000000c002', :'payer', 'square', 'sq_placeholder_c002', 5800, 'usd', 'pending',
   'dues', 'Annual dues — Regular (with voluntary contribution)', '{"dues_level": "regular_contrib"}');
update public.payments set status = 'processing', updated_at = now()
 where id = '00000000-0000-0000-0000-00000000c002' and status = 'pending';
update public.payments set provider_payment_id = 'sq_real_c002', status = 'succeeded', updated_at = now()
 where id = '00000000-0000-0000-0000-00000000c002';
reset role;

select tests.act_as(:'payer');
select is((select paid_through from public.my_dues_summary()), :'today'::date + 355,
  'a succeeded Square dues payment records a period too (chained from accepted_on after the void)');
select is((select amount_cents from public.my_dues_ledger() where voided_at is null), 5800, 'at the chosen level price');
reset role;

-- The contract's failure modes: the key renamed, or the amount in dollars.
-- Either one leaves the member without a period (the trigger only warns).
set local role service_role;
insert into public.payments
  (id, user_id, provider, provider_payment_id, amount, currency, status, payment_type, description, metadata)
values
  ('00000000-0000-0000-0000-00000000c003', :'payer', 'stripe', 'pi_contract_3', 5000, 'usd', 'pending',
   'dues', 'Annual dues — Regular', '{"duesLevel": "regular"}'),
  ('00000000-0000-0000-0000-00000000c004', :'payer', 'stripe', 'pi_contract_4', 50, 'usd', 'pending',
   'dues', 'Annual dues — Regular', '{"dues_level": "regular"}');
update public.payments set status = 'succeeded' where provider_payment_id in ('pi_contract_3', 'pi_contract_4');
reset role;

select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000c003'), 0,
  'a renamed metadata key records no period');
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000c004'), 0,
  'an amount in dollars instead of cents records no period');
select is(obj_description('kit.record_online_dues_period(uuid)'::regprocedure, 'pg_proc') like '%DUES_LEVEL_METADATA_KEY%', true,
  'the trigger function points at the shared TypeScript constant');

select * from finish();
rollback;
