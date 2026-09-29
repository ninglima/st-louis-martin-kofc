begin;
\ir helpers/dues_fixtures.inc
select plan(40);

select tests.make_user('dn-admin@example.com', 'administrator') as admin \gset
select tests.make_user('dn-knight@example.com', 'member') as knight \gset

-- a member paid through today + p_offset (period start = end - 365)
create or replace function tests.dn_member(p_number text, p_offset integer, p_today date default '2040-10-15')
returns uuid language plpgsql as $$
declare v_id uuid := tests.make_member(p_number);
begin
  insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
  values (v_id, 'regular_contrib', 0, 'waived', p_today + p_offset - 365, p_today + p_offset - 365, p_today + p_offset);
  return v_id;
end $$;

-- window edges (today = 2040-10-15; c = today + offset)
select tests.dn_member('DN-P31', 31);   -- c-31: nothing
select tests.dn_member('DN-P30', 30);   -- c-30: before_30
select tests.dn_member('DN-P01', 1);    -- c-1:  before_30
select tests.dn_member('DN-Z00', 0);    -- c:    due_date
select tests.dn_member('DN-M07', -7);   -- c+7:  due_date
select tests.dn_member('DN-M08', -8);   -- c+8:  nothing
select tests.dn_member('DN-M29', -29);  -- c+29: nothing
select tests.dn_member('DN-M30', -30);  -- c+30: after_30
select tests.dn_member('DN-M37', -37);  -- c+37: after_30
select tests.dn_member('DN-M38', -38);  -- c+38: nothing

-- 1
select results_eq(
  $$select membership_number, kind::text from kit.dues_notice_candidates_at('2040-10-15', 'live')
     where membership_number like 'DN-%' order by membership_number$$,
  $$values ('DN-M07','due_date'), ('DN-M30','after_30'), ('DN-M37','after_30'),
           ('DN-P01','before_30'), ('DN-P30','before_30'), ('DN-Z00','due_date')$$,
  'each window starts and ends on the right day');

-- 2 cycle date is paid_through
select is((select cycle_date from kit.dues_notice_candidates_at('2040-10-15', 'live') where membership_number = 'DN-P30'),
          '2040-11-14'::date, 'cycle date is the paid-through date');

-- exclusions
select tests.dn_member('DN-HON', 0) as hon \gset
select tests.dn_member('DN-OPT', 0) as opt \gset
select tests.dn_member('DN-NOE', 0) as noe \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'hon', 'honorary');
select public.set_member_dues_notices(:'opt', true);
select tests.act_as_service();
update public.members set primary_email = '  ' where id = :'noe';

-- 3-6
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15', 'live') where membership_number = 'DN-HON'), 0, 'honorary members are not notified');
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15', 'live') where membership_number = 'DN-OPT'), 0, 'opted-out members are not notified');
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15', 'live') where membership_number = 'DN-NOE'), 0, 'members without an email are not candidates');
select is((select kind::text from kit.dues_notice_due_at('2040-10-15') where membership_number = 'DN-NOE'), 'due_date',
          'but they are still due a notice (for the could-not-notify list)');

-- 7 a member who paid (cycle moved) gets nothing for the old date
select tests.dn_member('DN-PAID', 0) as paid \gset
insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
values (:'paid', 'regular_contrib', 5800, 'cash', '2040-10-10', '2040-10-15', '2040-10-15'::date + 365);
select is((select count(*)::int from kit.dues_notice_candidates_at('2040-10-15', 'live') where membership_number = 'DN-PAID'), 0,
          'paying moves the cycle date out of every window');

-- 8-9 first dues and future acceptance
select tests.make_member('DN-NEW') as newm \gset
select tests.make_member('DN-FUT') as fut \gset
select tests.act_as(:'admin');
select public.set_member_accepted_on(:'newm', '2040-10-12');
select public.set_member_accepted_on(:'fut', '2040-10-20');
select tests.act_as_service();
select results_eq($$select kind::text, first_dues from kit.dues_notice_candidates_at('2040-10-15', 'live') where membership_number = 'DN-NEW'$$,
                  $$values ('due_date', true)$$, 'a new member is due their first dues from the acceptance date');
select is((select count(*)::int from kit.dues_notice_due_at('2040-10-15') where membership_number = 'DN-FUT'), 0,
          'a member accepted in the future is never notified');

-- a member with neither paid_through nor accepted_on is never due
select tests.make_member('DN-NONE');
select is((select count(*)::int from kit.dues_notice_due_at('2040-10-15') where membership_number = 'DN-NONE'), 0,
          'a member with neither paid_through nor accepted_on is never due');

-- 10-13 claim: dry run, once only
select is((select count(*)::int from kit.dues_notices_claim_at('dry_run', '2040-10-15') where email ilike 'dn-%'), 7,
          'dry run claims every candidate with an email (6 edges + the new member)');
select is((select count(*)::int from public.dues_notices n join public.members m on m.id = n.member_id
            where m.membership_number like 'DN-%' and n.status = 'dry_run' and n.mode = 'dry_run'), 7, 'stored as dry_run');
select is((select count(*)::int from kit.dues_notices_claim_at('dry_run', '2040-10-15') where email ilike 'dn-%'), 0,
          'a second claim the same day returns nothing');
select throws_ok($$select * from kit.dues_notices_claim_at('loud', '2040-10-15')$$, 'P0001', 'unknown dues notice mode: loud', 'mode validated');

