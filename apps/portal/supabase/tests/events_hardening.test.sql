begin;
\ir helpers/dues_fixtures.inc
select no_plan();

select tests.make_user('ev4-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev4-knight@example.com', 'member') as knight \gset
select tests.make_user('ev4-lead@example.com', 'member') as lead_user \gset
select tests.make_user('ev4-noview@example.com', 'member') as noview_user \gset
select tests.make_member('EV4-KNIGHT', :'knight') as knight_member \gset
select tests.make_member('EV4-LEAD', :'lead_user') as lead_member \gset
select id as pantry from public.event_types where name = 'Food Pantry' \gset

-- A user who holds no role at all: every new auth.users row gets the
-- default 'member' role first (see events_schema.test.sql), so clear it as
-- service to get an actual no-permission member.
select tests.act_as_service();
delete from public.user_roles where user_id = :'noview_user';

select tests.act_as(:'admin');
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Hardening event',
    'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00', 'lead_member_id', :'lead_member',
    'shifts', json_build_array(json_build_object('start_time', '09:00', 'end_time', '12:00', 'capacity', 3)))::jsonb)
  ->'eventIds'->>0) as event_id \gset
select id as shift_id from public.event_shifts where event_id = :'event_id' \gset

-- A shift that has already started, with a member signed up on it directly
-- (event_signup itself refuses a past shift, so the sign-up is seeded as
-- service instead of exercised through it).
select tests.act_as_service();
insert into public.events (type_id, title, starts_at, ends_at)
  values (:'pantry', 'Started', now() - interval '2 hours', now() - interval '1 hour')
  returning id as started_event \gset
insert into public.event_shifts (event_id, starts_at, ends_at, capacity)
  values (:'started_event', now() - interval '2 hours', now() - interval '1 hour', 5)
  returning id as started_shift \gset
insert into public.event_signups (shift_id, member_id, status)
  values (:'started_shift', :'knight_member', 'signed_up')
  returning id as started_signup \gset

-- no events.view: refused everywhere that checks it
select tests.act_as(:'noview_user');
select throws_ok($$ select * from public.events_in_range('2040-10-01', '2040-10-31') $$,
  '42501', null, 'no events.view: events_in_range refused');
select throws_ok(format($$ select public.event_detail(%L) $$, :'event_id'),
  '42501', null, 'no events.view: event_detail refused');
select throws_ok(format($$ select public.event_signup(%L) $$, :'shift_id'),
  '42501', null, 'no events.view: event_signup refused');
select throws_ok($$ select * from public.event_member_search(null, 'EV4') $$,
  '42501', null, 'no events.view: event_member_search refused');

-- a plain member (events.view only) cannot manage
select tests.act_as(:'knight');
select throws_ok(format($$ select public.event_update(%L, '{"title":"Renamed"}', 'this') $$, :'event_id'),
  '42501', 'forbidden', 'a member cannot update an event');
select throws_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'event_id',
    json_build_array(json_build_object('start_time', '09:00', 'end_time', '12:00', 'capacity', 3))),
  '42501', 'forbidden', 'a member cannot save shifts');

-- event_series has no direct grant at all, for anyone authenticated
select throws_ok($$ select count(*) from public.event_series $$,
  '42501', null, 'event_series is not directly readable');

-- cancelling your own sign-up once the shift has started
select throws_ok(format($$ select public.event_cancel_signup(%L) $$, :'started_signup'),
  'P0001', 'This shift has already started.', 'a member cannot cancel after the shift started');

-- equal start and end times are refused
select tests.act_as(:'admin');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
    json_build_object('type_id', :'pantry', 'title', 'Equal', 'date', '2040-10-06',
      'start_time', '09:00', 'end_time', '09:00',
      'shifts', json_build_array(json_build_object('start_time', '09:00', 'end_time', '12:00', 'capacity', 2)))),
  'P0001', 'The end time must differ from the start time', 'equal event times refused in event_create');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
    json_build_object('type_id', :'pantry', 'title', 'Equal shift', 'date', '2040-10-06',
      'start_time', '09:00', 'end_time', '12:00',
      'shifts', json_build_array(json_build_object('start_time', '10:00', 'end_time', '10:00', 'capacity', 2)))),
  'P0001', 'The end time must differ from the start time', 'equal shift times refused in event_create');
select throws_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'event_id',
    json_build_array(json_build_object('start_time', '09:00', 'end_time', '09:00', 'capacity', 3))),
  'P0001', 'The end time must differ from the start time', 'equal shift times refused in event_shifts_save');
select throws_ok(format($$ select public.event_update(%L, '{"start_time":"09:00","end_time":"09:00"}', 'this') $$, :'event_id'),
  'P0001', 'The end time must differ from the start time', 'equal event times refused in event_update');

-- event_member_search: the number is withheld from a lead, shown to an admin
select tests.act_as(:'lead_user');
select is((select membership_number from public.event_member_search(:'event_id', 'EV4-KNIGHT')),
  null, 'a lead sees a name without a membership number');
select tests.act_as(:'admin');
select is((select membership_number from public.event_member_search(:'event_id', 'EV4-KNIGHT')),
  'EV4-KNIGHT', 'an administrator sees the membership number');

select * from finish();
rollback;
