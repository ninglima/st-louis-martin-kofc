begin;
\ir helpers/dues_fixtures.inc
select plan(17);

-- schema
select has_table('public', 'dues_levels', 'dues_levels exists');
select has_table('public', 'dues_periods', 'dues_periods exists');
select has_column('public', 'members', 'accepted_on', 'members.accepted_on exists');
select results_eq(
  $$ select slug, amount_cents, self_service from public.dues_levels order by sort_order $$,
  $$ values ('regular_contrib', 5800, true), ('regular', 5000, true), ('student', 2500, false),
            ('public_service', 2000, false), ('honorary', 1900, false) $$,
  'seeded levels and amounts');
select has_column('public', 'members', 'dues_level', 'members.dues_level exists');
select is(
  (select can_view and can_manage from public.role_permissions rp join public.roles r on r.id = rp.role_id
   where r.slug = 'administrator' and rp.section = 'finance'),
  true, 'administrator has finance view+manage');

-- status function (pure)
select is(kit.dues_status(null, null, '2027-01-01'), 'no_record', 'no periods, no accepted_on');
select is(kit.dues_status(null, '2026-12-01', '2027-01-01'), 'due', 'accepted, never paid');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-10-01'), 'lapsed', 'lapsed on paid_through day');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-09-30'), 'due_soon', 'day before paid_through');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-07-03'), 'due_soon', 'exactly 90 days out');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-07-02'), 'current', '91 days out');

-- ledger constraints (as postgres, bypassing functions)
select tests.make_member('100001') as m1 \gset
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'m1', 'regular_contrib', 0, 'opening_balance', '2026-01-01', '2026-01-01', '2027-01-01');
select throws_ok(
  format($$ insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
            values (%L, 'regular', 5000, 'cash', '2026-06-01', '2026-06-01', '2027-06-01') $$, :'m1'),
  '23P01', null, 'overlapping active periods rejected');
select throws_ok(
  format($$ update public.dues_periods set amount_cents = 1 where member_id = %L $$, :'m1'),
  'P0001', null, 'periods are immutable');
select throws_ok(
  format($$ delete from public.dues_periods where member_id = %L $$, :'m1'),
  'P0001', null, 'periods cannot be deleted');

-- rate change keeps history (Review Focus 5)
update public.dues_levels set amount_cents = 6000 where slug = 'regular_contrib';
select is((select amount_cents from public.dues_periods where member_id = :'m1'), 0, 'history keeps charged amount');
select tests.make_user('fs@example.com', 'administrator') as fs \gset
select tests.act_as(:'fs');
select is(
  (select amount_cents from public.member_dues_summary(array[:'m1'::uuid])),
  6000, 'summary prices owed at the current rate');

select * from finish();
rollback;
