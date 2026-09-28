-- 20260928130500_dues_table_grants: anon and authenticated hold nothing on
-- the dues tables except authenticated SELECT on dues_levels. Final review M3.
begin;
\ir helpers/dues_fixtures.inc
select plan(28);

-- 2 roles x 2 tables x 6 privileges that must be gone (24).
select ok(not has_table_privilege(r, t, p), format('%s has no %s on %s', r, p, t))
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.dues_periods', 'public.dues_levels']) t,
     unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p;

select ok(has_table_privilege('authenticated', 'public.dues_levels', 'SELECT'), 'authenticated still reads dues_levels');
select ok(not has_table_privilege('anon', 'public.dues_levels', 'SELECT'), 'anon does not read dues_levels');

-- And in practice: a signed-in member cannot truncate the ledger.
select tests.make_user('truncate@example.com', 'member') as u \gset
select tests.act_as(:'u');
select throws_ok($$ truncate public.dues_periods $$, '42501', null, 'a member cannot truncate dues_periods');
select lives_ok($$ select count(*) from public.dues_levels $$, 'a member can still list the levels');
reset role;

select * from finish();
rollback;
