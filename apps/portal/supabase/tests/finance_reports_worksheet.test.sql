begin;
\ir helpers/dues_fixtures.inc
select plan(15);

select tests.make_user('frw-admin@example.com', 'administrator') as admin \gset
select tests.make_user('frw-knight@example.com', 'member') as knight \gset

select tests.make_member('FRW-ON') as on_id \gset
select tests.make_member('FRW-CH') as ch_id \gset
select tests.make_member('FRW-CA') as ca_id \gset
select tests.make_member('FRW-WV') as wv_id \gset
select tests.make_member('FRW-OB') as ob_id \gset
select tests.make_member('FRW-VD') as vd_id \gset
select tests.make_member('FRW-NX') as nx_id \gset

insert into public.dues_periods
  (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
values
  (:'on_id', 'regular', 1000, 'online', null, '2099-03-15', '2099-03-15', '2099-03-15'::date + 365),
  (:'ch_id', 'regular', 2000, 'check',  '2099', '2099-03-02', '2099-03-02', '2099-03-02'::date + 365),
  (:'ca_id', 'regular', 3000, 'cash',   null, '2099-03-28', '2099-03-28', '2099-03-28'::date + 365),
  (:'wv_id', 'regular', 0,    'waived', null, '2099-03-10', '2099-03-10', '2099-03-10'::date + 365),
  (:'ob_id', 'regular', 0,    'opening_balance', null, '2099-03-11', '2099-03-11', '2099-03-11'::date + 365),
  (:'vd_id', 'regular', 6000, 'cash',   null, '2099-03-12', '2099-03-12', '2099-03-12'::date + 365),
  (:'nx_id', 'regular', 7000, 'online', null, '2099-04-01', '2099-04-01', '2099-04-01'::date + 365);

update public.dues_periods
   set voided_at = clock_timestamp(), void_reason = 'test'
 where member_id = :'vd_id';

select kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') as w \gset

select is((:'w'::jsonb ->> 'onlineCents')::int, 1000, 'March online');
select is((:'w'::jsonb ->> 'checkCents')::int, 2000, 'March check');
select is((:'w'::jsonb ->> 'cashCents')::int, 3000, 'March cash, voided row excluded');
select is((:'w'::jsonb ->> 'receivedCents')::int, 6000, 'waiver and opening balance excluded');
select is((:'w'::jsonb ->> 'month'), '2099-03-01', 'month is the first of March');
select is((:'w'::jsonb ->> 'asOf'), '2099-06-01', 'asOf is the today argument');

select is(
  (:'w'::jsonb ->> 'roster')::int,
  (
    (:'w'::jsonb -> 'statusCounts' ->> 'current')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'due_soon')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'due')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'lapsed')::int
    + (:'w'::jsonb -> 'statusCounts' ->> 'no_record')::int
  ),
  'five status counts add up to the roster'
);

select (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') ->> 'roster')::int as roster_before \gset
select (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') -> 'statusCounts' ->> 'no_record')::int as none_before \gset
select tests.make_member('FRW-NEW') as new_id \gset
select is(
  (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') ->> 'roster')::int,
  :roster_before + 1,
  'a new member increases the roster by one'
);
select is(
  (kit.finance_monthly_worksheet_at('2099-03-01', '2099-06-01') -> 'statusCounts' ->> 'no_record')::int,
  :none_before + 1,
  'a member with no acceptance date and no period is no_record'
);

select throws_ok(
  $$select kit.finance_monthly_worksheet_at('1999-12-01', '2099-06-01')$$,
  'P0001', 'invalid worksheet month: 1999-12-01',
  'months before 2000 are refused');
select throws_ok(
  $$select kit.finance_monthly_worksheet_at('2099-07-01', '2099-06-01')$$,
  'P0001', 'invalid worksheet month: 2099-07-01',
  'a month after today is refused');
select throws_ok(
  $$select kit.finance_monthly_worksheet_at('2099-03-15', '2099-06-01')$$,
  'P0001', 'invalid worksheet month: 2099-03-15',
  'a date that is not the first of a month is refused');
select lives_ok(
  $$select kit.finance_monthly_worksheet_at('2099-06-01', '2099-06-15')$$,
  'the current month is allowed');

select tests.act_as(:'knight');
select throws_ok(
  $$select public.finance_monthly_worksheet('2099-03-01')$$,
  '42501', 'forbidden',
  'a member cannot read the worksheet');

select tests.act_as(:'admin');
select lives_ok(
  $$select public.finance_monthly_worksheet(date_trunc('month', kit.council_today())::date)$$,
  'an administrator can read the current month');

select * from finish();
rollback;
