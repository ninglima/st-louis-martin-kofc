begin;
\ir helpers/dues_fixtures.inc
select plan(11);

select tests.make_user('fs3@example.com', 'administrator') as fs \gset
select tests.make_user('payer@example.com', 'member') as payer \gset
select tests.make_user('orphan@example.com', 'member') as orphan \gset
select tests.make_member('300001', :'payer') as m \gset
update public.members set accepted_on = '2026-05-01' where id = :'m';

-- a pending online dues payment, then succeeded (as the webhook would, service role)
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a001', :'payer', 'stripe', 'pi_1', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a001';
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 1, 'succeeded dues payment creates a period');
select is((select period_start from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), '2026-05-01'::date, 'online period chains from accepted_on');
select is((select amount_cents from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 5000, 'online period records the charged amount');

-- replay: flip away and back
update public.payments set status = 'processing' where id = '00000000-0000-0000-0000-00000000a001';
update public.payments set status = 'succeeded'  where id = '00000000-0000-0000-0000-00000000a001';
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 1, 'replay creates no second period');

-- refund voids
update public.payments set status = 'refunded' where id = '00000000-0000-0000-0000-00000000a001';
select isnt((select voided_at from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), null, 'refund voids the period');

-- donations never touch the ledger
insert into public.payments (id, user_id, provider, amount, status, payment_type)
values ('00000000-0000-0000-0000-00000000a002', :'payer', 'stripe', 1234, 'pending', 'donation');
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a002';
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a002'), 0, 'donation creates no period');

-- Review Focus 1: payer with no member row -> status update still succeeds
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a003', :'orphan', 'stripe', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
select lives_ok($$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a003' $$,
  'unlinked payer never breaks the webhook update');

-- opening balances: 300002 is eligible; 300003 already has an active period;
-- 999999 does not exist. (300001's only period was voided by the refund
-- above, so it would be eligible again and is left out on purpose.)
select tests.make_member('300002') as ob \gset
select tests.make_member('300003') as paid \gset
update public.members set accepted_on = '2026-01-01' where id = :'paid';
select tests.act_as(:'fs');
select lives_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', '2026-01-02') $$, :'paid'),
  'setup: 300003 has an active period');
select is(
  public.dues_opening_balances_apply(jsonb_build_array(
    jsonb_build_object('membership_number', '300002', 'paid_through', '2027-02-01', 'dues_level', 'student'),
    jsonb_build_object('membership_number', '300003', 'paid_through', '2027-02-01'),
    jsonb_build_object('membership_number', '999999', 'paid_through', '2027-02-01'))) -> 'applied',
  '1'::jsonb, 'applies only eligible rows');
-- read via public.member_dues_summary (still acting as fs), rather than the
-- ungranted kit.dues_paid_through: public.dues_periods and the kit helpers
-- have no grants to any role and are unreachable now that act_as() has done
-- a real SET ROLE authenticated.
select is((select paid_through from public.member_dues_summary(array[:'ob'::uuid])), '2027-02-01'::date, 'opening balance sets paid_through');
select tests.act_as(:'payer');
select throws_ok($$ select public.dues_opening_balances_apply('[]'::jsonb) $$, '42501', 'forbidden', 'load needs finance.manage');

select * from finish();
rollback;
