begin;
\ir helpers/dues_fixtures.inc
select plan(36);

select tests.make_user('fs2@example.com', 'administrator') as fs \gset
select tests.make_user('knight@example.com', 'member')    as knight \gset
select tests.make_member('200001') as m \gset
select tests.make_member('200002') as noacc \gset

-- permission: every write function is refused without finance.manage
select tests.act_as(:'knight');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date) $$, :'m'),
  '42501', 'forbidden', 'member cannot record dues');
select throws_ok(format($$ select public.void_dues_period(%L, 'nope') $$, gen_random_uuid()),
  '42501', 'forbidden', 'member cannot void a dues period');
select throws_ok(format($$ select public.set_member_accepted_on(%L, '2026-01-01') $$, :'m'),
  '42501', 'forbidden', 'member cannot set accepted_on');
select throws_ok(format($$ select public.set_member_dues_level(%L, 'regular') $$, :'m'),
  '42501', 'forbidden', 'member cannot set dues level');
select throws_ok(format($$ select public.set_member_student(%L, true) $$, :'m'),
  '42501', 'forbidden', 'member cannot set student flag');

select tests.act_as(:'fs');

-- Review Focus 3: no accepted_on, no periods
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date) $$, :'noacc'),
  'P0001', 'set the member''s acceptance date before recording dues', 'needs accepted_on first');

-- set_member_dues_level / set_member_student: happy paths and rejections
select lives_ok(format($$ select public.set_member_dues_level(%L, 'student') $$, :'noacc'), 'set dues level');
select is((select dues_level from public.member_dues_summary(array[:'noacc'::uuid])), 'student', 'dues level updated');
select lives_ok(format($$ select public.set_member_student(%L, true) $$, :'noacc'), 'set student flag');
select is((select is_student from public.member_dues_summary(array[:'noacc'::uuid])), true, 'student flag updated');
select throws_ok(format($$ select public.set_member_dues_level(%L, 'bogus_level') $$, :'noacc'),
  'P0001', 'unknown dues level: bogus_level', 'unknown level rejected');
select throws_ok(format($$ select public.set_member_dues_level(%L, 'regular') $$, gen_random_uuid()),
  'P0001', 'unknown member', 'unknown member rejected (dues level)');
select throws_ok(format($$ select public.set_member_student(%L, true) $$, gen_random_uuid()),
  'P0001', 'unknown member', 'unknown member rejected (student flag)');
select throws_ok(format($$ select public.set_member_accepted_on(%L, '2026-01-01') $$, gen_random_uuid()),
  'P0001', 'unknown member', 'unknown member rejected (accepted_on)');

-- accepted_on, first payment chains from it
select lives_ok(format($$ select public.set_member_accepted_on(%L, '2026-03-15') $$, :'m'), 'set accepted_on');
select is((select period_start from public.record_dues_payment(:'m', 'regular_contrib', 'check', '2026-03-20', '1042')),
  '2026-03-15'::date, 'first period starts at accepted_on');
select is((select amount_cents from public.member_dues_ledger(:'m') where voided_at is null order by period_start desc limit 1),
  5800, 'priced from the level');
select is((select recorded_by_email from public.member_dues_ledger(:'m') where period_start = '2026-03-15'),
  'fs2@example.com', 'recorded_by is the acting FS user');

-- late renewal chains from the old end, not the payment date. received_on is
-- just when the FS received the payment, unrelated to which period it
-- covers, so it is today's date here (record_dues_payment now rejects a
-- future received_on).
select is((select period_start from public.record_dues_payment(:'m', 'regular_contrib', 'cash', current_date)),
  '2027-03-15'::date, 'late renewal keeps the anniversary');
select is((select paid_through from public.member_dues_summary(array[:'m'::uuid])), '2028-03-14'::date, 'paid through two years (365+365 days)');

-- accepted_on locked once paid
select throws_ok(format($$ select public.set_member_accepted_on(%L, '2026-01-01') $$, :'m'),
  'P0001', 'the acceptance date cannot change once dues are recorded; void them first', 'accepted_on locked while periods exist');

-- input validation: method and received_on are required, received_on cannot
-- be in the future. These guards fire before the level/member/accepted_on
-- checks, so an otherwise-unready member (noacc) is fine to use here.
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', null, current_date) $$, :'noacc'),
  'P0001', 'the FS records only check, cash or waived dues', 'null method rejected');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', null) $$, :'noacc'),
  'P0001', 'received date is required and cannot be in the future', 'null received_on rejected');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date + 1) $$, :'noacc'),
  'P0001', 'received date is required and cannot be in the future', 'future received_on rejected');
select throws_ok(format($$ select public.record_dues_payment(%L, 'bogus_level', 'cash', current_date) $$, :'noacc'),
  'P0001', 'unknown dues level: bogus_level', 'unknown level rejected on record_dues_payment');

-- waived is $0, check needs a number
select is((select amount_cents from public.record_dues_payment(:'m', 'regular_contrib', 'waived', current_date)), 0, 'waived is $0');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'check', current_date, null) $$, :'m'),
  '23514', null, 'check requires a check number');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'online', current_date) $$, :'m'),
  'P0001', 'the FS records only check, cash or waived dues', 'online periods come only from payments');

-- level change on record updates the member
select public.record_dues_payment(:'m', 'honorary', 'cash', current_date);
select is((select dues_level from public.members where id = :'m'), 'honorary', 'recording at a new level updates the member');

-- Review Focus 6: void a middle period
select public.void_dues_period(
  (select id from public.member_dues_ledger(:'m') where period_start = '2027-03-15'), 'entered twice');
select is((select paid_through from public.member_dues_summary(array[:'m'::uuid])), '2030-03-14'::date, 'paid_through is the latest remaining active end');
select is((select void_reason from public.member_dues_ledger(:'m') where voided_at is not null),
  'entered twice', 'void_reason recorded');
select throws_ok(format($$ select public.void_dues_period((select id from public.member_dues_ledger(%L) where voided_at is not null limit 1), 'again') $$, :'m'),
  'P0001', 'dues period not found or already voided', 'cannot void twice');
select throws_ok(format($$ select public.void_dues_period((select id from public.member_dues_ledger(%L) where voided_at is null limit 1), '  ') $$, :'m'),
  'P0001', 'a reason is required to void a dues period', 'void needs a reason');

-- Review Focus 4 (M4): a check number is stored only for method = 'check'
select tests.make_member('200004') as m4 \gset
select public.set_member_accepted_on(:'m4', '2026-01-01');
select is((select check_number from public.record_dues_payment(:'m4', 'regular', 'cash', current_date, 'DECOY-1')),
  null, 'check_number ignored for cash');
select is((select check_number from public.record_dues_payment(:'m4', 'regular', 'waived', current_date, 'DECOY-2')),
  null, 'check_number ignored for waived');

-- Review Focus 2: two recordings in a row never overlap
select tests.make_member('200003') as m3 \gset
select public.set_member_accepted_on(:'m3', '2026-01-01');
select public.record_dues_payment(:'m3', 'regular', 'cash', '2026-01-02');
select public.record_dues_payment(:'m3', 'regular', 'cash', '2026-01-02');
select is((select count(*)::int from public.member_dues_ledger(:'m3') p1 join public.member_dues_ledger(:'m3') p2
           on p1.id < p2.id
           and daterange(p1.period_start, p1.period_end) && daterange(p2.period_start, p2.period_end)), 0, 'double submission chains, never overlaps');

select * from finish();
rollback;
