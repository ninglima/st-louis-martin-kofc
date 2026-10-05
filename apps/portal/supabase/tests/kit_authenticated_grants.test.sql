-- Final review recommendation ("R4 enumeration"): pins the exact set of
-- kit-schema functions `authenticated` can execute to the set the reviewer
-- checked by hand against the live database -- council_today, dues_status,
-- fraternal_year_of, get_storage_filename_as_uuid, has_permission, plus the
-- unaccent extension functions (kit holds the "unaccent" extension; see
-- 20241219010757_schema.sql). `usage on schema kit` is granted to
-- authenticated (ruling R4 in progress.md) so kit.council_today and
-- kit.fraternal_year_of are callable from tests and, per this file, from
-- anything a member's client sends. Every *other* kit function -- including
-- every internal finance/dues/hosting helper -- must stay revoked. A future
-- kit helper that forgets its `revoke all ... from authenticated` fails this
-- test instead of relying on review.
begin;
\ir helpers/dues_fixtures.inc
select plan(1);

select set_eq(
  $$
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kit'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  $$
    values
      ('kit.council_today()'),
      ('kit.dues_status(date,date,date)'),
      ('kit.fraternal_year_of(date)'),
      ('kit.get_storage_filename_as_uuid(text)'),
      ('kit.has_permission(text,text)'),
      ('kit.unaccent(regdictionary,text)'),
      ('kit.unaccent(text)'),
      ('kit.unaccent_init(internal)'),
      ('kit.unaccent_lexize(internal,internal,internal,internal)')
  $$,
  'authenticated can execute exactly the allowed set of kit functions'
);

select * from finish();
rollback;
