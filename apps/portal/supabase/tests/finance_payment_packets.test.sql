begin;
\ir helpers/dues_fixtures.inc
select plan(18);

select tests.make_user('frp-admin@example.com', 'administrator') as admin \gset
select tests.make_user('frp-other@example.com', 'administrator') as other \gset
select tests.make_user('frp-knight@example.com', 'member') as knight \gset

select tests.act_as(:'admin');

select id as first_id, created_by as first_by
  from public.finance_payment_packet_save(null, 'Supreme, January 2099', 175, null, '  ') \gset

select is(:'first_by'::uuid, :'admin'::uuid, 'created_by is the caller');
select ok(
  (select note is null from public.finance_payment_packets() where id = :'first_id'),
  'a blank note is stored as null');
select is(
  (select supreme_cents from public.finance_payment_packets() where id = :'first_id'),
  175,
  'a Supreme total alone is saved');

select id as second_id
  from public.finance_payment_packet_save(null, 'State, 2099', null, 0, 'state bill') \gset

select is(
  (select state_cents from public.finance_payment_packets() where id = :'second_id'),
  0,
  'a zero state total is allowed');

select is(
  (select id from public.finance_payment_packets() limit 1),
  :'second_id'::uuid,
  'the list is newest first');

select tests.act_as(:'other');
select created_by as still_by
  from public.finance_payment_packet_save(:'first_id', 'Supreme, January 2099', 200, 50, 'corrected') \gset
select is(:'still_by'::uuid, :'admin'::uuid, 'update leaves created_by alone');
select is(
  (select supreme_cents from public.finance_payment_packets() where id = :'first_id'),
  200,
  'update changes the Supreme total');

select tests.act_as(:'admin');

select throws_ok(
  $$select public.finance_payment_packet_save(null, 'x', null, null, null)$$,
  'P0001', 'payment packet needs a total',
  'both totals empty is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, 'x', -1, null, null)$$,
  'P0001', 'payment packet total is negative',
  'a negative total is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, '   ', 1, null, null)$$,
  'P0001', 'payment packet label is required',
  'a blank label is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, repeat('a', 121), 1, null, null)$$,
  'P0001', 'payment packet label is too long',
  'a label over 120 characters is refused');
select throws_ok(
  $$select public.finance_payment_packet_save(null, 'ok', 1, null, repeat('n', 501))$$,
  'P0001', 'payment packet note is too long',
  'a note over 500 characters is refused');
select throws_ok(
  $$select public.finance_payment_packet_save('00000000-0000-0000-0000-000000000000', 'ok', 1, null, null)$$,
  'P0001', 'payment packet not found',
  'update of an unknown id is refused');
select throws_ok(
  $$select public.finance_payment_packet_delete('00000000-0000-0000-0000-000000000000')$$,
  'P0001', 'payment packet not found',
  'delete of an unknown id is refused');

select public.finance_payment_packet_delete(:'second_id');
select is(
  (select count(*)::int from public.finance_payment_packets() where id = :'second_id'),
  0,
  'delete removes the packet');

select ok(
  not has_table_privilege('authenticated', 'public.finance_payment_packets', 'SELECT'),
  'authenticated cannot read the table directly');
select ok(
  not has_table_privilege('authenticated', 'public.finance_payment_packets', 'INSERT'),
  'authenticated cannot insert the table directly');

select tests.act_as(:'knight');
select throws_ok(
  $$select public.finance_payment_packet_save(null, 'nope', 1, null, null)$$,
  '42501', 'forbidden',
  'a member cannot save a packet');

select * from finish();
rollback;
