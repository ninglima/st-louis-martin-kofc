begin;
\ir helpers/dues_fixtures.inc
select plan(29);

select tests.make_user('me-admin@example.com', 'administrator') as admin \gset
select tests.make_user('me-knight@example.com', 'member') as knight \gset
select tests.make_user('me-linked@example.com', 'member') as linked \gset
select tests.make_member('ME-0001') as m \gset
select tests.make_member('ME-0002', :'linked') as lm \gset

-- gates
select tests.act_as(:'knight');
select throws_ok(format($$ select * from public.member_for_edit(%L) $$, :'m'),
  '42501', 'forbidden', 'member_for_edit needs members.manage');
select throws_ok(format($$ select public.member_update(%L, '{"city":"X"}') $$, :'m'),
  '42501', 'forbidden', 'member_update needs members.manage');
select throws_ok($$ select count(*) from public.member_edits $$,
  '42501', null, 'authenticated cannot read member_edits');

select tests.act_as(:'admin');
select throws_ok(format($$ select * from public.member_for_edit(%L) $$, gen_random_uuid()),
  'P0001', 'unknown member', 'unknown member (read)');
select throws_ok(format($$ select public.member_update(%L, '{"city":"X"}') $$, gen_random_uuid()),
  'P0001', 'unknown member', 'unknown member (update)');

-- every field, round trip
select lives_ok(format($$ select public.member_update(%L, %L::jsonb) $$, :'m',
  '{"prefix":"Sir","first_name":" Ada ","middle_name":"B","last_name":"Lovelace","suffix":"Jr",
    "primary_email":"ada@example.com","email_secondary":"ada2@example.com",
    "phone_cell":"(555) 555-0101","phone_residence":"555-0102","phone_business":"555-0103",
    "address_line1":"1 Oak St","address_line2":"Apt 2","city":"Ashburn","state":"VA",
    "postal_code":"20147","country":"USA","secondary_address":"PO Box 9","bad_address":true}'),
  'admin updates every field');
select results_eq(
  format($$ select prefix, first_name, middle_name, last_name, suffix, primary_email,
    email_secondary, phone_cell, phone_residence, phone_business, address_line1,
    address_line2, city, state, postal_code, country, secondary_address, bad_address
    from public.member_for_edit(%L) $$, :'m'),
  $$ values ('Sir'::text,'Ada'::text,'B'::text,'Lovelace'::text,'Jr'::text,'ada@example.com'::text,
    'ada2@example.com'::text,'(555) 555-0101'::text,'555-0102'::text,'555-0103'::text,'1 Oak St'::text,
    'Apt 2'::text,'Ashburn'::text,'VA'::text,'20147'::text,'USA'::text,'PO Box 9'::text,true) $$,
  'every field round-trips, trimmed, encrypted ones decrypted');
select ok((select address_line1_enc is not null
             and position('Oak' in encode(address_line1_enc, 'escape')) = 0
           from public.members where id = :'m'),
  'address line 1 is stored encrypted');

select tests.act_as_service();
select is((select count(*)::int from public.member_edits where member_id = :'m'), 1, 'one log row');
select is((select edited_by from public.member_edits where member_id = :'m'), :'admin'::uuid, 'log records the editor');
select is((select fields from public.member_edits where member_id = :'m'),
  array['address_line1','address_line2','bad_address','city','country','email_secondary',
        'first_name','last_name','middle_name','phone_business','phone_cell','phone_residence',
        'postal_code','prefix','primary_email','secondary_address','state','suffix'],
  'log lists the changed field names, sorted');
select tests.act_as(:'admin');

-- partial, no-op, clear
select lives_ok(format($$ select public.member_update(%L, '{"phone_cell":"555-0199"}') $$, :'m'), 'partial update');
select results_eq(format($$ select phone_cell, city, first_name from public.member_for_edit(%L) $$, :'m'),
  $$ values ('555-0199'::text, 'Ashburn'::text, 'Ada'::text) $$, 'only the given field changed');
select lives_ok(format($$ select public.member_update(%L, '{"city":" Ashburn "}') $$, :'m'), 'no-op update');
select lives_ok(format($$ select public.member_update(%L, '{"address_line2":"","middle_name":null}') $$, :'m'), 'clearing fields');
select results_eq(format($$ select address_line2, middle_name from public.member_for_edit(%L) $$, :'m'),
  $$ values (null::text, null::text) $$, 'empty string and null both clear');
select ok((select address_line2_enc is null from public.members where id = :'m'),
  'a cleared encrypted field is stored as null');

select tests.act_as_service();
select is((select count(*)::int from public.member_edits where member_id = :'m'), 3,
  'no-op wrote no log row (full + partial + clear)');
select tests.act_as(:'admin');

-- rejections
select throws_ok(format($$ select public.member_update(%L, '{"first_name":"  "}') $$, :'m'),
  'P0001', 'First name is required', 'blank first name refused');
select throws_ok(format($$ select public.member_update(%L, '{"last_name":null}') $$, :'m'),
  'P0001', 'Last name is required', 'null last name refused');
select throws_ok(format($$ select public.member_update(%L, '{"primary_email":"not-an-email"}') $$, :'m'),
  'P0001', 'Primary email is not a valid email address', 'bad email refused');
select throws_ok(format($$ select public.member_update(%L, %L::jsonb) $$, :'m',
    json_build_object('postal_code', repeat('9', 21))),
  'P0001', 'Postal code must be 20 characters or fewer', 'over-long value refused');
select throws_ok(format($$ select public.member_update(%L, '{"membership_number":"1"}') $$, :'m'),
  'P0001', 'unknown field: membership_number', 'unknown key refused');
select throws_ok(format($$ select public.member_update(%L, '{"bad_address":"yes"}') $$, :'m'),
  'P0001', 'Bad address must be true or false', 'non-boolean bad_address refused');
select throws_ok(format($$ select public.member_update(%L, '[]') $$, :'m'),
  'P0001', 'changes must be an object', 'non-object refused');

-- a linked member's sign-in email is untouched
select lives_ok(format($$ select public.member_update(%L, '{"primary_email":"new@example.com"}') $$, :'lm'),
  'edit a linked member''s primary email');
select tests.act_as_service();
select is((select email from auth.users where id = :'linked'), 'me-linked@example.com',
  'sign-in email unchanged');
select tests.act_as(:'admin');

-- a roster re-import keeps the edits and refills the cleared field
select lives_ok(format($$ select public.member_upsert_from_roster(%L::jsonb) $$,
    json_build_object('membership_number','ME-0001','first_name','Roster','last_name','Name',
                      'phone_cell','111-1111','address_line2','Roster Apt','source_file','t.csv')),
  're-import runs');
select results_eq(format($$ select first_name, last_name, phone_cell, address_line2 from public.member_for_edit(%L) $$, :'m'),
  $$ values ('Ada'::text, 'Lovelace'::text, '555-0199'::text, 'Roster Apt'::text) $$,
  're-import keeps the edited name and phone, and refills the cleared field');

select * from finish();
rollback;
