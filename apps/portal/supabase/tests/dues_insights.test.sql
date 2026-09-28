begin;
\ir helpers/dues_fixtures.inc
select plan(43);

select tests.make_user('di-admin@example.com', 'administrator') as admin \gset
select tests.make_user('di-knight@example.com', 'member') as knight \gset

-- helper: a period ending on p_end (start = p_end - 365), as the superuser
create or replace function tests.di_period(p_member uuid, p_end date, p_received date,
  p_method public.dues_method default 'check', p_amount integer default 5000, p_level text default 'regular')
returns void language sql as $$
  insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
  values (p_member, p_level, case when p_method in ('waived','opening_balance') then 0 else p_amount end, p_method,
          case when p_method = 'check' then '1' end, p_received, p_end - 365, p_end);
$$;

------------------------------------------------------------------ collection progress (FY2040)
select kit.collection_progress_at(2040, '2040-10-15') as cbase \gset

select tests.make_member('DI-C1') as c1 \gset
select tests.make_member('DI-C2') as c2 \gset
select tests.make_member('DI-C3') as c3 \gset
select tests.make_member('DI-C4') as c4 \gset
select tests.make_member('DI-C5') as c5 \gset
select tests.make_member('DI-C6') as c6 \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'c3', 'honorary');
select public.set_member_accepted_on(:'c4', '2040-08-01');
select public.set_member_accepted_on(:'c5', '2040-09-01');
select tests.act_as_service();
-- c1: ends 2040-08-31 (FY2040), renewed by check received 2040-08-20
select tests.di_period(:'c1', '2040-08-31', '2039-09-01', 'waived');
insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
values (:'c1', 'regular', 5000, 'check', '2', '2040-08-20', '2040-08-31', '2040-08-31'::date + 365);
-- c2: ends 2041-03-01 (FY2040), not renewed
select tests.di_period(:'c2', '2041-03-01', '2040-03-01', 'waived');
-- c3 (honorary): ends 2040-08-14, renewed with cash 1900 on 2040-09-10
select tests.di_period(:'c3', '2040-08-14', '2039-08-14', 'waived');
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'c3', 'honorary', 1900, 'cash', '2040-09-10', '2040-08-14', '2040-08-14'::date + 365);
-- c4: first dues, paid online 5800 on 2040-08-05
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'c4', 'regular_contrib', 5800, 'online', '2040-08-05', '2040-08-01', '2040-08-01'::date + 365);
-- c5: first dues, unpaid
-- c6: ends 2040-08-10; renews on time, but the renewal is voided (M5: a voided renewal is not a renewal)
select tests.di_period(:'c6', '2040-08-10', '2039-08-10', 'waived');
insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
values (:'c6', 'regular', 5000, 'check', '3', '2040-08-15', '2040-08-10', '2040-08-10'::date + 365);
update public.dues_periods set voided_at = now(), void_reason = 'test'
 where member_id = :'c6' and period_start = '2040-08-10';

-- 1-7
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'expected')::int
          - (:'cbase'::jsonb ->> 'expected')::int, 5, 'expected: c1, c2, c4, c5, c6 (honorary left out)');
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'renewed')::int
          - (:'cbase'::jsonb ->> 'renewed')::int, 2, 'renewed: c1 (next period) and c4 (first dues paid); c6''s voided renewal does not count');
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'expectedCents')::int
          - (:'cbase'::jsonb ->> 'expectedCents')::int, 29000, 'expected dollars: 5 x 5800 at the default level');
select is((kit.collection_progress_at(2040, '2040-10-15') ->> 'collectedCents')::int, 12700,
          'collected: 5000 + 5800 + honorary 1900 received in FY2040 (c6''s voided payment does not count)');
select is((select (e ->> 'cumulativeCents')::int
             from jsonb_array_elements(kit.collection_progress_at(2040, '2040-10-15') -> 'byMonth') e
            where e ->> 'month' = '2040-09-01'), 12700, 'running total through September');
select is((select (e ->> 'cumulativeCents')::int
             from jsonb_array_elements(kit.collection_progress_at(2040, '2040-10-15') -> 'byMonth') e
            where e ->> 'month' = '2040-10-01'), 12700, 'the current month itself is not blank (M5)');
select is((select e ->> 'cumulativeCents'
             from jsonb_array_elements(kit.collection_progress_at(2040, '2040-10-15') -> 'byMonth') e
            where e ->> 'month' = '2040-11-01'), null::text, 'months after today are blank in the current year');

