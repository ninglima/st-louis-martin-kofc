begin;
\ir helpers/dues_fixtures.inc
select no_plan();

-- The local DB holds real data: every assertion below is filtered to the
-- fixtures created here, never to whole-table counts.

select tests.make_user('em-admin@example.com', 'administrator') as admin \gset
select tests.make_user('em-lead@example.com', 'member') as ulead \gset
select tests.make_user('em-a@example.com', 'member') as ua \gset
select tests.make_user('em-b@example.com', 'member') as ub \gset
select tests.make_user('em-c@example.com', 'member') as uc \gset
select tests.make_user('em-plain@example.com', 'member') as uplain \gset
select tests.make_user('em-unlinked@example.com', 'member') as unlinked \gset
select tests.make_member('EM-LEAD', :'ulead') as mlead \gset
select tests.make_member('EM-A', :'ua') as ma \gset
select tests.make_member('EM-B', :'ub') as mb \gset
select tests.make_member('EM-C', :'uc') as mc \gset
select tests.make_member('EM-PLAIN', :'uplain') as mplain \gset
select tests.make_member('EM-WALKIN') as mwalk \gset
select id as pantry from public.event_types where name = 'Food Pantry' \gset

-- Direct fixture: an event with one shift (times given explicitly).
create or replace function tests.em_shift(p_starts timestamptz, p_lead uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_shift uuid;
begin
  insert into public.events (type_id, title, starts_at, ends_at, lead_member_id)
  values ((select id from public.event_types where name = 'Food Pantry'), 'Fixture', p_starts, p_starts + interval '2 hours', p_lead)
  returning id into v_event;
  insert into public.event_shifts (event_id, starts_at, ends_at, capacity)
  values (v_event, p_starts, p_starts + interval '2 hours', 20) returning id into v_shift;
  return v_shift;
end $$;
grant execute on function tests.em_shift(timestamptz, uuid) to authenticated;

-- Row counts for the outbox, readable by whoever the session currently is.
create or replace function tests.em_count(p_signup uuid, p_where text default 'true')
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  execute format('select count(*)::int from public.event_emails where signup_id = %L and (%s)', p_signup, p_where) into v;
  return v;
end $$;
create or replace function tests.em_val(p_signup uuid, p_col text, p_where text default 'true')
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  execute format('select %I::text from public.event_emails where signup_id = %L and (%s) order by created_at, sequence limit 1', p_col, p_signup, p_where) into v;
  return v;
end $$;
create or replace function tests.em_signup(p_shift uuid, p_member uuid)
returns uuid language sql security definer set search_path = '' as $$
  select id from public.event_signups where shift_id = p_shift and member_id = p_member order by created_at desc limit 1
$$;
grant execute on function tests.em_count(uuid, text) to authenticated;
grant execute on function tests.em_val(uuid, text, text) to authenticated;
grant execute on function tests.em_signup(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmations
-- ---------------------------------------------------------------------------
select tests.act_as(:'admin');
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Pantry', 'location', 'Hall',
    'date', '2040-10-06', 'start_time', '09:00', 'end_time', '12:00', 'lead_member_id', :'mlead',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','12:00','capacity',10)))::jsonb)
  ->'eventIds'->>0) as e1 \gset
select id as s1 from public.event_shifts where event_id = :'e1' \gset

select tests.act_as(:'ua');
select lives_ok(format($$ select public.event_signup(%L) $$, :'s1'), 'A signs up');
select tests.act_as(:'ub');
select lives_ok(format($$ select public.event_signup(%L) $$, :'s1'), 'B signs up');
select tests.act_as(:'uc');
select lives_ok(format($$ select public.event_signup(%L) $$, :'s1'), 'C signs up');
select tests.act_as_service();
select tests.em_signup(:'s1', :'ma') as sga \gset
select tests.em_signup(:'s1', :'mb') as sgb \gset
select tests.em_signup(:'s1', :'mc') as sgc \gset

select is(tests.em_count(:'sga'), 1, 'a self sign-up creates exactly one email row');
select is(tests.em_val(:'sga', 'kind'), 'confirmation', 'it is a confirmation');
select is(tests.em_val(:'sga', 'status'), 'pending', 'it is pending');
select is(tests.em_val(:'sga', 'sequence'), '0', 'with sequence 0');

-- a lead adding a volunteer queues nothing
select tests.act_as_service();
select tests.em_shift(now() + interval '2 days', :'mlead') as s2 \gset
select tests.act_as(:'ulead');
select public.event_add_volunteer(:'s2', :'mwalk') as walk_signup \gset
select tests.act_as_service();
select is(tests.em_count(:'walk_signup'), 0, 'event_add_volunteer by a lead creates no email row');

-- the suppression switch
select tests.em_shift(now() + interval '3 days', :'mlead') as s3 \gset
select tests.act_as(:'ub');
select set_config('kit.suppress_event_emails', 'on', true);
select public.event_signup(:'s3') as sup_signup \gset
select set_config('kit.suppress_event_emails', '', true);
select tests.act_as_service();
select is(tests.em_count(:'sup_signup'), 0, 'a suppressed self sign-up creates no row');

-- ---------------------------------------------------------------------------
-- Change enqueue
-- ---------------------------------------------------------------------------
-- title-only edit: nothing
select tests.act_as(:'admin');
select lives_ok(format($$ select public.event_update(%L, '{"title":"x"}') $$, :'e1'), 'title-only edit');
select tests.act_as_service();
select is(tests.em_count(:'sga') + tests.em_count(:'sgb') + tests.em_count(:'sgc'), 3, 'a title-only edit creates no row');

-- confirmations go out, and C cancels
-- (created_at is back-dated: in one transaction now() ties, and the status read orders by it)
update public.event_emails set status = 'sent', sent_at = now(), created_at = now() - interval '1 hour'
 where signup_id in (:'sga', :'sgb', :'sgc');
select tests.act_as(:'uc');
select public.event_cancel_signup(:'sgc');

-- location change
select tests.act_as(:'admin');
select lives_ok(format($$ select public.event_update(%L, '{"location":"Annex"}') $$, :'e1'), 'location change');
select tests.act_as_service();
select is(tests.em_count(:'sga', $$kind = 'update' and status = 'pending'$$), 1, 'location change: one update for A');
select is(tests.em_count(:'sgb', $$kind = 'update' and status = 'pending'$$), 1, 'location change: one update for B');
select is(tests.em_count(:'sgc', $$kind <> 'confirmation'$$), 0, 'a cancelled sign-up gets no update');
select is(tests.em_val(:'sga', 'sequence', $$kind = 'update'$$), '1', 'the update has sequence 1');

select tests.act_as(:'admin');
select public.event_update(:'e1', '{"location":"Hall B"}');
select tests.act_as_service();
select is(tests.em_count(:'sga', $$status = 'pending'$$), 1, 'a second location change leaves one pending row for A');
select is(tests.em_count(:'sgb', $$status = 'pending'$$), 1, 'a second location change leaves one pending row for B');
select is(tests.em_count(:'sga', $$kind = 'update'$$), 1, 'and the same row is reused');

-- date move: shifts move, still one pending row each
select tests.act_as(:'admin');
select lives_ok(format($$ select public.event_update(%L, '{"date":"2040-10-13"}', 'this') $$, :'e1'), 'date move');
select tests.act_as_service();
select is(tests.em_count(:'sga', $$status = 'pending'$$), 1, 'date move: one pending row for A');
select is(tests.em_count(:'sgb', $$status = 'pending'$$), 1, 'date move: one pending row for B');
select is(tests.em_count(:'sgc', $$kind <> 'confirmation'$$), 0, 'date move: nothing for the cancelled sign-up');

-- email status (read-side for leads), before any claim touches these rows
select tests.act_as(:'uplain');
select throws_ok(format($$ select * from public.event_email_status(%L) $$, :'e1'), '42501', 'forbidden',
  'a plain member cannot read the email status');
select tests.act_as(:'ulead');
select is((select count(*)::int from public.event_email_status(:'e1')), 3, 'the lead sees one status row per sign-up');
select is((select tracking from public.event_email_status(:'e1') where signup_id = :'sga'), 'pending', 'A has a pending change');
select is((select tracking from public.event_email_status(:'e1') where signup_id = :'sgc'), 'sent', 'C shows the sent confirmation');
select tests.act_as_service();
insert into public.event_email_events (email_id, type, occurred_at, svix_id, payload)
select id, 'delivered', now(), 'em-svix-1', '{}'::jsonb from public.event_emails
 where signup_id = :'sgc' and kind = 'confirmation';
select tests.act_as(:'ulead');
select is((select tracking from public.event_email_status(:'e1') where signup_id = :'sgc'), 'delivered',
  'a delivered event makes the tracking delivered');

-- cancel: the pending row becomes a cancel; later shift saves add nothing
select tests.act_as(:'admin');
select lives_ok(format($$ select public.event_update(%L, '{"status":"cancelled"}') $$, :'e1'), 'cancel the event');
select tests.act_as_service();
select is(tests.em_val(:'sga', 'kind', $$status = 'pending'$$), 'cancel', 'the pending row for A becomes a cancel');
select is(tests.em_val(:'sgb', 'kind', $$status = 'pending'$$), 'cancel', 'the pending row for B becomes a cancel');
select is(tests.em_count(:'sga') + tests.em_count(:'sgb'), 4, 'two rows each, confirmation and cancel');
select tests.act_as(:'admin');
select lives_ok(format($$ select public.event_shifts_save(%L, %L::jsonb) $$, :'e1',
  json_build_array(json_build_object('id', :'s1', 'start_time','10:00','end_time','12:00','capacity',10))), 'shift save on a cancelled event');
select tests.act_as_service();
select is((select start_time from (select (starts_at at time zone 'America/Chicago')::time as start_time from public.event_shifts where id = :'s1') t),
  '10:00:00'::time, 'the shift really moved');
select is(tests.em_count(:'sga') + tests.em_count(:'sgb'), 4, 'a shift save on a cancelled event adds no update');
select is(tests.em_count(:'sga', $$kind = 'update'$$) + tests.em_count(:'sgb', $$kind = 'update'$$), 0, 'and no update row exists');

-- series: cancel "following" from the second date notifies only later sign-ups
select tests.act_as(:'admin');
select (public.event_create(json_build_object('type_id', :'pantry', 'title', 'Tuesday pantry',
    'date', '2040-10-30', 'start_time', '09:00', 'end_time', '11:00',
    'shifts', json_build_array(json_build_object('start_time','09:00','end_time','11:00','capacity',4)),
    'repeat', json_build_object('freq','weekly','interval',1,'weekdays',json_build_array(2),'until','2040-11-13'))::jsonb)
  ->>'seriesId') as series \gset
select tests.act_as_service();
select id as ev1 from public.events where series_id = :'series' order by starts_at limit 1 \gset
select id as ev2 from public.events where series_id = :'series' order by starts_at offset 1 limit 1 \gset
select id as ev3 from public.events where series_id = :'series' order by starts_at offset 2 limit 1 \gset
select id as sh1 from public.event_shifts where event_id = :'ev1' \gset
select id as sh2 from public.event_shifts where event_id = :'ev2' \gset
select id as sh3 from public.event_shifts where event_id = :'ev3' \gset
select tests.act_as(:'ua');
select public.event_signup(:'sh1');
select public.event_signup(:'sh2');
select public.event_signup(:'sh3');
select tests.act_as_service();
select tests.em_signup(:'sh1', :'ma') as r1 \gset
select tests.em_signup(:'sh2', :'ma') as r2 \gset
select tests.em_signup(:'sh3', :'ma') as r3 \gset
update public.event_emails set status = 'sent', sent_at = now() where signup_id in (:'r1', :'r2', :'r3');
select tests.act_as(:'admin');
select public.event_update(:'ev2', '{"status":"cancelled"}', 'following');
select tests.act_as_service();
select is(tests.em_count(:'r1', $$kind <> 'confirmation'$$), 0, 'series: the first date is not notified');
select is(tests.em_count(:'r2', $$kind = 'cancel' and status = 'pending'$$), 1, 'series: the second date is notified');
select is(tests.em_count(:'r3', $$kind = 'cancel' and status = 'pending'$$), 1, 'series: the third date is notified');

-- an unsent confirmation absorbs changes
select tests.act_as_service();
select tests.em_shift(now() + interval '5 days', :'mlead') as s4 \gset
select event_id as e4 from public.event_shifts where id = :'s4' \gset
select tests.act_as(:'ua');
select public.event_signup(:'s4') as sg4 \gset
select tests.act_as(:'admin');
select public.event_update(:'e4', '{"location":"Somewhere else"}');
select tests.act_as_service();
select is(tests.em_count(:'sg4'), 1, 'a change before the confirmation is sent queues nothing');

-- ---------------------------------------------------------------------------
-- Claim
-- ---------------------------------------------------------------------------
-- A: normal (dry run); B: signed up then cancelled; C: no email
select tests.make_user('em-cl-a@example.com', 'member') as ucla \gset
select tests.make_user('em-cl-b@example.com', 'member') as uclb \gset
select tests.make_user('em-cl-c@example.com', 'member') as uclc \gset
select tests.make_user('em-cl-d@example.com', 'member') as ucld \gset
select tests.make_user('em-cl-e@example.com', 'member') as ucle \gset
select tests.make_member('EM-CL-A', :'ucla') as mcla \gset
select tests.make_member('EM-CL-B', :'uclb') as mclb \gset
select tests.make_member('EM-CL-C', :'uclc') as mclc \gset
select tests.make_member('EM-CL-D', :'ucld') as mcld \gset
select tests.make_member('EM-CL-E', :'ucle') as mcle \gset
update public.members set primary_email = '  ' where id = :'mclc';

select tests.em_shift(now() + interval '2 days') as cs \gset
select tests.act_as(:'ucla'); select public.event_signup(:'cs');
select tests.act_as(:'uclb'); select public.event_signup(:'cs');
select tests.act_as(:'uclc'); select public.event_signup(:'cs');
select tests.act_as_service();
select tests.em_signup(:'cs', :'mcla') as ca \gset
select tests.em_signup(:'cs', :'mclb') as cb \gset
select tests.em_signup(:'cs', :'mclc') as cc \gset
select tests.act_as(:'uclb'); select public.event_cancel_signup(:'cb');
select tests.act_as_service();

create temp table claimed as select * from kit.event_emails_claim_at('dry_run', 1000, now());
select is((select count(*)::int from claimed where signup_id = :'ca'), 1, 'dry run: the normal row is returned');
select is(tests.em_val(:'ca', 'status'), 'dry_run', 'dry run: status dry_run');
select is(tests.em_val(:'ca', 'mode'), 'dry_run', 'dry run: mode dry_run');
select is((select first_name from claimed where signup_id = :'ca'), 'Test', 'dry run: first name is returned');
select is((select email from claimed where signup_id = :'ca'), 'EM-CL-A@example.com', 'dry run: email is returned');
select is((select shift_starts_at from claimed where signup_id = :'ca'), (select starts_at from public.event_shifts where id = :'cs'),
  'dry run: shift start is returned');
select is((select shift_ends_at from claimed where signup_id = :'ca'), (select ends_at from public.event_shifts where id = :'cs'),
  'dry run: shift end is returned');
select is((select mode from claimed where signup_id = :'ca'), 'dry_run', 'dry run: the returned mode is dry_run');
select is(tests.em_val(:'cb', 'status'), 'superseded', 'a cancelled sign-up is superseded');
select is((select count(*)::int from claimed where signup_id = :'cb'), 0, 'and not returned');
select is(tests.em_val(:'cc', 'status'), 'no_email', 'a blank email gives no_email');
select is((select count(*)::int from claimed where signup_id = :'cc'), 0, 'and is not returned');

-- expiry
select tests.act_as(:'ucle'); select public.event_signup(:'cs');
select tests.act_as_service();
select tests.em_signup(:'cs', :'mcle') as ce \gset
select count(*) from kit.event_emails_claim_at('live', 1000, now() + interval '4 days');
select is(tests.em_val(:'ce', 'status'), 'expired', 'a stale pending row expires');

-- live claim and reclaim
select tests.act_as(:'ucld'); select public.event_signup(:'cs');
select tests.act_as_service();
select tests.em_signup(:'cs', :'mcld') as cd \gset
create temp table claimed_live as select * from kit.event_emails_claim_at('live', 1000, now());
select is(tests.em_val(:'cd', 'status'), 'sending', 'live: status sending');
select is(tests.em_val(:'cd', 'attempts'), '1', 'live: attempts 1');
select is(tests.em_val(:'cd', 'mode'), 'live', 'live: mode live');
select is((select mode from claimed_live where signup_id = :'cd'), 'live', 'live: the returned mode is live');
select is((select count(*)::int from claimed_live where signup_id = :'cd'), 1, 'live: the row is returned');
update public.event_emails set claimed_at = now() - interval '11 minutes' where signup_id = :'cd';
select is((select count(*)::int from kit.event_emails_claim_at('live', 1000, now()) where signup_id = :'cd'), 1,
  'a stuck sending row is reclaimed');
select is(tests.em_val(:'cd', 'attempts'), '2', 'reclaim: attempts 2');

-- ---------------------------------------------------------------------------
-- Reminders (DST week: clocks fall back on 2040-11-04)
-- ---------------------------------------------------------------------------
select tests.make_user('em-r1@example.com', 'member') as ur1 \gset
select tests.make_user('em-r2@example.com', 'member') as ur2 \gset
select tests.make_user('em-r3@example.com', 'member') as ur3 \gset
select tests.make_user('em-r4@example.com', 'member') as ur4 \gset
select tests.make_user('em-r5@example.com', 'member') as ur5 \gset
select tests.make_member('EM-R1', :'ur1') as mr1 \gset
select tests.make_member('EM-R2', :'ur2') as mr2 \gset
select tests.make_member('EM-R3', :'ur3') as mr3 \gset
select tests.make_member('EM-R4', :'ur4') as mr4 \gset
select tests.make_member('EM-R5', :'ur5') as mr5 \gset
update public.members set primary_email = null where id = :'mr3';

-- opt-out
select tests.act_as(:'ur2');
select is(public.my_event_reminders(), true, 'reminders are on by default');
select public.set_my_event_reminders(true);
select is(public.my_event_reminders(), false, 'after opting out, my_event_reminders is false');
select tests.act_as(:'ur1');
select is(public.my_event_reminders(), true, 'another member is unaffected');
select tests.act_as_service();
select is((select count(*)::int from public.members where event_reminders_opt_out and id <> :'mr2'), 0,
  'opting out changes only the caller''s member row');
select tests.act_as(:'unlinked');
select is(public.my_event_reminders(), null, 'an unlinked user has no reminder setting');
select throws_ok($$ select public.set_my_event_reminders(true) $$, 'P0001',
  'Your sign-in is not linked to a council member record.', 'an unlinked user cannot set the opt-out');

select tests.act_as_service();
select tests.em_shift('2040-11-04 10:00 America/Chicago') as ra \gset
select tests.act_as(:'ur1'); select public.event_signup(:'ra');
select tests.act_as(:'ur2'); select public.event_signup(:'ra');
select tests.act_as(:'ur3'); select public.event_signup(:'ra');
select tests.act_as_service();
select tests.em_signup(:'ra', :'mr1') as sr1 \gset
select tests.em_signup(:'ra', :'mr2') as sr2 \gset
select tests.em_signup(:'ra', :'mr3') as sr3 \gset

select is(kit.event_reminders_enqueue_at('dry_run', '2040-11-03'), 1, 'dry-run reminders: one row (opted-out and no-email skipped)');
select is(tests.em_count(:'sr1', $$kind = 'reminder' and mode = 'dry_run'$$), 1, 'the eligible member gets it');
select is(tests.em_count(:'sr2', $$kind = 'reminder'$$), 0, 'an opted-out member is skipped');
select is(tests.em_count(:'sr3', $$kind = 'reminder'$$), 0, 'a member with no email is skipped');
select is(kit.event_reminders_enqueue_at('dry_run', '2040-11-03'), 0, 'calling again inserts nothing');
select is(kit.event_reminders_enqueue_at('live', '2040-11-03'), 1, 'live inserts one more row');
select is(tests.em_count(:'sr1', $$kind = 'reminder'$$), 2, 'one row per mode');
select is(tests.em_val(:'sr1', 'reminder_for', $$kind = 'reminder'$$)::timestamptz, '2040-11-04 10:00 America/Chicago'::timestamptz,
  'reminder_for is the shift start');

select tests.em_shift('2040-11-04 00:30 America/Chicago') as rb \gset
select tests.em_shift('2040-11-03 23:30 America/Chicago') as rc \gset
select tests.act_as(:'ur4'); select public.event_signup(:'rb');
select tests.act_as(:'ur5'); select public.event_signup(:'rc');
select tests.act_as_service();
select tests.em_signup(:'rb', :'mr4') as sr4 \gset
select tests.em_signup(:'rc', :'mr5') as sr5 \gset
select is(kit.event_reminders_enqueue_at('dry_run', '2040-11-03'), 1, 'only the 00:30 shift on the next Chicago day is added');
select is(tests.em_count(:'sr4', $$kind = 'reminder'$$), 1, '00:30 Chicago on d+1 is included');
select is(tests.em_count(:'sr5', $$kind = 'reminder'$$), 0, '23:30 Chicago on d is excluded');
select throws_ok($$ select kit.event_reminders_enqueue_at('off', '2040-11-03') $$, 'P0001', 'unknown mode', 'an unknown mode is refused');

-- ---------------------------------------------------------------------------
-- Locked down
-- ---------------------------------------------------------------------------
select tests.act_as(:'ua');
select throws_ok($$ select count(*) from public.event_emails $$, '42501', null, 'authenticated cannot read the outbox');
select throws_ok($$ select * from public.event_emails_claim('dry_run') $$, '42501', null, 'authenticated cannot claim');
select throws_ok($$ select public.event_reminders_enqueue('dry_run') $$, '42501', null, 'authenticated cannot enqueue reminders');

select * from finish();
rollback;
