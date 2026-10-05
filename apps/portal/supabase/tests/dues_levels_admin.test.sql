-- Dues levels admin (2026-10-04): finance.manage writes dues_levels only
-- through save/retire/restore, each logged to dues_level_changes.
begin;
\ir helpers/dues_fixtures.inc
select plan(36);

select tests.make_user('levels-fs@example.com', 'administrator') as fs \gset
select tests.make_user('levels-knight@example.com', 'member') as knight \gset
select tests.make_member('410001') as m1 \gset
select tests.make_member('410002') as m2 \gset

-- 1-5: permission
select tests.act_as(:'knight');
select throws_ok($$ select public.save_dues_level('X', 100, true, 1) $$, '42501', 'forbidden', 'a member cannot create a level');
select throws_ok($$ select public.save_dues_level('X', 100, true, 1, 'regular') $$, '42501', 'forbidden', 'a member cannot edit a level');
select throws_ok($$ select public.retire_dues_level('regular', 'regular_contrib') $$, '42501', 'forbidden', 'a member cannot retire a level');
select throws_ok($$ select public.restore_dues_level('regular') $$, '42501', 'forbidden', 'a member cannot restore a level');
select throws_ok($$ select * from public.dues_levels_admin() $$, '42501', 'forbidden', 'a member cannot list the admin view');
reset role;

select tests.act_as(:'fs');

-- 6-9: create, slug generation and clash suffix
select is(public.save_dues_level('  Public Service (2027)  ', 2000, false, 10), 'public_service_2027',
  'creating a level returns its slug, generated from the trimmed name');
select is((select name from public.dues_levels where slug = 'public_service_2027'), 'Public Service (2027)',
  'the name is stored trimmed');
select is(public.save_dues_level('Public-Service 2027!', 2100, false, 11), 'public_service_2027_2',
  'a clashing slug gets _2');
select is((select count(*)::int from public.dues_level_changes where level = 'public_service_2027' and action = 'create' and before is null),
  1, 'a create is logged with no before');

-- 10-14: validation
select throws_ok($$ select public.save_dues_level('regular', 100, true, 1) $$, 'P0001',
  'Another level is already named regular', 'a duplicate name is refused, ignoring case');
select throws_ok($$ select public.save_dues_level('   ', 100, true, 1) $$, 'P0001',
  'A level name is required (at most 80 characters)', 'a blank name is refused');
select throws_ok(format($$ select public.save_dues_level(%L, 100, true, 1) $$, repeat('x', 81)), 'P0001',
  'A level name is required (at most 80 characters)', 'an 81-character name is refused');
select throws_ok($$ select public.save_dues_level('Too much', 100001, true, 1) $$, 'P0001',
  'The amount must be between $0 and $1,000', 'over $1,000 is refused');
select throws_ok($$ select public.save_dues_level('Negative', -1, true, 1) $$, 'P0001',
  'The amount must be between $0 and $1,000', 'a negative amount is refused');

-- 15-18: update keeps the slug, logs before/after; a no-op logs nothing
-- (A seeded level is already named "Public Service", so the rename keeps the year.)
select is(public.save_dues_level('Public Service 2027', 2500, false, 10, 'public_service_2027'), 'public_service_2027',
  'an edit returns the same slug');
select is((select amount_cents from public.dues_levels where slug = 'public_service_2027'), 2500, 'the price changed');
select is((select (before ->> 'amount_cents')::int from public.dues_level_changes
            where level = 'public_service_2027' and action = 'update'), 2000, 'the update logs the old price');
select public.save_dues_level('Public Service 2027', 2500, false, 10, 'public_service_2027') as _noop \gset
select is((select count(*)::int from public.dues_level_changes where level = 'public_service_2027' and action = 'update'),
  1, 'saving without a change logs nothing');