------------------------------------------------------------------ coming due (from 2040-10-15)
select tests.make_member('DI-F1') as f1 \gset
select tests.make_member('DI-F2') as f2 \gset
select tests.make_member('DI-F3') as f3 \gset
select tests.make_member('DI-F4') as f4 \gset
select tests.di_period(:'f1', '2040-10-20', '2039-10-20', 'waived');
select tests.di_period(:'f2', '2040-10-10', '2039-10-10', 'waived');
select tests.di_period(:'f3', '2041-09-30', '2040-09-30', 'waived');
select tests.di_period(:'f4', '2041-10-01', '2040-10-01', 'waived');

-- 8-12
select is((select count(*)::int from kit.renewals_forecast_at('2040-10-15')), 12, 'twelve months');
select results_eq($$select min(month), max(month) from kit.renewals_forecast_at('2040-10-15')$$,
                  $$values ('2040-10-01'::date, '2041-09-01'::date)$$, 'from this month through eleven months on');
select is((select array_agg(membership_number order by membership_number) from kit.forecast_members_at('2040-10-01', '2040-10-15')
            where membership_number like 'DI-F%'), array['DI-F1'], 'October: due later this month, not the one already lapsed');
select is((select array_agg(membership_number) from kit.forecast_members_at('2041-09-01', '2040-10-15')
            where membership_number like 'DI-F%'), array['DI-F3'], 'the twelfth month is included');
select is((select count(*)::int from kit.forecast_members_at('2041-10-01', '2040-10-15')
            where membership_number like 'DI-F%'), 0, 'the thirteenth month is not part of the forecast');

------------------------------------------------------------------ lapse aging (as of 2040-10-15)
select tests.act_as_service();
create temp table di_aging_base as select * from kit.lapse_aging_at('2040-10-15');

select tests.make_member('DI-A30') as a30 \gset
select tests.make_member('DI-A31') as a31 \gset
select tests.make_member('DI-A90') as a90 \gset
select tests.make_member('DI-A91') as a91 \gset
select tests.make_member('DI-A180') as a180 \gset
select tests.make_member('DI-A181') as a181 \gset
select tests.make_member('DI-D30') as d30 \gset
select tests.make_member('DI-D31') as d31 \gset
select tests.make_member('DI-WV')  as wv  \gset
select tests.make_member('DI-FUT') as fut \gset
-- paid_through = today - days + 1
-- a30 has a real check payment (I1/R3), so its last-paid date is asserted below
select tests.di_period(:'a30',  '2040-10-15'::date - 29,  '2039-01-01', 'check');
select tests.di_period(:'a31',  '2040-10-15'::date - 30,  '2039-01-01', 'waived');
select tests.di_period(:'a90',  '2040-10-15'::date - 89,  '2039-01-01', 'waived');
select tests.di_period(:'a91',  '2040-10-15'::date - 90,  '2039-01-01', 'waived');
select tests.di_period(:'a180', '2040-10-15'::date - 179, '2039-01-01', 'waived');
select tests.di_period(:'a181', '2040-10-15'::date - 180, '2039-01-01', 'waived');
-- wv: only ever a waiver, no real payment ever recorded (I1/R3)
select tests.di_period(:'wv', '2040-10-15'::date - 29, '2039-01-01', 'waived');
select tests.act_as(:'admin');
select public.set_member_accepted_on(:'d30', '2040-10-15'::date - 29);
select public.set_member_accepted_on(:'d31', '2040-10-15'::date - 30);
-- fut: accepted in the future, so not lapsed or due yet (M1)
select public.set_member_accepted_on(:'fut', '2040-11-01');
select tests.act_as_service();

-- 13-18
select results_eq(
  $$select membership_number, days_unpaid, bucket from kit.lapsed_members_at('2040-10-15')
     where membership_number in ('DI-A30','DI-A31','DI-A90','DI-A91','DI-A180','DI-A181','DI-D30','DI-D31')
     order by days_unpaid, membership_number$$,
  $$values ('DI-A30', 30, '1-30'), ('DI-D30', 30, '1-30'), ('DI-A31', 31, '31-90'), ('DI-D31', 31, '31-90'),
           ('DI-A90', 90, '31-90'), ('DI-A91', 91, '91-180'), ('DI-A180', 180, '91-180'), ('DI-A181', 181, '181+')$$,
  'days unpaid count the paid-through (or accepted-on) day as day 1, and bucket edges are exact');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '1-30')
          - (select members from di_aging_base where bucket = '1-30'), 3, 'bucket 1-30 +3 (a30, d30, wv)');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '31-90')
          - (select members from di_aging_base where bucket = '31-90'), 3, 'bucket 31-90 +3');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '91-180')
          - (select members from di_aging_base where bucket = '91-180'), 2, 'bucket 91-180 +2');
