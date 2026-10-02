-- 20261004120100: a dues payment is judged against its level as it was when
-- the payment was created, so a price change or a retirement while a bank
-- payment is processing does not strand it.
begin;
\ir helpers/dues_fixtures.inc
select plan(7);

select tests.make_user('straddle-fs@example.com', 'administrator') as fs \gset
select tests.make_user('straddle-a@example.com', 'member') as ua \gset
select tests.make_user('straddle-b@example.com', 'member') as ub \gset
select tests.make_user('straddle-c@example.com', 'member') as uc \gset
select tests.make_member('420001', :'ua') as ma \gset
select tests.make_member('420002', :'ub') as mb \gset
select tests.make_member('420003', :'uc') as mc \gset
select tests.make_user('straddle-d@example.com', 'member') as ud \gset
select tests.make_member('420004', :'ud') as md \gset
update public.members set accepted_on = current_date - 10 where id in (:'ma', :'mb', :'mc', :'md');

-- An FS-assigned level for member B, so availability depends on assignment.
select tests.act_as(:'fs');
select public.save_dues_level('Straddle Honorary', 1900, false, 20) as hon \gset
reset role;
update public.members set dues_level = :'hon' where id = :'mb';

-- Three bank payments created an hour ago, still processing.
set local role service_role;
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata, created_at)
values
  ('00000000-0000-0000-0000-0000000d1001', :'ua', 'stripe', 'pi_straddle_a', 5000, 'processing', 'dues',
   '{"dues_level": "regular"}', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000d1002', :'ub', 'stripe', 'pi_straddle_b', 1900, 'processing', 'dues',
   jsonb_build_object('dues_level', :'hon'), now() - interval '1 hour');
reset role;

-- While they process: Regular goes up to $55; Straddle Honorary is retired,
-- its member moved to Regular.
select tests.act_as(:'fs');
select public.save_dues_level('Regular', 5500, true, 2, 'regular') as _priced \gset
select public.retire_dues_level(:'hon', 'regular') as _retired \gset
reset role;

-- Payment C is created after the price change, at the old price.
set local role service_role;
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-0000000d1003', :'uc', 'stripe', 'pi_straddle_c', 5000, 'processing', 'dues',
        '{"dues_level": "regular"}');

-- Payment D was created BEFORE the raise (now() - 1 hour) but charged the NEW price.
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata, created_at)
values ('00000000-0000-0000-0000-0000000d1004', :'ud', 'stripe', 'pi_straddle_d', 5500, 'processing', 'dues',
        '{"dues_level": "regular"}', now() - interval '1 hour');

update public.payments set status = 'succeeded'
 where provider_payment_id in ('pi_straddle_a', 'pi_straddle_b', 'pi_straddle_c', 'pi_straddle_d');
reset role;

select is((select count(*)::int from public.dues_periods where member_id = :'ma'), 1,
  'a payment created before a price change still records its period');
select is((select amount_cents from public.dues_periods where member_id = :'ma'), 5000,
  'at the amount actually charged');
select is((select count(*)::int from public.dues_periods where member_id = :'mb'), 1,
  'a payment on a level retired while it processed still records its period');
select is((select level from public.dues_periods where member_id = :'mb'), :'hon',
  'on the level it was paid for');
select is((select count(*)::int from public.dues_periods where member_id = :'mc'), 0,
  'a payment created after the change at the old price records nothing');

select is((select count(*)::int from public.dues_periods where member_id = :'md'), 0,
  'a payment created before the raise but charged the new price records nothing');

-- kit.dues_level_as_of stays internal
select ok(not has_function_privilege('authenticated', 'kit.dues_level_as_of(text, timestamptz)', 'EXECUTE'),
  'authenticated cannot call kit.dues_level_as_of');

select * from finish();
rollback;
