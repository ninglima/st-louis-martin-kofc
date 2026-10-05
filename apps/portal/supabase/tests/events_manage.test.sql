begin;
\ir helpers/dues_fixtures.inc
select no_plan();

select tests.make_user('ev2-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev2-knight@example.com', 'member') as knight \gset
select tests.make_user('ev2-lead@example.com', 'member') as lead_user \gset
select tests.make_member('EV2-LEAD', :'lead_user') as lead_member \gset
select tests.make_member('EV2-OTHER') as other_member \gset
select id as pantry from public.event_types where name = 'Food Pantry' \gset

-- gates
select tests.act_as(:'knight');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', 'X', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',2)))),
  '42501', 'forbidden', 'a member cannot create events');

select tests.act_as(:'admin');

-- validation
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', 'X', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00', 'shifts', '[]'::json)),
  'P0001', 'Add at least one shift', 'an event needs a shift');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', 'X', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',0)))),
  'P0001', 'Volunteers needed must be between 1 and 200', 'capacity must be at least 1');
select throws_ok(format($$ select public.event_create(%L::jsonb) $$,
  json_build_object('type_id', :'pantry', 'title', '  ', 'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',2)))),
  'P0001', 'Title is required (200 characters at most)', 'title is required');

-- a single event
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Pantry', 'location', 'Hall',
    'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00', 'lead_member_id', :'lead_member',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','10:30','capacity',2,'label','Early'),
                               json_build_object('start_time','10:30','end_time','12:00','capacity',3)))::jsonb)
  ->'eventIds'->>0) as single \gset
select is((select count(*)::int from public.event_shifts where event_id = :'single'), 2, 'two shifts created');
select is(((select starts_at from public.events where id = :'single') at time zone 'America/Chicago')::text,
  '2040-10-06 09:00:00', 'the event starts at 09:00 Chicago');

-- a weekly series across DST (ends 2040-11-04)
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Tuesday pantry',
    'date', '2040-10-30', 'start_time', '09:00', 'end_time', '11:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','11:00','capacity',4)),
    'repeat', json_build_object('freq','weekly','interval',1,'weekdays',json_build_array(2),'until','2040-11-13'))::jsonb)
  ->>'seriesId') as series \gset
select is((select count(*)::int from public.events where series_id = :'series'), 3, 'three weekly events');
select is((select count(distinct (starts_at at time zone 'America/Chicago')::time)::int from public.events where series_id = :'series'),
  1, 'every date keeps the 09:00 local start');
select is((select count(*)::int from public.event_shifts sh join public.events e on e.id = sh.event_id where e.series_id = :'series'),
  3, 'each date gets its shifts');
select id as second from public.events where series_id = :'series' order by starts_at offset 1 limit 1 \gset

-- update: following changes later events only, never times
select lives_ok(format($$ select public.event_update(%L, '{"title":"Renamed"}', 'following') $$, :'second'), 'rename this and later');
select is((select array_agg(title order by starts_at) from public.events where series_id = :'series'),
  array['Tuesday pantry','Renamed','Renamed'], 'earlier events keep their title');
select throws_ok(format($$ select public.event_update(%L, '{"start_time":"10:00"}', 'following') $$, :'second'),
  'P0001', 'Times can only be changed one event at a time', 'series-wide time changes refused');
select lives_ok(format($$ select public.event_update(%L, '{"title":"Solo"}', 'following') $$, :'single'),
  'following on a non-series event');
select is((select count(*)::int from public.events where title = 'Solo'), 1, 'only that event changed');
select throws_ok(format($$ select public.event_update(%L, '{"bogus":1}', 'this') $$, :'single'),
  'P0001', 'unknown field: bogus', 'unknown field refused');

-- update: moving the date moves the shifts, keeping local time
select lives_ok(format($$ select public.event_update(%L, '{"date":"2040-11-06"}', 'this') $$, :'single'), 'move the date');
select is((select array_agg(to_char(starts_at at time zone 'America/Chicago', 'YYYY-MM-DD HH24:MI') order by starts_at)
           from public.event_shifts where event_id = :'single'),
  array['2040-11-06 09:00','2040-11-06 10:30'], 'shifts moved with the event, local times kept');

