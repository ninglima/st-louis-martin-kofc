begin;
\ir helpers/dues_fixtures.inc
select no_plan();

-- Baseline: the local DB holds real roster data, and by the time this runs
-- there may already be real attended events in the current fraternal year.
-- The report assertions near the end compare deltas against this snapshot
-- (captured before any fixture below exists) instead of absolute totals, so
-- they hold regardless of what real events have happened this year.
select tests.act_as_service();
select kit.fraternal_year_of(kit.council_today()) as fy \gset
select (kit.volunteer_report_at(:'fy', now()))::text as base_report \gset

select tests.make_user('ev3-admin@example.com', 'administrator') as admin \gset
select tests.make_user('ev3-a@example.com', 'member') as ua \gset
select tests.make_user('ev3-b@example.com', 'member') as ub \gset
select tests.make_user('ev3-c@example.com', 'member') as uc \gset
select tests.make_user('ev3-lead2@example.com', 'member') as ulead2 \gset
select tests.make_user('ev3-unlinked@example.com', 'member') as unlinked \gset
select tests.make_member('EV3-A', :'ua') as ma \gset
select tests.make_member('EV3-B', :'ub') as mb \gset
select tests.make_member('EV3-C', :'uc') as mc \gset
select tests.make_member('EV3-L2', :'ulead2') as ml2 \gset
select id as pantry from public.event_types where name = 'Food Pantry' \gset
select id as rtl from public.event_types where name = 'Right to Life' \gset

-- Fixture: one event with one shift, inserted directly (times relative to now()).
create or replace function tests.ev_shift(p_type uuid, p_starts timestamptz, p_hours numeric, p_capacity integer, p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_shift uuid;
begin
  insert into public.events (type_id, title, starts_at, ends_at, lead_member_id)
  values (p_type, 'Fixture', p_starts, p_starts + p_hours * interval '1 hour', p_lead) returning id into v_event;
  insert into public.event_shifts (event_id, starts_at, ends_at, capacity)
  values (v_event, p_starts, p_starts + p_hours * interval '1 hour', p_capacity) returning id into v_shift;
  return v_shift;
end $$;
grant execute on function tests.ev_shift(uuid, timestamptz, numeric, integer, uuid) to authenticated;

-- Fixtures: public.event_signups is deliberately not directly readable by
-- authenticated (events_schema.test.sql: "sign-ups are not directly
-- readable" holds even for an administrator), so the rest of this test reads
-- signup ids/hours/counts through these security definer helpers instead of
-- querying the table directly. The active-signup filter mirrors the unique
-- index on (shift_id, member_id) where status <> 'cancelled', so it always
-- names the one current sign-up for that member on that shift.
create or replace function tests.signup_id(p_shift uuid, p_member uuid)
returns uuid language sql security definer set search_path = '' as $$
  select id from public.event_signups where shift_id = p_shift and member_id = p_member and status <> 'cancelled'
$$;
create or replace function tests.signup_hours(p_shift uuid, p_member uuid)
returns numeric language sql security definer set search_path = '' as $$
  select hours from public.event_signups where shift_id = p_shift and member_id = p_member and status <> 'cancelled'
$$;
create or replace function tests.signup_count(p_shift uuid, p_status text)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::int from public.event_signups where shift_id = p_shift and status = p_status::public.signup_status
$$;
grant execute on function tests.signup_id(uuid, uuid) to authenticated;
grant execute on function tests.signup_hours(uuid, uuid) to authenticated;
grant execute on function tests.signup_count(uuid, text) to authenticated;

select tests.ev_shift(:'pantry', now() + interval '1 day', 2.5, 2, :'ma') as future \gset
select tests.ev_shift(:'pantry', now() - interval '3 hours', 2.5, 2, :'ma') as past \gset
select tests.ev_shift(:'rtl', now() - interval '5 hours', 2, 5, :'ml2') as past_rtl \gset
select event_id as future_event from public.event_shifts where id = :'future' \gset
select event_id as past_event from public.event_shifts where id = :'past' \gset

-- sign up
select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_signup(%L) $$, :'future'), 'A signs up');
select throws_ok(format($$ select public.event_signup(%L) $$, :'future'),
  'P0001', 'You are already signed up for this shift.', 'no double sign-up');
select tests.act_as(:'ub');
select lives_ok(format($$ select public.event_signup(%L) $$, :'future'), 'B signs up');
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_signup(%L) $$, :'future'), 'P0001', 'This shift is full.', 'C is refused: full');
select throws_ok(format($$ select public.event_signup(%L) $$, :'past'), 'P0001', 'This shift has already started.', 'no sign-up after start');
select tests.act_as(:'unlinked');
select throws_ok(format($$ select public.event_signup(%L) $$, :'future'),
  'P0001', 'Your sign-in is not linked to a council member record.', 'unlinked user refused');

-- cancel and re-sign
select tests.act_as(:'ub');
select lives_ok(format($$ select public.event_cancel_signup(%L) $$,
  tests.signup_id(:'future', :'mb')), 'B cancels');
select lives_ok(format($$ select public.event_signup(%L) $$, :'future'), 'B signs up again after cancelling');
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_cancel_signup(%L) $$,
  tests.signup_id(:'future', :'ma')), '42501', 'forbidden',
  'C cannot cancel A');

-- cancelled event
select tests.act_as_service();
update public.events set status = 'cancelled' where id = (select event_id from public.event_shifts where id = :'past_rtl');
select tests.act_as(:'uc');
select tests.act_as_service();
select tests.ev_shift(:'pantry', now() + interval '2 days', 1, 3, null) as later \gset
update public.events set status = 'cancelled' where id = (select event_id from public.event_shifts where id = :'later');
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_signup(%L) $$, :'later'), 'P0001', 'This event has been cancelled.', 'no sign-up on a cancelled event');

