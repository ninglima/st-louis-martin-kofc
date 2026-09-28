begin;
\ir helpers/dues_fixtures.inc
select plan(16);

select tests.make_user('fs2@example.com', 'administrator') as fs \gset
select tests.make_user('knight@example.com', 'member')    as knight \gset
select tests.make_member('200001') as m \gset
select tests.make_member('200002') as noacc \gset

-- permission
select tests.act_as(:'knight');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date) $$, :'m'),
  '42501', 'forbidden', 'member cannot record dues');

select tests.act_as(:'fs');

-- Review Focus 3: no accepted_on, no periods
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'cash', current_date) $$, :'noacc'),
  'P0001', 'set the member''s acceptance date before recording dues', 'needs accepted_on first');

-- accepted_on, first payment chains from it
select lives_ok(format($$ select public.set_member_accepted_on(%L, '2026-03-15') $$, :'m'), 'set accepted_on');
select is((select period_start from public.record_dues_payment(:'m', 'regular_contrib', 'check', '2026-03-20', '1042')),
  '2026-03-15'::date, 'first period starts at accepted_on');
select is((select amount_cents from public.member_dues_ledger(:'m') where voided_at is null order by period_start desc limit 1),
  5800, 'priced from the level');

-- late renewal chains from the old end, not the payment date
select is((select period_start from public.record_dues_payment(:'m', 'regular_contrib', 'cash', '2027-06-01')),
  '2027-03-15'::date, 'late renewal keeps the anniversary');
select is((select paid_through from public.member_dues_summary(array[:'m'::uuid])), '2028-03-14'::date, 'paid through two years (365+365 days)');

-- accepted_on locked once paid
select throws_ok(format($$ select public.set_member_accepted_on(%L, '2026-01-01') $$, :'m'),
  'P0001', null, 'accepted_on locked while periods exist');

-- waived is $0, check needs a number
select is((select amount_cents from public.record_dues_payment(:'m', 'regular_contrib', 'waived', '2028-03-01')), 0, 'waived is $0');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'check', current_date, null) $$, :'m'),
  '23514', null, 'check requires a check number');
select throws_ok(format($$ select public.record_dues_payment(%L, 'regular', 'online', current_date) $$, :'m'),
  'P0001', null, 'online periods come only from payments');

-- level change on record updates the member
select public.record_dues_payment(:'m', 'honorary', 'cash', '2029-03-01');
select is((select dues_level from public.members where id = :'m'), 'honorary', 'recording at a new level updates the member');

-- Review Focus 6: void a middle period
select public.void_dues_period(
  (select id from public.member_dues_ledger(:'m') where period_start = '2027-03-15'), 'entered twice');
select is((select paid_through from public.member_dues_summary(array[:'m'::uuid])), '2030-03-14'::date, 'paid_through is the latest remaining active end');
select throws_ok(format($$ select public.void_dues_period((select id from public.member_dues_ledger(%L) where voided_at is not null limit 1), 'again') $$, :'m'),
  'P0001', null, 'cannot void twice');
select throws_ok(format($$ select public.void_dues_period((select id from public.member_dues_ledger(%L) where voided_at is null limit 1), '  ') $$, :'m'),
  'P0001', null, 'void needs a reason');

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
