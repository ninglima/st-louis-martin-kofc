-- Fixtures for dues tests. Included by each *.test.sql via
-- `\ir helpers/dues_fixtures.inc`; creates objects inside the caller's
-- transaction so everything rolls back. Not a test file itself: it has no
-- .sql extension so the pgTAP runner does not pick it up on its own.
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- security definer: fixtures must be able to seed data regardless of which
-- test user tests.act_as() has switched the session to (RLS on members and
-- auth.users otherwise blocks these inserts once the role is no longer the
-- superuser connection).
create or replace function tests.make_user(p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), '{}', '{}', now(), now());
  insert into public.user_roles (user_id, role_id)
  select v_id, id from public.roles where slug = p_role
  on conflict (user_id) do update set role_id = excluded.role_id;
  return v_id;
end $$;

create or replace function tests.make_member(p_number text, p_user uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.members (membership_number, first_name, last_name, primary_email, user_id)
  values (p_number, 'Test', 'Knight ' || p_number, p_number || '@example.com', p_user)
  returning id into v_id;
  return v_id;
end $$;

-- Act as a signed-in user for RLS / auth.uid().
create or replace function tests.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- `set_config('role', ...)` is a real `SET ROLE`, so once a test has called
-- tests.act_as() to become a non-superuser, calling tests.act_as() again to
-- switch to a different user needs privilege on this schema. Without this,
-- any test that acts as a low-privilege user and then switches back to an
-- admin user in the same transaction fails with "permission denied for
-- schema tests" before it ever reaches the behaviour under test.
grant usage on schema tests to authenticated;
grant execute on function tests.act_as(uuid) to authenticated;
grant execute on function tests.make_member(text, uuid) to authenticated;
grant execute on function tests.make_user(text, text) to authenticated;
