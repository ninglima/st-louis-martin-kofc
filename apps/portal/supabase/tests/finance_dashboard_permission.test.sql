begin;
\ir helpers/dues_fixtures.inc
select plan(6);

select is(
  (select can_view from public.role_permissions rp
     join public.roles r on r.id = rp.role_id
    where r.slug = 'administrator' and rp.section = 'dashboard_finance'),
  true,
  'administrator keeps the finance dashboard');

select is(
  (select count(*)::int from public.role_permissions rp
     join public.roles r on r.id = rp.role_id
    where r.slug = 'member' and rp.section = 'dashboard_finance'),
  0,
  'member is not granted the finance dashboard');

insert into public.roles (slug, name)
values ('dashboard-only', 'Dashboard only');

insert into public.role_permissions (role_id, section, can_view, can_manage)
select id, 'dashboard_finance', true, false
  from public.roles
 where slug = 'dashboard-only';

select tests.make_user('dash-only@example.com', 'dashboard-only') as viewer \gset
select tests.make_user('dash-neither@example.com', 'member') as knight \gset

select tests.act_as(:'viewer');
select lives_ok(
  $$select public.finance_dashboard(kit.fraternal_year_of(kit.council_today()))$$,
  'dashboard grant can read the finance dashboard');
select throws_ok(
  $$select * from public.dues_notices_list()$$,
  '42501',
  'forbidden',
  'dashboard grant cannot list dues notices');

select tests.act_as(:'knight');
select throws_ok(
  $$select public.finance_dashboard(kit.fraternal_year_of(kit.council_today()))$$,
  '42501',
  'forbidden',
  'member cannot read the finance dashboard');
select throws_ok(
  $$select * from public.dues_notices_list()$$,
  '42501',
  'forbidden',
  'member cannot list dues notices');

select * from finish();
rollback;
