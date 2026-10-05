-- 20260928130400_dues_status_council_date: dues status is computed against
-- the council's date, (now() at time zone 'America/Chicago')::date, not the
-- database/session date. Final review M1.
--
-- `current_date` follows the session TimeZone, so each boundary is checked
-- under two session zones whose date differs from Chicago's in opposite
-- directions. Pacific/Kiritimati (UTC+14) is a day AHEAD of Chicago for most
-- of the day; Etc/GMT+12 (UTC-12) is a day BEHIND for Chicago's early hours.
-- Between them, whatever hour this runs, at least one run would catch a
-- status that used the session date instead of Chicago's.
begin;
\ir helpers/dues_fixtures.inc
select plan(19);

select tests.make_user('cst-fs@example.com', 'administrator') as fs \gset
select tests.make_user('cst-a@example.com', 'member') as ua \gset
select tests.make_user('cst-b@example.com', 'member') as ub \gset
select tests.make_member('320001', :'ua') as ma \gset
select tests.make_member('320002', :'ub') as mb \gset
select tests.make_member('320003') as mc \gset
select tests.make_member('320004') as md \gset
select (now() at time zone 'America/Chicago')::date as today \gset

-- Paid-through (exclusive period_end) at each boundary, relative to Chicago:
-- A = today (lapsed), B = today + 1 (due soon), C = today + 90 (due soon),
-- D = today + 91 (current).
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
select id, 'regular', 5000, 'cash', :'today'::date - 400, e - 365, e
from (values (:'ma'::uuid, :'today'::date),
             (:'mb'::uuid, :'today'::date + 1),
             (:'mc'::uuid, :'today'::date + 90),
             (:'md'::uuid, :'today'::date + 91)) v(id, e);

select ok(pg_get_functiondef('public.member_dues_summary(uuid[])'::regprocedure) like '%America/Chicago%'
          and pg_get_functiondef('public.member_dues_summary(uuid[])'::regprocedure) not like '%current_date%',
  'member_dues_summary uses the Chicago date');
select ok(pg_get_functiondef('public.my_dues_summary()'::regprocedure) like '%America/Chicago%'
          and pg_get_functiondef('public.my_dues_summary()'::regprocedure) not like '%current_date%',
  'my_dues_summary uses the Chicago date');
select ok(pg_get_function_arguments('kit.dues_status(date, date, date)'::regprocedure) like '%America/Chicago%',
  'kit.dues_status defaults p_today to the Chicago date');

-- Run 1: session a day ahead of Chicago (most of the day).
set local timezone = 'Pacific/Kiritimati';
select tests.act_as(:'fs');
select is((select dues_status from public.member_dues_summary(array[:'ma'::uuid])), 'lapsed',   '[+14] lapsed on the Chicago paid-through day');
select is((select dues_status from public.member_dues_summary(array[:'mb'::uuid])), 'due_soon', '[+14] due soon the Chicago day before');
select is((select dues_status from public.member_dues_summary(array[:'mc'::uuid])), 'due_soon', '[+14] due soon exactly 90 Chicago days out');
select is((select dues_status from public.member_dues_summary(array[:'md'::uuid])), 'current',  '[+14] current 91 Chicago days out');
select tests.act_as(:'ub');
select is((select dues_status from public.my_dues_summary()), 'due_soon', '[+14] the member''s own card agrees');
reset role;
select is(kit.dues_status(:'today'::date + 1, null), 'due_soon', '[+14] kit.dues_status default is the Chicago date');
select is(kit.dues_status(:'today'::date, null), 'lapsed', '[+14] and lapses on the Chicago day itself');

-- Run 2: session a day behind Chicago (Chicago's early hours).
set local timezone = 'Etc/GMT+12';
select tests.act_as(:'fs');
select is((select dues_status from public.member_dues_summary(array[:'ma'::uuid])), 'lapsed',   '[-12] lapsed on the Chicago paid-through day');
select is((select dues_status from public.member_dues_summary(array[:'mb'::uuid])), 'due_soon', '[-12] due soon the Chicago day before');
select is((select dues_status from public.member_dues_summary(array[:'mc'::uuid])), 'due_soon', '[-12] due soon exactly 90 Chicago days out');
select is((select dues_status from public.member_dues_summary(array[:'md'::uuid])), 'current',  '[-12] current 91 Chicago days out');
select tests.act_as(:'ua');
select is((select dues_status from public.my_dues_summary()), 'lapsed', '[-12] the member''s own card agrees');
reset role;
select is(kit.dues_status(:'today'::date + 1, null), 'due_soon', '[-12] kit.dues_status default is the Chicago date');
select is(kit.dues_status(:'today'::date, null), 'lapsed', '[-12] and lapses on the Chicago day itself');

-- The explicit p_today still wins (the pure boundary tests in
-- dues_model.test.sql rely on it).
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-09-30'), 'due_soon', 'an explicit p_today still overrides the default');
select is(kit.dues_status('2027-10-01', '2026-10-01', '2027-10-01'), 'lapsed', 'an explicit p_today still overrides the default (lapsed)');

select * from finish();
rollback;