-- 19: editing an unknown level
select throws_ok($$ select public.save_dues_level('Ghost', 100, true, 1, 'no_such_level') $$, 'P0001',
  'That level does not exist', 'editing an unknown level is refused');

-- 20-25: retire moves members, logs them, returns the count; zero-member retire
reset role;
update public.members set dues_level = 'public_service_2027' where id in (:'m1', :'m2');
select tests.act_as(:'fs');
select throws_ok($$ select public.retire_dues_level('public_service_2027') $$, 'P0001',
  'Choose another level to move this level''s members to', 'a target is required when members are on the level');
select throws_ok($$ select public.retire_dues_level('public_service_2027', 'public_service_2027') $$, 'P0001',
  'Choose another level to move this level''s members to', 'the level itself is not a target');
select is(public.retire_dues_level('public_service_2027', 'regular'), 2, 'retiring returns the number moved');
select is((select count(*)::int from public.members where id in (:'m1', :'m2') and dues_level = 'regular'), 2,
  'both members moved to the target');
select is((select (select array_agg(x order by x) from unnest(moved_member_ids) x)
                    = (select array_agg(x order by x) from unnest(array[:'m1'::uuid, :'m2'::uuid]) x)
                  and moved_to = 'regular'
             from public.dues_level_changes where level = 'public_service_2027' and action = 'retire'),
  true, 'the retirement logs exactly who moved and where');
select is(public.retire_dues_level('public_service_2027_2'), 0, 'a level with no members retires without a target');
select is((select row(moved_member_ids, moved_to)::text
             from public.dues_level_changes where level = 'public_service_2027_2' and action = 'retire'),
  row('{}'::uuid[], null::text)::text, 'a zero-member retire logs no members and no target');
select throws_ok($$ select public.save_dues_level('public service 2027', 100, false, 1) $$, 'P0001',
  'Another level is already named public service 2027', 'a retired level''s name is still taken');
select throws_ok($$ select public.retire_dues_level('regular_contrib', 'regular') $$, 'P0001',
  'This is the level new members start on, so it cannot be retired', 'the level new members start on cannot be retired');

-- 26-27: retired targets and re-retiring
select throws_ok($$ select public.retire_dues_level('regular', 'public_service_2027') $$, 'P0001',
  'Members can only be moved to an active level', 'a retired level is not a target');
select throws_ok($$ select public.retire_dues_level('public_service_2027', 'regular') $$, 'P0001',
  'That level is not active', 'a retired level cannot be retired again');

-- 28-29: the last self-service level stays active (retire and edit)
reset role;
update public.dues_levels set active = false where self_service and slug <> 'regular';
select tests.act_as(:'fs');
select throws_ok($$ select public.retire_dues_level('regular', 'student') $$, 'P0001',
  'At least one level members can choose must stay active', 'the last self-service level cannot be retired');
select throws_ok($$ select public.save_dues_level('Regular', 5000, false, 2, 'regular') $$, 'P0001',
  'At least one level members can choose must stay active', 'nor edited to be FS-assigned');
reset role;
update public.dues_levels set active = true where slug = 'regular_contrib';
select tests.act_as(:'fs');

-- 30-31: restore
select lives_ok($$ select public.restore_dues_level('public_service_2027') $$, 'a retired level can be restored');
select throws_ok($$ select public.restore_dues_level('public_service_2027') $$, 'P0001',
  'That level is not retired', 'an active level cannot be restored');
select is((select count(*)::int from public.dues_level_changes
            where level = 'public_service_2027' and action = 'restore' and (before ->> 'active')::boolean = false
              and (after ->> 'active')::boolean), 1, 'a restore is logged');

-- 32: the admin list includes retired levels, member counts and the last change
select is((select row(active, member_count, changed_by_email)::text from public.dues_levels_admin()
            where slug = 'public_service_2027'),
  row(true, 0, 'levels-fs@example.com')::text, 'the admin list shows status, members and who changed it last');
reset role;

select * from finish();
rollback;