select is((select members from kit.lapse_aging_at('2040-10-15') where bucket = '181+')
          - (select members from di_aging_base where bucket = '181+'), 1, 'bucket 181+ +1');
select is((select array_agg(bucket order by ord) from kit.lapse_aging_at('2040-10-15') with ordinality as t(bucket, members, cents, ord)),
          array['1-30', '31-90', '91-180', '181+'], 'four buckets in order');

-- 19-20
select is((select last_paid_on from kit.lapsed_members_at('2040-10-15') where membership_number = 'DI-A30'),
           '2039-01-01'::date, 'last payment date is the latest received date, from a real payment');
select is((select last_paid_on from kit.lapsed_members_at('2040-10-15') where membership_number = 'DI-WV'),
           null::date, 'a member whose only row is a waiver has no last payment date (I1/R3)');

-- 21
select is((select count(*)::int from kit.lapsed_members_at('2040-10-15') where membership_number = 'DI-FUT'), 0,
          'a member accepted in the future is not lapsed yet (M1)');

------------------------------------------------------------------ retention (as of 2040-10-15)
select kit.retention_at('2040-10-15') as rbase \gset

select tests.make_member('DI-R1') as r1 \gset
select tests.make_member('DI-R2') as r2 \gset
select tests.make_member('DI-R3') as r3 \gset
select tests.make_member('DI-R4') as r4 \gset
select tests.make_member('DI-R5') as r5 \gset
select tests.make_member('DI-R6') as r6 \gset
select tests.make_member('DI-R7') as r7 \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'r5', 'honorary');
select tests.act_as_service();
-- FY2038 endings on 2038-09-01; grace closes 2038-11-30
select tests.di_period(:'r1', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r2', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r3', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r4', '2038-09-01', '2037-09-01', 'waived');
select tests.di_period(:'r5', '2038-09-01', '2037-09-01', 'waived');
-- r1 renews on day +90, r2 on day +91 (period still anchored at the old end), r3 early
select tests.di_period(:'r1', '2039-09-01', '2038-11-30');
select tests.di_period(:'r2', '2039-09-01', '2038-12-01');
select tests.di_period(:'r3', '2039-09-01', '2038-08-01');
-- current year: r6 ends 2040-08-01 (window still open), r7 ends 2040-07-10 (closed 2040-10-08), no renewal
select tests.di_period(:'r6', '2040-08-01', '2039-08-01', 'waived');
select tests.di_period(:'r7', '2040-07-10', '2039-07-10', 'waived');

-- 22-27
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2038)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase'::jsonb -> 'years') y where (y ->> 'year')::int = 2038),
          4, 'FY2038 eligible: r1-r4 (honorary r5 left out)');
select is((select (y ->> 'renewed')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2038)
          - (select (y ->> 'renewed')::int from jsonb_array_elements(:'rbase'::jsonb -> 'years') y where (y ->> 'year')::int = 2038),
          2, 'FY2038 renewed: r1 at +90 (the closed-window edge, kept) and r3 early; r2 at +91 is a lapse');
select is((select (m ->> 'lapses')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'lapsesByMonth') m where m ->> 'month' = '2038-11-01')
          - (select (m ->> 'lapses')::int from jsonb_array_elements(:'rbase'::jsonb -> 'lapsesByMonth') m where m ->> 'month' = '2038-11-01'),
          2, 'November 2038 lapses: r2 and r4');
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2040)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase'::jsonb -> 'years') y where (y ->> 'year')::int = 2040),
          1, 'current year counts only closed windows: r7, not r6');
