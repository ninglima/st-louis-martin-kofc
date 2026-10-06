begin;
\ir helpers/dues_fixtures.inc
select plan(8);

select tests.make_user('mi-admin@example.com', 'administrator') as admin \gset
select tests.make_user('mi-knight@example.com', 'member') as knight \gset
select tests.make_user('mi-open@example.com', 'member') as open_user \gset
select tests.make_user('mi-taken@example.com', 'member') as taken \gset
update auth.users set email_confirmed_at = null where id = :'open_user';

select tests.make_member('MI-0001') as unlinked \gset
select tests.make_member('MI-0002', :'taken') as holder \gset
select tests.make_member('MI-0003') as other \gset

select tests.act_as(:'knight');
select throws_ok(
  format($$ select public.member_link_sign_in(%L, %L) $$, :'unlinked', :'open_user'),
  '42501', 'insufficient_privilege',
  'linking a sign-in needs users.manage');

select tests.act_as(:'admin');
select lives_ok(
  format($$ select public.member_link_sign_in(%L, %L) $$, :'unlinked', :'open_user'),
  'an administrator links an unconfirmed sign-in');
select is(
  (select user_id from public.members where id = :'unlinked'),
  :'open_user'::uuid,
  'the member row points at that sign-in');
select lives_ok(
  format($$ select public.member_link_sign_in(%L, %L) $$, :'unlinked', :'open_user'),
  'linking the same sign-in again is a no-op');
select throws_ok(
  format($$ select public.member_link_sign_in(%L, %L) $$, :'other', :'taken'),
  'P0001', 'sign-in already belongs to another member',
  'a sign-in cannot move onto a second member');
select throws_ok(
  format($$ select public.member_link_sign_in(%L, %L) $$, gen_random_uuid(), :'open_user'),
  'P0001', 'unknown member',
  'an unknown member is refused');

select results_eq(
  format($$ select user_id::text, confirmed
             from public.member_sign_in_status(array[%L, %L]::uuid[])
            order by confirmed, user_id::text $$, :'open_user', :'admin'),
  format($$ values (%L, false), (%L, true) $$, :'open_user', :'admin'),
  'confirmed and unconfirmed logins are reported');

select tests.act_as(:'knight');
select is_empty(
  format($$ select * from public.member_sign_in_status(array[%L]::uuid[]) $$, :'admin'),
  'members.view is required to read sign-in status');

select * from finish();
rollback;
