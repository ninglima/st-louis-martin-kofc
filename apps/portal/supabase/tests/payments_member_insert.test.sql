-- 20260928130000_payments_no_member_insert: a signed-in member cannot create
-- a payments (or payment_items) row directly. Only the service-role path
-- (PaymentService.createPayment behind createPaymentAction) can.
begin;
\ir helpers/dues_fixtures.inc
select plan(9);

select tests.make_user('direct-insert@example.com', 'member') as payer \gset

select ok(not has_table_privilege('authenticated', 'public.payments', 'insert'), 'authenticated has no insert on payments');
select ok(not has_table_privilege('anon', 'public.payments', 'insert'), 'anon has no insert on payments');
select ok(not has_table_privilege('authenticated', 'public.payment_items', 'insert'), 'authenticated has no insert on payment_items');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('payments', 'payment_items') and cmd = 'INSERT'),
  'no insert policies remain on payments or payment_items');
select ok(has_table_privilege('authenticated', 'public.payments', 'select'), 'members can still read payments (their own, via RLS)');

-- The review's exact vector: a 1-cent pending donation, owned by the caller.
select tests.act_as(:'payer');
select throws_ok(
  format($$ insert into public.payments (user_id, provider, amount, status, payment_type)
            values (%L, 'square', 1, 'pending', 'donation') $$, :'payer'),
  '42501', null, 'a member cannot insert a pending 1-cent donation directly');
select throws_ok(
  format($$ insert into public.payments (user_id, provider, amount, status, payment_type, metadata)
            values (%L, 'square', 5000, 'pending', 'dues', '{"dues_level":"regular"}') $$, :'payer'),
  '42501', null, 'a member cannot insert a dues row directly either');

-- The service-role writer is unaffected.
reset role;
set local role service_role;
select lives_ok(
  format($$ insert into public.payments (id, user_id, provider, amount, status, payment_type)
            values ('00000000-0000-0000-0000-00000000b001', %L, 'square', 2500, 'pending', 'donation') $$, :'payer'),
  'service_role still inserts payments');
select lives_ok(
  $$ insert into public.payment_items (payment_id, item_type, description, amount)
     values ('00000000-0000-0000-0000-00000000b001', 'donation', 'Building fund', 2500) $$,
  'service_role still inserts payment_items');
reset role;

select * from finish();
rollback;