select is((select count(*)::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years')), 5, 'five fraternal years');
select is((select min((y ->> 'year')::int) from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y), 2036,
          'years 2036 to 2040');

-- second baseline, taken just before the M5/I2 fixtures below
select kit.retention_at('2040-10-15') as rbase2 \gset

select tests.make_member('DI-R-EDGE') as redge \gset
select tests.make_member('DI-OB-LATE') as oblate \gset
select tests.make_member('DI-OB-OK') as obok \gset
select tests.make_member('DI-R-VOID') as rvoid \gset
-- redge: period_end + 90 = today exactly; the window is still open on the edge day itself (M5)
select tests.di_period(:'redge', '2040-07-17', '2039-07-17', 'waived');
-- oblate: opening balance loaded after its window had already closed; excluded entirely (I2/R4)
select tests.di_period(:'oblate', '2036-08-01', '2040-01-01', 'opening_balance');
-- obok: opening balance loaded while its window was still open; counted normally (I2/R4)
select tests.di_period(:'obok', '2036-08-01', '2036-09-01', 'opening_balance');
-- rvoid: renews on time, but the renewal is voided; still counts as a lapse (M5)
select tests.di_period(:'rvoid', '2037-09-01', '2036-09-01', 'waived');
insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end)
values (:'rvoid', 'regular', 5000, 'check', '9', '2037-10-01', '2037-09-01', '2037-09-01'::date + 365);
update public.dues_periods set voided_at = now(), void_reason = 'test'
 where member_id = :'rvoid' and period_start = '2037-09-01';

-- 28-32
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2040)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase2'::jsonb -> 'years') y where (y ->> 'year')::int = 2040),
          0, 'period_end + 90 = today: the window is still open, not yet counted (M5)');
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2036)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase2'::jsonb -> 'years') y where (y ->> 'year')::int = 2036),
          1, 'opening balance loaded while its window was open counts (obok); loaded after it closed does not (oblate)');
select is((select (m ->> 'lapses')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'lapsesByMonth') m where m ->> 'month' = '2036-10-01')
          - (select (m ->> 'lapses')::int from jsonb_array_elements(:'rbase2'::jsonb -> 'lapsesByMonth') m where m ->> 'month' = '2036-10-01'),
          1, 'the late-loaded opening balance does not add a lapse either');
select is((select (y ->> 'eligible')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2037)
          - (select (y ->> 'eligible')::int from jsonb_array_elements(:'rbase2'::jsonb -> 'years') y where (y ->> 'year')::int = 2037),
          1, 'a voided renewal still leaves the original period eligible');
select is((select (y ->> 'renewed')::int from jsonb_array_elements(kit.retention_at('2040-10-15') -> 'years') y where (y ->> 'year')::int = 2037)
          - (select (y ->> 'renewed')::int from jsonb_array_elements(:'rbase2'::jsonb -> 'years') y where (y ->> 'year')::int = 2037),
          0, 'a voided renewal does not count as kept (M5)');

------------------------------------------------------------------ public wrappers
-- 33-38 refused without finance.view
select tests.act_as(:'knight');
select throws_ok($$select public.finance_collection_progress(2026)$$, '42501', 'forbidden', 'member: collection progress refused');
select throws_ok($$select * from public.finance_renewals_forecast()$$, '42501', 'forbidden', 'member: forecast refused');
select throws_ok($$select * from public.finance_forecast_members(date_trunc('month', now())::date)$$, '42501', 'forbidden', 'member: forecast members refused');
select throws_ok($$select * from public.finance_lapse_aging()$$, '42501', 'forbidden', 'member: aging refused');
select throws_ok($$select * from public.finance_lapsed_members()$$, '42501', 'forbidden', 'member: lapsed list refused');
select throws_ok($$select public.finance_retention()$$, '42501', 'forbidden', 'member: retention refused');

-- 39-43 validation and a working call
select tests.act_as(:'admin');
select throws_ok($$select public.finance_collection_progress(1999)$$, 'P0001', 'unknown fraternal year: 1999', 'year validated');
select throws_ok($$select * from public.finance_forecast_members('2026-10-15')$$, 'P0001', 'unknown forecast month: 2026-10-15',
                 'month must be the first of a month');
select throws_ok($$select * from public.finance_forecast_members(null)$$, 'P0001', 'unknown forecast month: (none)',
                 'a null month is rejected (M5)');
select throws_ok(
  format('select * from public.finance_forecast_members(%L)',
         (date_trunc('month', kit.council_today()) + interval '12 months')::date),
  'P0001',
  'unknown forecast month: ' || (date_trunc('month', kit.council_today()) + interval '12 months')::date::text,
  'a month more than eleven months out is rejected (M5)');
select lives_ok($$select * from public.finance_lapse_aging()$$, 'admin can read aging');

select * from finish();
rollback;
