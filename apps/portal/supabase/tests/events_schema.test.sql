begin;
\ir helpers/dues_fixtures.inc
select no_plan();

select tests.make_user('ev1-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev1-knight@example.com', 'member') as knight \gset
select tests.make_user('ev1-none@example.com', 'no_such_role') as nobody \gset

-- section seeds
select is((select rp.can_view::text || rp.can_manage::text from public.role_permissions rp
           join public.roles r on r.id = rp.role_id where r.slug = 'administrator' and rp.section = 'events'),
  'truetrue', 'administrator can view and manage events');
select is((select rp.can_view::text || rp.can_manage::text from public.role_permissions rp
           join public.roles r on r.id = rp.role_id where r.slug = 'member' and rp.section = 'events'),
  'truefalse', 'member can view events');

-- seeded types
select is((select count(*)::int from public.event_types where name in
  ('Food Pantry','Handy Man Services','Honor Flights','Breakfast with Knights','Foster Children Support','Right to Life')),
  6, 'six seeded event types');
select is((select category::text from public.event_types where name = 'Right to Life'), 'life', 'Right to Life is a Life program');
select is((select category::text from public.event_types where name = 'Breakfast with Knights'), 'family', 'Breakfast with Knights is Family');

-- recurrence
select results_eq(
  $$ select d from kit.series_dates('{"freq":"weekly","interval":2,"weekdays":[2,4],"start_date":"2040-10-04","until":"2040-10-31"}') d $$,
  $$ values ('2040-10-04'::date), ('2040-10-16'::date), ('2040-10-18'::date), ('2040-10-30'::date) $$,
  'weekly every 2 weeks on Tuesday and Thursday');
select results_eq(
  $$ select d from kit.series_dates('{"freq":"monthly","weekday":6,"nth":2,"start_date":"2040-10-01","until":"2041-01-31"}') d $$,
  $$ values ('2040-10-13'::date), ('2040-11-10'::date), ('2040-12-08'::date), ('2041-01-12'::date) $$,
  'monthly on the 2nd Saturday');
select results_eq(
  $$ select d from kit.series_dates('{"freq":"monthly","weekday":6,"nth":-1,"start_date":"2040-10-01","until":"2041-01-31"}') d $$,
  $$ values ('2040-10-27'::date), ('2040-11-24'::date), ('2040-12-29'::date), ('2041-01-26'::date) $$,
  'monthly on the last Saturday');
select is((select count(*)::int from kit.series_dates('{"freq":"monthly","weekday":6,"nth":2,"start_date":"2040-10-20","until":"2040-11-30"}')),
  1, 'a monthly date before the start date is skipped');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":1,"weekdays":[1],"start_date":"2040-10-01","until":"2041-10-02"}') $$,
  'P0001', 'A repeat can run for at most one year', 'a repeat is capped at one year');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":1,"weekdays":[1],"start_date":"2040-10-10","until":"2040-10-01"}') $$,
  'P0001', 'The repeat must end on or after the first date', 'until before start is refused');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":1,"weekdays":[],"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Choose at least one weekday', 'weekly needs a weekday');
select throws_ok($$ select kit.series_dates('{"freq":"weekly","interval":5,"weekdays":[1],"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Repeat every 1 to 4 weeks', 'interval is 1 to 4');
select throws_ok($$ select kit.series_dates('{"freq":"monthly","weekday":6,"nth":5,"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Choose first, second, third, fourth or last', 'nth is 1-4 or -1');
select throws_ok($$ select kit.series_dates('{"freq":"daily","start_date":"2040-10-01","until":"2040-10-31"}') $$,
  'P0001', 'Unknown repeat pattern', 'unknown freq');

-- local time, DST (ends 2040-11-04) and midnight crossing
select is(((select starts_at from kit.local_span('2040-11-02', '09:00', '11:00')) at time zone 'America/Chicago')::time,
  '09:00'::time, 'local start before DST ends');
select is(((select starts_at from kit.local_span('2040-11-05', '09:00', '11:00')) at time zone 'America/Chicago')::time,
  '09:00'::time, 'local start after DST ends');
select isnt((select starts_at at time zone 'UTC' from kit.local_span('2040-11-02', '09:00', '11:00'))::time,
  (select starts_at at time zone 'UTC' from kit.local_span('2040-11-05', '09:00', '11:00'))::time,
  'the UTC hour moves across DST so the local hour does not');
select is((select ends_at - starts_at from kit.local_span('2040-10-10', '22:00', '02:00')), interval '4 hours',
  'a shift that crosses midnight ends the next day');

-- preview gate and result
select tests.act_as(:'knight');
select throws_ok($$ select public.event_series_preview('{"freq":"weekly","interval":1,"weekdays":[1],"start_date":"2040-10-01","until":"2040-10-31"}') $$,
  '42501', 'forbidden', 'a member cannot preview a series');
select tests.act_as(:'admin');
select is(public.event_series_preview('{"freq":"monthly","weekday":6,"nth":2,"start_date":"2040-10-01","until":"2041-01-31"}'),
  '{"count": 4, "first": "2040-10-13", "last": "2041-01-12"}'::jsonb, 'preview counts and bounds the dates');

-- event types
select lives_ok($$ select public.event_types_save('{"name":"Coats for Kids","category":"community","description":"","active":true}') $$,
  'an officer adds a type');
select throws_ok($$ select public.event_types_save('{"name":"coats for kids","category":"community","active":true}') $$,
  'P0001', 'An event type with that name already exists', 'type names are unique, ignoring case');
select throws_ok($$ select public.event_types_save('{"name":"X","category":"sports","active":true}') $$,
  'P0001', 'Choose a category', 'category must be one of the four');
select throws_ok($$ select public.event_types_save('{"name":"  ","category":"life","active":true}') $$,
  'P0001', 'Name is required (100 characters at most)', 'blank name refused');
select tests.act_as(:'knight');
select throws_ok($$ select public.event_types_save('{"name":"Y","category":"life","active":true}') $$,
  '42501', 'forbidden', 'a member cannot save a type');

-- RLS
select is((select count(*)::int from public.event_types where active), 7, 'a member reads the active types');
select throws_ok($$ select count(*) from public.event_signups $$, '42501', null, 'sign-ups are not directly readable');
-- tests.make_user('ev1-none@example.com', 'no_such_role') matches no role,
-- but kit.new_user_created_setup() (20260922055727_default_role_on_signup.sql)
-- assigns every new auth.users row the role marked is_default ('member') via
-- its own on-conflict-do-nothing insert, which runs before make_user's insert
-- (which affects 0 rows since 'no_such_role' matches nothing). So "nobody"
-- ends up with the default member role instead of no role at all. Clear it
-- as the service role so this test exercises an actual no-role member.
select tests.act_as_service();
delete from public.user_roles where user_id = :'nobody';
select tests.act_as(:'nobody');
select is((select count(*)::int from public.event_types), 0, 'no events.view, no types');

select * from finish();
rollback;
