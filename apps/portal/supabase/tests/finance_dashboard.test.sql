begin;
\ir helpers/dues_fixtures.inc
select plan(43);

select tests.make_user('fd-admin@example.com', 'administrator') as admin \gset
select tests.make_user('fd-knight@example.com', 'member') as knight \gset

-- hosting fixtures (inserted directly, as the superuser)
insert into public.hosting_costs (provider, amount_cents, paid_on, period_start, period_end) values
  ('domain',       1200, '2034-09-20', '2034-10-01', '2035-10-01'),
  ('supabase',     2500, '2034-10-01', '2034-10-01', '2034-11-01'),
  ('other',        3000, '2034-10-16', '2034-10-16', '2034-11-16'),
  ('cloudflare',   1200, '2034-12-20', '2035-01-01', '2036-01-01'),
  ('google_cloud', 2900, '2036-02-01', '2036-02-01', '2036-03-01');

-- 1-8 spreading
select is((select round(cents)::int from kit.hosting_spread('2034-10-01', '2034-11-01') where provider = 'domain'), 102, 'annual bill: October share');
select is((select round(cents)::int from kit.hosting_spread('2034-10-01', '2034-11-01') where provider = 'supabase'), 2500, 'monthly bill: whole month');
select is((select round(cents)::int from kit.hosting_spread('2034-10-01', '2034-11-01') where provider = 'other'), 1548, 'mid-month bill: October share');
select is((select cents from kit.hosting_monthly(2034) where month = '2034-11-01' and provider = 'other'), 1452, 'mid-month bill: November share');
select is((select round(cents)::int from kit.hosting_spread('2034-07-01', '2035-07-01') where provider = 'domain'), 898, 'annual bill: FY2034 total');
select is((select round(cents)::int from kit.hosting_spread('2034-07-01', '2035-07-01') where provider = 'cloudflare'), 595, 'bill crossing July 1: first year');
select is((select round(cents)::int from kit.hosting_spread('2035-07-01', '2036-07-01') where provider = 'cloudflare'), 605, 'bill crossing July 1: second year');
select is((select cents from kit.hosting_monthly(2035) where month = '2036-02-01' and provider = 'google_cloud'), 2900, 'leap-year February');

-- 9-17 hosting to date and projection
select is((kit.finance_dashboard_at(2034, '2034-10-16') ->> 'hostingToDateCents')::int, 1440, 'hosting so far counts days through today');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'domain'), 898, 'projection: bill already covers the year');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'supabase'), 22016, 'projection: monthly bill runs on at its rate');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'other'), 24968, 'projection: partial-month bill runs on at its rate');
select is((select round(cents)::int from kit.hosting_projection_at(2034, '2034-10-16') where provider = 'cloudflare'), 595, 'projection: future bill counts its share only');
select is((kit.finance_dashboard_at(2034, '2034-10-16') ->> 'hostingProjectionCents')::int, 48476, 'projection total');
select is((kit.finance_dashboard_at(2037, '2037-10-16') ->> 'hostingProjectionCents')::int, 0, 'no bill in the last 13 months: nothing projected');
select is(kit.finance_dashboard_at(2034, '2037-10-16') ->> 'hostingProjectionCents', null::text, 'past years have no projection');
select is((kit.finance_dashboard_at(2034, '2037-10-16') ->> 'hostingToDateCents')::int, 6993, 'past year: hosting so far is the whole year');

-- dues fixtures
select tests.make_member('FD-001') as d1 \gset
select tests.make_member('FD-002') as d2 \gset
select tests.make_member('FD-003') as d3 \gset
select tests.make_member('FD-004') as d4 \gset
insert into public.dues_periods (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end) values
  (:'d1', 'regular',         5000, 'check',  '101', '2036-06-30', '2035-06-30', '2035-06-30'::date + 365),
  (:'d2', 'regular_contrib', 5800, 'online', null,  '2036-07-01', '2036-07-01', '2036-07-01'::date + 365),
  (:'d3', 'student',         2500, 'cash',   null,  '2035-09-10', '2035-09-10', '2035-09-10'::date + 365),
  (:'d4', 'regular',         9999, 'cash',   null,  '2035-09-11', '2035-09-11', '2035-09-11'::date + 365);
update public.dues_periods set voided_at = now(), void_reason = 'test' where member_id = :'d4';

-- 18-22 dues
select is(kit.dues_collected(2035), 7500::bigint, 'FY2035: June 30 and September count, the voided row does not');
select is(kit.dues_collected(2036), 5800::bigint, 'FY2036: July 1 belongs to the new year');
select is((select cash_cents from kit.dues_monthly(2035) where month = '2035-09-01'), 2500::bigint, 'September cash');
select is((select check_cents from kit.dues_monthly(2035) where month = '2036-06-01'), 5000::bigint, 'June check');
select is((select count(*)::int from kit.dues_monthly(2035)), 12, 'twelve months, even when empty');

-- 23-25 net by year
select is((select hosting_cents from kit.finance_net_by_year_at('2037-10-16') where year = 2034), 6993::bigint, 'net: FY2034 hosting');
select results_eq(
  $$select dues_cents, hosting_cents from kit.finance_net_by_year_at('2037-10-16') where year = 2035$$,
  $$values (7500::bigint, 3807::bigint)$$, 'net: FY2035 dues and hosting');
select is((select dues_cents from kit.finance_net_by_year_at('2037-10-16') where year = 2036), 5800::bigint, 'net: FY2036 dues');

