begin;
\ir helpers/dues_fixtures.inc
select plan(35);

select tests.make_user('fs3@example.com', 'administrator') as fs \gset
select tests.make_user('payer@example.com', 'member') as payer \gset
select tests.make_user('orphan@example.com', 'member') as orphan \gset
select tests.make_user('noacc@example.com', 'member') as noacc_user \gset
select tests.make_member('300001', :'payer') as m \gset
update public.members set accepted_on = '2026-05-01' where id = :'m';

-- Fix round 1 (M5): exercise the trigger under the role the webhooks
-- actually use. EXECUTE on the trigger function is revoked from
-- authenticated/anon/public; the review wanted the service_role path
-- proven directly rather than relying on the superuser test session.
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a001', :'payer', 'stripe', 'pi_1', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a001';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 1, 'succeeded dues payment creates a period');
select is((select period_start from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), '2026-05-01'::date, 'online period chains from accepted_on');
-- Fix round 1 (C1): replaces the old "records the charged amount" test --
-- the amount is priced from the level server-side, never trusted from the
-- payment.
select is((select amount_cents from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 5000, 'online period is priced from the level, not the payment');
-- Fix round 1 (M2): received_on is the council's local date.
select is((select received_on from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), (now() at time zone 'America/Chicago')::date, 'received_on is the council''s local date');
-- Fix round 2 (N3): pin method and period_end too, not just period_start.
select is((select method from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 'online'::public.dues_method, 'online period method is online');
select is((select period_end from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), '2027-05-01'::date, 'online period_end is period_start plus 365 days');

-- replay: flip away and back
set local role service_role;
update public.payments set status = 'processing' where id = '00000000-0000-0000-0000-00000000a001';
update public.payments set status = 'succeeded'  where id = '00000000-0000-0000-0000-00000000a001';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), 1, 'replay creates no second period');

-- refund voids
set local role service_role;
update public.payments set status = 'refunded' where id = '00000000-0000-0000-0000-00000000a001';
reset role;
select isnt((select voided_at from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a001'), null, 'refund voids the period');

-- donations never touch the ledger
insert into public.payments (id, user_id, provider, amount, status, payment_type)
values ('00000000-0000-0000-0000-00000000a002', :'payer', 'stripe', 1234, 'pending', 'donation');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a002';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a002'), 0, 'donation creates no period');

-- Review Focus 1: payer with no member row -> status update still succeeds
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a003', :'orphan', 'stripe', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
set local role service_role;
select lives_ok($$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a003' $$,
  'unlinked payer never breaks the webhook update');
reset role;

-- Fix round 1 (M1): a payment already refunded before it ever succeeded
-- (out of band, or a race between webhook deliveries) must never spawn a
-- period.
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a004', :'payer', 'stripe', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
set local role service_role;
update public.payments set status = 'refunded'  where id = '00000000-0000-0000-0000-00000000a004';
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a004';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a004'), 0, 'a payment refunded before it ever succeeded creates no period');

-- Fix round 1 (C1): the server prices and validates the level; it never
-- trusts the client's amount or level slug.
-- Fix round 2 (N2): deactivate a level the payer is otherwise allowed to
-- buy -- regular_contrib is self_service, and it is also the payer's own
-- current dues_level -- so this case isolates the `active` predicate. If
-- `and active` were dropped from the level lookup, this payment (priced
-- exactly right, for a level the payer may otherwise pick) would still
-- succeed; only the active check being absent would let it through.
update public.dues_levels set active = false where slug = 'regular_contrib';

insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a006', :'payer', 'stripe', 5800, 'pending', 'dues', '{"dues_level":"regular_contrib"}');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a006';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a006'), 0, 'an inactive dues level creates no period');
-- Restore it: it's the default dues_level for every member created below
-- with tests.make_member (no explicit level), and those rows need it
-- active so their own checks (paid_through validation, not this one)
-- are what's actually under test.
update public.dues_levels set active = true where slug = 'regular_contrib';

insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a007', :'payer', 'stripe', 2500, 'pending', 'dues', '{"dues_level":"student"}');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a007';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a007'), 0, 'a level not allowed for a non-student member creates no period');

insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a008', :'payer', 'stripe', 1, 'pending', 'dues', '{"dues_level":"regular"}');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a008';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a008'), 0, 'a charged amount that does not match the level price creates no period');