-- dry-run and live are separate ledgers: a dry-run claim must not consume
-- the live slot, and vice versa
select tests.dn_member('DN-BOTH', 3);
select count(*) from kit.dues_notices_claim_at('dry_run', '2040-10-15') where email = 'DN-BOTH@example.com';
select is((select count(*)::int from kit.dues_notices_claim_at('live', '2040-10-15') where email = 'DN-BOTH@example.com'), 1,
          'a live claim the same day still returns a member already claimed as dry-run');
select is((select count(*)::int from kit.dues_notices_claim_at('live', '2040-10-15') where email = 'DN-BOTH@example.com'), 0,
          'a second live claim the same day returns nothing');

-- 14 live claim stores pending
select tests.dn_member('DN-LIVE', 5);
select notice_id as n0 from kit.dues_notices_claim_at('live', '2040-10-15') where email = 'DN-LIVE@example.com' \gset
select is((select status from public.dues_notices where id = :'n0'),
          'pending', 'live claims start pending');

-- 15-19 tracking order
select id as n1 from public.dues_notices n where n.member_id = (select id from public.members where membership_number = 'DN-LIVE') \gset
update public.dues_notices set status = 'sent', resend_email_id = 're_1', sent_at = now() where id = :'n1';
select is(kit.dues_notice_tracking(:'n1'), 'sent', 'sent with no events');
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n1', 'delivered', now(), 'svx-1');
select is(kit.dues_notice_tracking(:'n1'), 'delivered', 'delivered');
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n1', 'opened', now(), 'svx-2'), (:'n1', 'clicked', now(), 'svx-3');
select is(kit.dues_notice_tracking(:'n1'), 'clicked', 'clicked beats opened');
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n1', 'bounced', now(), 'svx-4');
select is(kit.dues_notice_tracking(:'n1'), 'bounced', 'bounced beats clicked');
select throws_ok($$insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id)
                   select id, 'opened', now(), 'svx-1' from public.dues_notices limit 1$$,
                 '23505', null, 'the same webhook message is stored once');

-- complained tracking (a separate notice, so DN-LIVE's bounced state below is untouched)
select tests.dn_member('DN-COMP', 5);
select notice_id as n2 from kit.dues_notices_claim_at('live', '2040-10-15') where email = 'DN-COMP@example.com' \gset
update public.dues_notices set status = 'sent', resend_email_id = 're_2', sent_at = now() where id = :'n2';
insert into public.dues_notice_events (notice_id, type, occurred_at, svix_id) values (:'n2', 'complained', now(), 'svx-5');
select is(kit.dues_notice_tracking(:'n2'), 'complained', 'complained tracking');

-- 20-21 could-not-notify (core, pinned to the fixture date)
select is((select reason from kit.dues_notices_unreachable_at('2040-10-15') where membership_number = 'DN-NOE'), 'no_email',
          'could-not-notify lists members without an email');
select is((select reason from kit.dues_notices_unreachable_at('2040-10-15') where membership_number = 'DN-LIVE'), 'bounced',
          'could-not-notify lists members whose last notice bounced');

-- fixing the bounced address removes the member from could-not-notify
update public.members set primary_email = 'DN-LIVE-fixed@example.com' where membership_number = 'DN-LIVE';
select is((select count(*)::int from kit.dues_notices_unreachable_at('2040-10-15') where membership_number = 'DN-LIVE'), 0,
          'fixing the email removes a member from the could-not-notify list');

-- 22-23 reads (as admin)
select id as live_member from public.members where membership_number = 'DN-LIVE' \gset
select tests.act_as(:'admin');
select is((select tracking from public.dues_last_notices(array[:'live_member'::uuid])), 'bounced',
          'last notice carries its tracking');
select is(public.member_dues_notices_opt_out(:'opt'), true, 'opt-out is readable');

-- 24-26 gates
select tests.act_as(:'knight');
select throws_ok($$select * from public.dues_notices_list()$$, '42501', 'forbidden', 'member cannot list notices');
select throws_ok(format($$select public.set_member_dues_notices(%L, false)$$, :'opt'), '42501', 'forbidden', 'member cannot opt others out');
select tests.act_as_service();
select is(has_function_privilege('authenticated', 'public.dues_notices_claim(text)', 'execute'), false,
          'claim is not callable by signed-in users');

-- 27-28 tables closed to clients
select is(has_table_privilege('authenticated', 'public.dues_notices', 'select'), false, 'no direct reads of notices');
select is(has_table_privilege('authenticated', 'public.dues_notice_events', 'insert'), false, 'no direct writes of events');

-- service_role privileges: the job and webhook write these tables directly
select is(has_table_privilege('service_role', 'public.dues_notices', 'select'), true, 'service_role can read notices');
select is(has_table_privilege('service_role', 'public.dues_notices', 'update'), true, 'service_role can update notices');
select is(has_table_privilege('service_role', 'public.dues_notice_events', 'select'), true, 'service_role can read events');
select is(has_table_privilege('service_role', 'public.dues_notice_events', 'insert'), true, 'service_role can insert events');
select is(has_table_privilege('service_role', 'public.dues_notice_runs', 'select'), true, 'service_role can read runs');
select is(has_table_privilege('service_role', 'public.dues_notice_runs', 'insert'), true, 'service_role can insert runs');
select is(has_table_privilege('service_role', 'public.dues_notices', 'delete'), false, 'service_role cannot delete notices');

select * from finish();
rollback;
