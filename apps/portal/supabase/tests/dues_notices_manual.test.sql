begin;
\ir helpers/dues_fixtures.inc
select plan(12);

select tests.make_user('dn-man-admin@example.com', 'administrator') as admin \gset
select tests.make_user('dn-man-knight@example.com', 'member') as knight \gset

create or replace function tests.dn_man_member(p_number text, p_offset integer, p_today date default '2040-10-15')
returns uuid language plpgsql as $$
declare v_id uuid := tests.make_member(p_number);
begin
  insert into public.dues_periods (member_id, level, amount_cents, method, received_on, period_start, period_end)
  values (v_id, 'regular_contrib', 0, 'waived', p_today + p_offset - 365, p_today + p_offset - 365, p_today + p_offset);
  return v_id;
end $$;

-- Outside every automatic window (c+8): still eligible for a forced kind.
select tests.dn_man_member('DNM-OUT', -8) as outm \gset
select tests.dn_man_member('DNM-IN', 0) as inm \gset

-- kit helpers run as the connection role (superuser in tests), not as a
-- signed-in user. Permission gates are checked on the public wrappers below.

-- 1-2 eligible list includes outside-window members; already_sent false
select is((select count(*)::int from kit.dues_notices_manual_eligible_at('due_date', '2040-10-15')
            where membership_number in ('DNM-OUT', 'DNM-IN')), 2,
          'eligible list includes members outside the automatic window');
select is((select already_sent from kit.dues_notices_manual_eligible_at('due_date', '2040-10-15')
            where membership_number = 'DNM-OUT'), false,
          'not yet sent');

-- 3 manual claim outside window inserts pending live
select is((select count(*)::int from kit.dues_notices_manual_claim_at(
             'due_date', array[:'outm'::uuid], '2040-10-15')), 1,
          'manual claim inserts outside the window');
select is((select status from public.dues_notices n
            where n.member_id = :'outm' and n.kind = 'due_date' and n.mode = 'live'),
          'pending', 'stored as pending live');

-- 4 conflict: second claim returns nothing
select is((select count(*)::int from kit.dues_notices_manual_claim_at(
             'due_date', array[:'outm'::uuid], '2040-10-15')), 0,
          'second manual claim for the same kind+cycle returns nothing');

-- 5 eligible marks already_sent
select is((select already_sent from kit.dues_notices_manual_eligible_at('due_date', '2040-10-15')
            where membership_number = 'DNM-OUT'), true,
          'eligible list marks already sent');

-- 6 other kinds still claimable for the same cycle
select is((select count(*)::int from kit.dues_notices_manual_claim_at(
             'before_30', array[:'outm'::uuid], '2040-10-15')), 1,
          'a different kind for the same cycle still claims');

-- 7 unknown kind
select throws_ok($$select * from kit.dues_notices_manual_claim_at('loud', array[]::uuid[], '2040-10-15')$$,
                 'P0001', 'unknown dues notice kind: loud', 'kind validated');

-- 8-9 public gates
select tests.act_as(:'knight');
select throws_ok($$select * from public.dues_notices_manual_eligible('due_date')$$,
                 '42501', 'forbidden', 'member cannot list manual eligible');
select throws_ok(format($$select * from public.dues_notices_manual_claim('due_date', array[%L]::uuid[])$$, :'inm'),
                 '42501', 'forbidden', 'member cannot manual claim');

-- 10 admin can call the public wrappers
select tests.act_as(:'admin');
select lives_ok(format($$select * from public.dues_notices_manual_claim('after_30', array[%L]::uuid[])$$, :'inm'),
                'admin can manual claim via the public wrapper');

-- 11 honorary excluded from base
select tests.act_as_service();
select tests.dn_man_member('DNM-HON', 0) as hon \gset
select tests.act_as(:'admin');
select public.set_member_dues_level(:'hon', 'honorary');
select tests.act_as_service();
select is((select count(*)::int from kit.dues_notice_manual_base_at('2040-10-15')
            where membership_number = 'DNM-HON'), 0,
          'honorary members are not manually eligible');

-- 12 empty member list returns nothing
select is((select count(*)::int from kit.dues_notices_manual_claim_at(
             'due_date', array[]::uuid[], '2040-10-15')), 0,
          'empty member list claims nothing');

select * from finish();
rollback;