-- cancel this and later
select lives_ok(format($$ select public.event_update(%L, '{"status":"cancelled"}', 'following') $$, :'second'), 'cancel this and later');
select is((select array_agg(status::text order by starts_at) from public.events where series_id = :'series'),
  array['scheduled','cancelled','cancelled'], 'first date stays scheduled');

-- shifts save
select id as early from public.event_shifts where event_id = :'single' and label = 'Early' \gset
select tests.act_as_service();
insert into public.event_signups (shift_id, member_id) values (:'early', :'other_member');
select tests.act_as(:'admin');
select throws_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'single',
    json_build_array(json_build_object('start_time','10:30','end_time','12:00','capacity',3))),
  'P0001', 'A shift with volunteers cannot be removed; cancel the event instead', 'cannot delete a shift with volunteers');
select tests.act_as_service();
insert into public.event_signups (shift_id, member_id) values (:'early', :'lead_member');
select tests.act_as(:'admin');
select throws_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'single',
    json_build_array(json_build_object('id', :'early', 'start_time','09:00','end_time','10:30','capacity',1))),
  'P0001', 'Volunteers needed cannot be below the 2 already signed up', 'capacity cannot drop below sign-ups');
select lives_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'single',
    json_build_array(json_build_object('id', :'early', 'start_time','08:30','end_time','10:30','capacity',5,'label','Early'),
                     json_build_object('start_time','12:00','end_time','13:00','capacity',1))),
  'edit one shift, drop an empty one, add one');
select is((select count(*)::int from public.event_shifts where event_id = :'single'), 2, 'still two shifts');
select is((select capacity from public.event_shifts where id = :'early'), 5, 'capacity raised');

-- calendar
select is((select count(*)::int from public.events_in_range('2040-10-01', '2040-11-30')), 4, 'four events in range');
select is((select filled from public.events_in_range('2040-11-06', '2040-11-06') where id = :'single'), 2, 'filled counts active sign-ups');
select throws_ok($$ select * from public.events_in_range('2040-10-01', '2041-01-01') $$,
  'P0001', 'Choose a range of at most 62 days', 'range is capped');

-- detail: hours only for attendance takers or your own
select tests.act_as_service();
update public.event_signups set status = 'attended', hours = 1.5 where shift_id = :'early' and member_id = :'other_member';
select tests.act_as(:'knight');
select is(public.event_detail(:'single')->'shifts'->0->'signups'->1->'hours', 'null'::jsonb, 'a member does not see others'' hours');
select is((public.event_detail(:'single')->>'canTakeAttendance')::boolean, false, 'a member cannot take attendance');
select tests.act_as(:'lead_user');
select is((public.event_detail(:'single')->>'canTakeAttendance')::boolean, true, 'the lead can take attendance');
select isnt((select s->'hours' from jsonb_array_elements(public.event_detail(:'single')->'shifts'->0->'signups') s
             where s->>'memberId' = :'other_member'), 'null'::jsonb, 'the lead sees hours');

-- member search
select is((select count(*)::int from public.event_member_search(:'single', 'EV2-OTHER')), 1, 'the lead searches members');
select tests.act_as(:'knight');
select throws_ok(format($$ select * from public.event_member_search(%L, 'EV2') $$, :'single'),
  '42501', 'forbidden', 'a member cannot search');
select throws_ok($$ select * from public.event_member_search(null, 'EV2') $$,
  '42501', 'forbidden', 'searching for a lead needs manage');

-- controller ruling: an inactive type does not block editing an event that already has it
select id as handyman from public.event_types where name = 'Handy Man Services' \gset
select tests.act_as_service();
update public.event_types set active = false where id in (:'pantry', :'handyman');
select tests.act_as(:'admin');
select lives_ok(format($$ select public.event_update(%L, %L, 'this') $$, :'single',
    json_build_object('title', 'Still pantry', 'type_id', :'pantry')::text),
  'keeping the same (now inactive) type does not block the edit');
select throws_ok(format($$ select public.event_update(%L, %L, 'this') $$, :'single',
    json_build_object('type_id', :'handyman')::text),
  'P0001', 'Choose an active event type', 'switching to a different inactive type still requires an active type');
select tests.act_as_service();
update public.event_types set active = true where id in (:'pantry', :'handyman');
select tests.act_as(:'admin');

select * from finish();
rollback;