-- An FS-assigned, non-self-service level is still allowed online, at its
-- exact price.
update public.members set dues_level = 'public_service' where id = :'m';
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a009', :'payer', 'stripe', 2000, 'pending', 'dues', '{"dues_level":"public_service"}');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a009';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a009'), 1, 'an FS-assigned non-self-service level at the right price creates a period');
select is((select level from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a009'), 'public_service', 'the recorded level is the FS-assigned one');
select is((select amount_cents from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a009'), 2000, 'the recorded amount is the level price');

-- Fix round 1 (M5): garbage metadata must never raise and must never
-- create a period.
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a010', :'payer', 'stripe', 5000, 'pending', 'dues', null);
set local role service_role;
select lives_ok($$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a010' $$,
  'null metadata never breaks the webhook update');
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a010'), 0, 'null metadata creates no period');

insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a011', :'payer', 'stripe', 5000, 'pending', 'dues', '[1,2]'::jsonb);
set local role service_role;
select lives_ok($$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a011' $$,
  'non-object metadata never breaks the webhook update');
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a011'), 0, 'non-object metadata creates no period');

insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a012', :'payer', 'stripe', 5000, 'pending', 'dues', '{"dues_level":"not_a_real_level"}');
set local role service_role;
select lives_ok($$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a012' $$,
  'unknown level in metadata never breaks the webhook update');
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a012'), 0, 'unknown level in metadata creates no period');

-- Fix round 1 (M3): a member with no accepted_on and no periods still gets
-- an online period; it starts on the date the payment was received.
select tests.make_member('300005', :'noacc_user') as noacc_member \gset
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-00000000a013', :'noacc_user', 'stripe', 5000, 'pending', 'dues', '{"dues_level":"regular"}');
set local role service_role;
update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-00000000a013';
reset role;
select is((select count(*)::int from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a013'), 1, 'no accepted_on and no periods still creates a period');
select is((select period_start from public.dues_periods where payment_id = '00000000-0000-0000-0000-00000000a013'), (now() at time zone 'America/Chicago')::date, 'no accepted_on and no periods starts on received_on');

-- opening balances: 300002 is eligible; 300003 already has an active
-- period; 999999 does not exist; 300006 names an unknown level; 300007 has
-- an invalid (non-existent calendar) paid_through date; 300008 has no
-- paid_through key at all (N3); 300009 and 300010 are the N1 cases --
-- 'infinity' and a BC date, both of which parse as a date but must never
-- create an unbounded period or abort the batch via an out-of-range
-- subtraction. (300001's only period was voided by the refund above, so it
-- would be eligible again and is left out on purpose.)
select tests.make_member('300002') as ob \gset
select tests.make_member('300003') as paid \gset
select tests.make_member('300006') as badlevel \gset
select tests.make_member('300007') as baddate \gset
select tests.make_member('300008') as nokey \gset
select tests.make_member('300009') as infdate \gset
select tests.make_member('300010') as bcdate \gset
update public.members set accepted_on = '2026-01-01' where id = :'paid';
select tests.act_as(:'fs');
select lives_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', '2026-01-02') $$, :'paid'),
  'setup: 300003 has an active period');

select public.dues_opening_balances_apply(jsonb_build_array(
    jsonb_build_object('membership_number', '300002', 'paid_through', '2027-02-01', 'dues_level', 'student'),
    jsonb_build_object('membership_number', '300003', 'paid_through', '2027-02-01'),
    jsonb_build_object('membership_number', '999999', 'paid_through', '2027-02-01'),
    jsonb_build_object('membership_number', '300006', 'paid_through', '2027-02-01', 'dues_level', 'bogus_level'),
    jsonb_build_object('membership_number', '300007', 'paid_through', '2027-02-30'),
    jsonb_build_object('membership_number', '300008'),
    jsonb_build_object('membership_number', '300009', 'paid_through', 'infinity'),
    jsonb_build_object('membership_number', '300010', 'paid_through', '4713-01-01 BC'))) as result \gset

-- Fix round 1 (I2) / Fix round 2 (N1, N3): assert the full result, not just
-- `applied`. 300002 is still the only applied row, which proves none of
-- the new bad-date cases aborted the batch; each appears in `skipped` with
-- 'invalid date', which proves none of them silently created a period.
select is((:'result')::jsonb -> 'applied', '1'::jsonb, 'applies only eligible rows');
select is((:'result')::jsonb -> 'skipped',
  '[{"membership_number":"300003","reason":"already has dues recorded"},{"membership_number":"999999","reason":"unknown membership number"},{"membership_number":"300006","reason":"unknown dues level"},{"membership_number":"300007","reason":"invalid date"},{"membership_number":"300008","reason":"invalid date"},{"membership_number":"300009","reason":"invalid date"},{"membership_number":"300010","reason":"invalid date"}]'::jsonb,
  'skipped rows carry their exact reasons');
select is((select paid_through from public.member_dues_summary(array[:'ob'::uuid])), '2027-02-01'::date, 'opening balance sets paid_through');
select is((select period_start from public.member_dues_ledger(:'ob') where method = 'opening_balance'), '2026-02-01'::date, 'opening balance period_start is paid_through minus 365 days');
select is((select method from public.member_dues_ledger(:'ob') where method = 'opening_balance'), 'opening_balance'::public.dues_method, 'opening balance method is opening_balance');
select is((select amount_cents from public.member_dues_ledger(:'ob') where method = 'opening_balance'), 0, 'opening balance amount is zero');
select is((select dues_level from public.member_dues_summary(array[:'ob'::uuid])), 'student', 'opening balance updates the member''s dues level');

-- Fix round 1 (M6): a non-array payload fails clearly.
select throws_ok($$ select public.dues_opening_balances_apply('{"not":"an array"}'::jsonb) $$,
  'P0001', 'p_rows must be a JSON array', 'non-array rows are rejected');

select tests.act_as(:'payer');
select throws_ok($$ select public.dues_opening_balances_apply('[]'::jsonb) $$, '42501', 'forbidden', 'load needs finance.manage');

select * from finish();
rollback;
