begin;
\ir helpers/dues_fixtures.inc
select plan(32);

select tests.make_user('fin-admin@example.com', 'administrator') as admin \gset
select tests.make_user('fin-knight@example.com', 'member') as knight \gset
insert into public.roles (slug, name) values ('fin_viewer', 'Finance viewer') returning id as viewer_role \gset
insert into public.role_permissions (role_id, section, can_view, can_manage)
values (:'viewer_role', 'finance', true, false);
select tests.make_user('fin-viewer@example.com', 'fin_viewer') as viewer \gset
insert into public.hosting_providers (slug, name, sort_order) values ('test_none', 'Test none', 99);

-- 1-2 schema
select has_table('public', 'hosting_costs', 'hosting_costs exists');
select results_eq(
  $$select slug from public.hosting_providers where slug <> 'test_none' order by sort_order$$,
  $$values ('supabase'), ('cloudflare'), ('google_cloud'), ('domain'), ('other')$$,
  'providers are seeded in order');

-- 3-5 a member without finance
select tests.act_as(:'knight');
select throws_ok($$select public.hosting_cost_upsert('supabase', 2500, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  '42501', 'forbidden', 'member cannot add a bill');
select throws_ok($$select * from public.hosting_costs_list(2034)$$, '42501', 'forbidden', 'member cannot list bills');
select throws_ok($$select public.hosting_cost_repeat_last('supabase')$$, '42501', 'forbidden', 'member cannot repeat a bill');

-- 6-8 finance.view without manage
select tests.act_as(:'viewer');
select lives_ok($$select * from public.hosting_costs_list(2034)$$, 'viewer can list bills');
select throws_ok($$select public.hosting_cost_upsert('supabase', 2500, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  '42501', 'forbidden', 'viewer cannot add a bill');
select throws_ok($$select public.hosting_cost_delete(gen_random_uuid())$$, '42501', 'forbidden', 'viewer cannot delete a bill');

-- administrator
select tests.act_as(:'admin');
select id as bill from public.hosting_cost_upsert('supabase', 2500, '2034-10-01', '2034-10-01', '2034-11-01', '  Pro plan  ') \gset

-- 9-11 insert and update
select is((select note from public.hosting_costs_list(2034) where id = :'bill'), 'Pro plan', 'note is trimmed');
select is((select recorded_by_email from public.hosting_costs_list(2034) where id = :'bill'), 'fin-admin@example.com', 'recorder email is returned');
select is((select amount_cents from public.hosting_cost_upsert('supabase', 2600, '2034-10-01', '2034-10-01', '2034-11-01', null, :'bill')),
  2600, 'upsert with an id updates the bill');

-- 12-16 validation
select throws_ok($$select public.hosting_cost_upsert('aws', 100, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  'P0001', 'unknown hosting provider: aws', 'unknown provider is refused');
select throws_ok($$select public.hosting_cost_upsert('supabase', 100, '2034-10-01', '2034-11-01', '2034-11-01')$$,
  'P0001', 'the covered period must end after it starts', 'empty period is refused');
select throws_ok($$select public.hosting_cost_upsert('supabase', 100, '2034-10-01', '2034-10-01', '2037-10-05')$$,
  'P0001', 'a bill can cover at most 3 years', 'over-long period is refused');
select throws_ok($$select public.hosting_cost_upsert('supabase', -1, '2034-10-01', '2034-10-01', '2034-11-01')$$,
  'P0001', 'the amount must be zero or more', 'negative amount is refused');
select throws_ok(format($$select public.hosting_cost_upsert('supabase', 100, '2034-10-01', '2034-10-01', '2034-11-01', %L)$$, repeat('x', 501)),
  'P0001', 'the note can be at most 500 characters', 'long note is refused');

-- 17-20 repeat last bill
select results_eq(
  $$select period_start, period_end, paid_on from public.hosting_cost_repeat_last('supabase')$$,
  $$values ('2034-11-01'::date, '2034-12-01'::date, kit.council_today())$$,
  'a whole-month bill repeats by calendar months, paid today');
select public.hosting_cost_upsert('domain', 1200, '2034-09-20', '2034-10-01', '2035-10-01');
select results_eq(
  $$select period_start, period_end from public.hosting_cost_repeat_last('domain')$$,
  $$values ('2035-10-01'::date, '2036-10-01'::date)$$,
  'an annual bill repeats a year later');
select public.hosting_cost_upsert('other', 3000, '2034-10-16', '2034-10-16', '2034-11-15');
select results_eq(
  $$select period_start, period_end from public.hosting_cost_repeat_last('other')$$,
  $$values ('2034-11-15'::date, '2034-12-15'::date)$$,
  'a bill that is not whole months repeats by the same number of days');
select throws_ok($$select public.hosting_cost_repeat_last('test_none')$$,
  'P0001', 'no earlier bill for this provider', 'repeat needs an earlier bill');

-- 21-22 overlaps
select ok(:'bill'::uuid in (select * from public.hosting_cost_overlaps('supabase', '2034-10-15', '2034-10-20')),
  'an overlapping bill is reported');
select is((select count(*)::int from public.hosting_cost_overlaps('supabase', '2034-10-15', '2034-10-20', :'bill')),
  0, 'the bill being edited is excluded');

-- 23-26 listing by fraternal year
select ok(exists (select 1 from public.hosting_costs_list(2034) where id = :'bill'), 'FY2034 lists an October 2034 bill');
select ok(not exists (select 1 from public.hosting_costs_list(2033) where id = :'bill'), 'FY2033 does not');
select id as cf from public.hosting_cost_upsert('cloudflare', 1200, '2034-12-20', '2035-01-01', '2036-01-01') \gset
select ok(exists (select 1 from public.hosting_costs_list(2034) where id = :'cf'), 'a bill crossing July 1 is listed in the first year');
select ok(exists (select 1 from public.hosting_costs_list(2035) where id = :'cf'), 'and in the second year');

-- 27-29 latest and delete
select is((select period_end from public.hosting_cost_latest() where provider = 'supabase'), '2034-12-01'::date,
  'latest returns the bill with the latest end');
select lives_ok(format($$select public.hosting_cost_delete(%L)$$, :'bill'), 'admin can delete a bill');
select throws_ok(format($$select public.hosting_cost_delete(%L)$$, :'bill'), 'P0001', 'hosting cost not found', 'a deleted bill is gone');

-- 30-32 privileges
select tests.act_as_service();
select is(has_table_privilege('authenticated', 'public.hosting_costs', 'select'), false, 'no direct select on hosting_costs');
select is(has_table_privilege('authenticated', 'public.hosting_costs', 'truncate'), false, 'no truncate on hosting_costs');
select is(has_table_privilege('authenticated', 'public.hosting_providers', 'select'), true, 'providers are readable');

select * from finish();
rollback;