-- walk-ins and attendance on the past shift (lead = A)
select tests.act_as(:'uc');
select throws_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'mc'), '42501', 'forbidden', 'a member cannot add walk-ins');
select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'mb'), 'lead adds B');
select lives_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'mc'), 'lead adds C');
select lives_ok(format($$ select public.event_add_volunteer(%L, %L) $$, :'past', :'ma'), 'lead adds self beyond capacity');
select is(tests.signup_count(:'past', 'signed_up'), 3, 'walk-ins ignore capacity');

select lives_ok(format($$ select public.event_set_attendance(%L, 'attended') $$,
  tests.signup_id(:'past', :'mb')), 'B attended, default hours');
select is(tests.signup_hours(:'past', :'mb'), 2.50, 'default hours are the shift length');
select lives_ok(format($$ select public.event_set_attendance(%L, 'attended', 1.75) $$,
  tests.signup_id(:'past', :'ma')), 'A attended 1.75');
select lives_ok(format($$ select public.event_set_attendance(%L, 'no_show') $$,
  tests.signup_id(:'past', :'mc')), 'C no-show');
select is(tests.signup_hours(:'past', :'mc'), null, 'no-show has no hours');
select throws_ok(format($$ select public.event_set_attendance(%L, 'attended', 1.1) $$,
  tests.signup_id(:'past', :'mc')),
  'P0001', 'Hours must be between 0 and 24, in quarter hours', 'quarter hours only');
select throws_ok(format($$ select public.event_set_attendance(%L, 'attended') $$,
  tests.signup_id(:'future', :'ma')),
  'P0001', 'Attendance can be taken once the shift has started.', 'no attendance before start');
select tests.act_as(:'ulead2');
select throws_ok(format($$ select public.event_set_attendance(%L, 'attended') $$,
  tests.signup_id(:'past', :'mb')), '42501', 'forbidden',
  'another event''s lead cannot take this attendance');
select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_cancel_signup(%L) $$,
  tests.signup_id(:'future', :'mb')), 'the lead cancels a sign-up on their event');

-- hours: attended only, scheduled events only
select tests.act_as_service();
insert into public.event_signups (shift_id, member_id, status, hours) values (:'past_rtl', :'ma', 'attended', 3);
select is((kit.my_volunteering_at(:'ma', now())->>'yearHours')::numeric, 1.75, 'a cancelled event''s hours do not count');
select is((kit.my_volunteering_at(:'mb', now())->>'allTimeHours')::numeric, 2.50, 'B has 2.5 hours');
select is(jsonb_array_length(kit.my_volunteering_at(:'ma', now())->'upcoming'), 1, 'A has one upcoming shift');
select is(jsonb_array_length(kit.my_volunteering_at(:'ma', now())->'byCategory'), 4, 'all four categories listed');
select tests.act_as(:'unlinked');
select is(public.my_volunteering(), '{"linked": false}'::jsonb, 'unlinked sign-in');

-- report
select tests.act_as(:'ua');
select throws_ok($$ select public.volunteer_report(2040) $$, '42501', 'forbidden', 'a member cannot read the report');
select tests.act_as(:'admin');
select throws_ok($$ select public.volunteer_report(1999) $$, 'P0001', null, 'year is validated');
select tests.act_as_service();
select tests.ev_shift(:'pantry', now() - interval '6 hours', 1, 2, :'ma') as pending_shift \gset
insert into public.event_signups (shift_id, member_id) values (:'pending_shift', :'mc');

-- These fixtures are freshly created (fresh event, shift and member ids), so
-- they add disjointly to whatever the baseline already counted: the deltas
-- below are exact regardless of real attended events elsewhere this year.
select is((kit.volunteer_report_at(:'fy', now())->'totals'->>'hours')::numeric,
  (:'base_report'::jsonb->'totals'->>'hours')::numeric + 4.25, 'total confirmed hours (delta)');
select is((kit.volunteer_report_at(:'fy', now())->'totals'->>'volunteers')::int,
  (:'base_report'::jsonb->'totals'->>'volunteers')::int + 2, 'two more volunteers (delta)');
select is((kit.volunteer_report_at(:'fy', now())->'totals'->>'events')::int,
  (:'base_report'::jsonb->'totals'->>'events')::int + 1, 'one more event held (delta)');
select is((select (c->>'hours')::numeric from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'byCategory') c
           where c->>'category' = 'community'),
  coalesce((select (c->>'hours')::numeric from jsonb_array_elements(:'base_report'::jsonb->'byCategory') c
             where c->>'category' = 'community'), 0) + 4.25,
  'community hours (delta)');
select is((select (c->>'hours')::numeric from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'byCategory') c
           where c->>'category' = 'life'),
  coalesce((select (c->>'hours')::numeric from jsonb_array_elements(:'base_report'::jsonb->'byCategory') c
             where c->>'category' = 'life'), 0),
  'the cancelled Life event counts nothing (unchanged from baseline)');
select is((select (m->>'hours')::numeric from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'byMember') m
           where m->>'membershipNumber' = 'EV3-B'), 2.50, 'B by member');
select is((select (p->>'waiting')::int from jsonb_array_elements(kit.volunteer_report_at(:'fy', now())->'pending') p
           where p->>'shiftId' = :'pending_shift'), 1, 'attendance not taken is listed');

select * from finish();
rollback;