-- snapshot baseline, then fixtures (as of 2030-01-15)
select kit.finance_dashboard_at(2029, '2030-01-15') as base \gset
select tests.make_member('FS-CUR')    as s_cur \gset
select tests.make_member('FS-SOON')   as s_soon \gset
select tests.make_member('FS-SOON2')  as s_soon2 \gset
select tests.make_member('FS-DUE')    as s_due \gset
select tests.make_member('FS-LAPSED') as s_lapsed \gset
select tests.make_member('FS-HON')    as s_hon \gset
select tests.make_member('FS-NONE')   as s_none \gset
select tests.act_as(:'admin');
select public.set_member_accepted_on(:'s_due', '2029-12-01');
select public.set_member_dues_level(:'s_hon', 'honorary');
select tests.act_as_service();
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end) values
  (:'s_cur',    'regular_contrib', 0, 'waived', '2029-06-01', '2029-06-01', '2029-06-01'::date + 365),
  (:'s_soon',   'regular_contrib', 0, 'waived', '2029-02-10', '2029-02-10', '2029-02-10'::date + 365),
  (:'s_soon2',  'regular_contrib', 0, 'waived', '2029-03-30', '2029-03-30', '2029-03-30'::date + 365),
  (:'s_lapsed', 'regular_contrib', 0, 'waived', '2028-06-01', '2028-06-01', '2028-06-01'::date + 365),
  (:'s_hon',    'honorary',        0, 'waived', '2028-01-01', '2028-01-01', '2028-01-01'::date + 365);

-- 26-33 snapshot deltas
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'current')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'current')::int, 1, 'one more current');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'due_soon')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'due_soon')::int, 2, 'two more due soon');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'due')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'due')::int, 1, 'one more due');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'lapsed')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'lapsed')::int, 2, 'two more lapsed');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'statusCounts' ->> 'no_record')::int
          - (:'base'::jsonb -> 'statusCounts' ->> 'no_record')::int, 1, 'one more with no record');
select is((kit.finance_dashboard_at(2029, '2030-01-15') ->> 'outstandingCents')::int
          - (:'base'::jsonb ->> 'outstandingCents')::int, 13500, 'outstanding: due + lapsed at level price, honorary included');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'collection' ->> 'numerator')::int
          - (:'base'::jsonb -> 'collection' ->> 'numerator')::int, 3, 'collection numerator: current + due soon');
select is((kit.finance_dashboard_at(2029, '2030-01-15') -> 'collection' ->> 'denominator')::int
          - (:'base'::jsonb -> 'collection' ->> 'denominator')::int, 5, 'collection denominator excludes honorary and no record');

-- 34 follow-up
select is(
  (select array_agg(f.membership_number order by f.ord)
     from kit.finance_follow_up_at('2030-01-15') with ordinality
          as f(member_id, first_name, last_name, membership_number, dues_status, paid_through, level_name, amount_cents, ord)
    where f.membership_number like 'FS-%'),
  array['FS-HON', 'FS-LAPSED', 'FS-DUE', 'FS-SOON'],
  'follow-up: lapsed by paid-through, then due, then due within 30 days');

-- payments to check
select tests.make_user('fd-payer@example.com', 'member') as payer \gset
select tests.make_member('FP-001', :'payer') as fp \gset
insert into public.payments (id, user_id, provider, amount, status, payment_type, metadata) values
  ('00000000-0000-0000-0000-0000000fd0a1', :'payer', 'stripe', 5800, 'succeeded', 'dues',     '{"dues_level":"regular_contrib"}'),
  ('00000000-0000-0000-0000-0000000fd0a2', :'payer', 'stripe', 5800, 'succeeded', 'dues',     '{"dues_level":"regular_contrib"}'),
  ('00000000-0000-0000-0000-0000000fd0a3', :'payer', 'stripe', 2500, 'succeeded', 'donation', '{}'),
  ('00000000-0000-0000-0000-0000000fd0a4', :'payer', 'stripe', 5800, 'pending',   'dues',     '{"dues_level":"regular_contrib"}');
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
values (:'fp', 'regular_contrib', 5800, 'online', '2031-01-01', '2031-01-01', '2031-01-01'::date + 365, '00000000-0000-0000-0000-0000000fd0a2');

select tests.act_as(:'admin');
-- 35-36
select is(
  (select array_agg(payment_id) from public.finance_payments_to_check()
    where payment_id::text like '00000000-0000-0000-0000-0000000fd0a%'),
  array['00000000-0000-0000-0000-0000000fd0a1'::uuid],
  'only the succeeded dues payment with no period needs checking');
select results_eq(
  $$select member_name, dues_level, amount_cents from public.finance_payments_to_check()
     where payment_id = '00000000-0000-0000-0000-0000000fd0a1'$$,
  $$values ('Test Knight FP-001'::text, 'regular_contrib'::text, 5800)$$,
  'payments to check name the member and level');

-- 37-40 refused without finance.view
select tests.act_as(:'knight');
select throws_ok($$select public.finance_dashboard(2026)$$, '42501', 'forbidden', 'member cannot read the dashboard');
select throws_ok($$select * from public.finance_follow_up()$$, '42501', 'forbidden', 'member cannot read the follow-up list');
select throws_ok($$select * from public.finance_net_by_year()$$, '42501', 'forbidden', 'member cannot read net by year');
select throws_ok($$select * from public.finance_payments_to_check()$$, '42501', 'forbidden', 'member cannot read payments to check');

-- 41-42 year validation
select tests.act_as(:'admin');
select throws_ok($$select public.finance_dashboard(1999)$$, 'P0001', 'unknown fraternal year: 1999', 'years before 2000 are refused');
select lives_ok($$select public.finance_dashboard(kit.fraternal_year_of(kit.council_today()))$$, 'the current fraternal year works');

-- 43 kit internals are not callable directly
select tests.act_as_service();
select is(has_function_privilege('authenticated', 'kit.finance_dashboard_at(integer, date)', 'execute'), false,
  'kit.finance_dashboard_at is not executable by authenticated');

select * from finish();
rollback;
