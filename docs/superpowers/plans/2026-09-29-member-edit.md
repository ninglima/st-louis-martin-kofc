# Member Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator with `members.manage` edit a member's name, contact details and address in a dialog opened from the Members table and the member's page.

**Architecture:** Two `security definer` Postgres functions do the work. `member_for_edit` reads one member with the encrypted fields decrypted. `member_update` validates, encrypts and writes only the fields sent, and logs the changed field names to `member_edits`. `@kit/members` adds a zod schema and a diff helper, two service methods and two server actions. `MemberEditDialog` (react-hook-form) sends only the fields that changed.

**Tech Stack:**
- Supabase Postgres (pgcrypto, Vault key via `kit.members_pii_key()`), pgTAP
- Next.js 16 server actions (`enhanceAction`)
- React 19, react-hook-form, zod 4 (`import * as z from 'zod'`)
- Base UI shadcn components
- Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-29-member-edit-design.md`

## Global Constraints

- Access is `members.manage`. Without it, the database refuses with errcode `42501` and message `forbidden`, and no Edit control renders.
- Editable keys, exactly: `prefix, first_name, middle_name, last_name, suffix, primary_email, email_secondary, phone_cell, phone_residence, phone_business, address_line1, address_line2, city, state, postal_code, country, secondary_address, bad_address`.
  - Encrypted: `email_secondary, phone_cell, phone_residence, phone_business, address_line1, address_line2, postal_code, secondary_address`. They are stored in the `<key>_enc` columns via `extensions.pgp_sym_encrypt(value, kit.members_pii_key())`.
- Every text value is trimmed, and an empty string is stored as `null`.
- First and last name are required.
- Emails must match `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- Length limits:
  - names (`prefix, first_name, middle_name, last_name, suffix`): 100
  - emails: 254
  - phones: 40
  - `address_line1, address_line2, city, state, country`: 200
  - `postal_code`: 20
  - `secondary_address`: 500
- Error messages, verbatim:
  - `<Label> is required`
  - `<Label> is not a valid email address`
  - `<Label> must be <N> characters or fewer`
  - `unknown field: <key>`
  - `Bad address must be true or false`
  - `changes must be an object`
  - `unknown member`
- Field labels, verbatim:

  | Key | Label | Key | Label |
  | --- | --- | --- | --- |
  | `prefix` | Prefix | `phone_business` | Business phone |
  | `first_name` | First name | `address_line1` | Address line 1 |
  | `middle_name` | Middle name | `address_line2` | Address line 2 |
  | `last_name` | Last name | `city` | City |
  | `suffix` | Suffix | `state` | State |
  | `primary_email` | Primary email | `postal_code` | Postal code |
  | `email_secondary` | Secondary email | `country` | Country |
  | `phone_cell` | Cell phone | `secondary_address` | Second address |
  | `phone_residence` | Home phone | `bad_address` | Bad address |

- A save that changes nothing writes no `member_edits` row and doesn't touch `updated_at`.
- The primary email changes the `members` row only. Never touch `auth.users`.
- Server actions return `{ success: false, error }` for expected failures and never throw them, because Next.js redacts thrown messages.
- UI copy, verbatim:
  - success toast: `Member updated.`
  - roster note: `Clearing a field here lets the next roster import fill it again.`
- Never run `supabase db reset`. Apply the migration with `pnpm --filter portal exec supabase migration up`.

## Review Focus

1. **A no-op or whitespace-only edit** (for example, `" Ashburn "` over `Ashburn`) should save nothing and log nothing. Pinned in Task 1 (pgTAP no-op) and Task 2 (`changedFields` trims).
2. **Clearing an encrypted field** should store `null`, not an encrypted empty string, so a roster re-import can fill it again. Pinned in Task 1 (clear, then re-import refills).
3. **A member linked to a sign-in whose primary email is edited** should keep the same `auth.users.email`. Pinned in Task 1 (the linked member's `auth.users` email is unchanged).
4. **The dialog opened on a member deleted since the page loaded** should show "That member no longer exists." instead of crashing. Pinned in Task 3 (the load action with an `unknown member` error).
5. **A caller who reaches the action without `members.manage`** (the action is a public endpoint) should be refused before any read or write. Pinned in Task 3 (both actions refuse, and make no RPC).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/portal/supabase/migrations/20261001120000_member_edit.sql` | `member_edits`, `kit.member_edit_values`, `member_for_edit`, `member_update` |
| `apps/portal/supabase/tests/member_edit.test.sql` | pgTAP for the above |
| `packages/supabase/src/database.types.ts`, `apps/portal/lib/database.types.ts` | regenerated types |
| `packages/features/members/src/lib/member-edit.ts` (+ `.test.ts`) | fields, labels, `MemberEditSchema`, `toFormValues`, `changedFields` |
| `packages/features/members/src/server/members.service.ts` | `getForEdit`, `update` |
| `packages/features/members/src/server/members-actions.ts` (+ test) | `loadMemberForEditAction`, `updateMemberAction` |
| `packages/features/members/src/components/member-edit-dialog.tsx` | the dialog |
| `packages/features/members/src/components/members-list.tsx` (+ test) | the Edit column |
| `apps/portal/app/home/members/page.tsx`, `apps/portal/app/home/members/[id]/page.tsx` | pass `canEdit`, and the Edit button on the member page |
| `apps/e2e/tests/members/member-edit.spec.ts` | end to end |

---

### Task 1: Database — log table, read and update functions

**Files:**
- Create: `apps/portal/supabase/migrations/20261001120000_member_edit.sql`
- Create: `apps/portal/supabase/tests/member_edit.test.sql`
- Modify (generated): `packages/supabase/src/database.types.ts`, `apps/portal/lib/database.types.ts`

**Interfaces:**
- Produces:
  - `public.member_for_edit(p_member_id uuid)` returns table `(membership_number text, prefix text, first_name text, middle_name text, last_name text, suffix text, primary_email text, email_secondary text, phone_cell text, phone_residence text, phone_business text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, secondary_address text, bad_address boolean)`.
  - `public.member_update(p_member_id uuid, p_changes jsonb) returns void`.
  - `public.member_edits (id, member_id, edited_by, fields text[], edited_at)`.

- [ ] **Step 1: Write the failing pgTAP test**

`apps/portal/supabase/tests/member_edit.test.sql`:

```sql
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter portal exec supabase test db`
Expected: FAIL in `member_edit.test.sql`, with `function public.member_for_edit(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20261001120000_member_edit.sql`:

```sql
-- Member editing: an administrator with members.manage corrects a member's
-- name, contact details and address. Spec:
-- docs/superpowers/specs/2026-09-29-member-edit-design.md

create table public.member_edits (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members on delete cascade,
  edited_by  uuid references auth.users on delete set null,
  fields     text[] not null,
  edited_at  timestamptz not null default now()
);

comment on table public.member_edits is
  'Who changed which member fields, and when. Field names only, never values, so no PII is copied here.';

create index member_edits_member_idx on public.member_edits (member_id, edited_at desc);

alter table public.member_edits enable row level security;
revoke all on public.member_edits from anon, authenticated;

-- Every editable field, decrypted. Internal: no permission check, so it is
-- never granted to a client role; the public functions below gate first.
create or replace function kit.member_edit_values(p_member_id uuid)
returns table (
  membership_number text, prefix text, first_name text, middle_name text,
  last_name text, suffix text, primary_email text, email_secondary text,
  phone_cell text, phone_residence text, phone_business text,
  address_line1 text, address_line2 text, city text, state text,
  postal_code text, country text, secondary_address text, bad_address boolean
)
language sql stable security definer set search_path = '' as $$
  select m.membership_number, m.prefix, m.first_name, m.middle_name,
         m.last_name, m.suffix, m.primary_email,
         extensions.pgp_sym_decrypt(m.email_secondary_enc,   k.key),
         extensions.pgp_sym_decrypt(m.phone_cell_enc,        k.key),
         extensions.pgp_sym_decrypt(m.phone_residence_enc,   k.key),
         extensions.pgp_sym_decrypt(m.phone_business_enc,    k.key),
         extensions.pgp_sym_decrypt(m.address_line1_enc,     k.key),
         extensions.pgp_sym_decrypt(m.address_line2_enc,     k.key),
         m.city, m.state,
         extensions.pgp_sym_decrypt(m.postal_code_enc,       k.key),
         m.country,
         extensions.pgp_sym_decrypt(m.secondary_address_enc, k.key),
         m.bad_address
  from public.members m
  cross join (select kit.members_pii_key() as key) k
  where m.id = p_member_id
$$;

revoke all on function kit.member_edit_values(uuid) from public, anon, authenticated;

create or replace function public.member_for_edit(p_member_id uuid)
returns table (
  membership_number text, prefix text, first_name text, middle_name text,
  last_name text, suffix text, primary_email text, email_secondary text,
  phone_cell text, phone_residence text, phone_business text,
  address_line1 text, address_line2 text, city text, state text,
  postal_code text, country text, secondary_address text, bad_address boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('members', 'manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query select * from kit.member_edit_values(p_member_id);

  if not found then
    raise exception 'unknown member';
  end if;
end $$;

create or replace function public.member_update(p_member_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c_labels constant jsonb := '{
    "prefix":"Prefix","first_name":"First name","middle_name":"Middle name",
    "last_name":"Last name","suffix":"Suffix","primary_email":"Primary email",
    "email_secondary":"Secondary email","phone_cell":"Cell phone",
    "phone_residence":"Home phone","phone_business":"Business phone",
    "address_line1":"Address line 1","address_line2":"Address line 2",
    "city":"City","state":"State","postal_code":"Postal code","country":"Country",
    "secondary_address":"Second address","bad_address":"Bad address"}';
  c_limits constant jsonb := '{
    "prefix":100,"first_name":100,"middle_name":100,"last_name":100,"suffix":100,
    "primary_email":254,"email_secondary":254,
    "phone_cell":40,"phone_residence":40,"phone_business":40,
    "address_line1":200,"address_line2":200,"city":200,"state":200,"country":200,
    "postal_code":20,"secondary_address":500}';
  v_current jsonb;
  v_key     text;
  v_value   text;
  v_label   text;
  v_limit   int;
  v_effective jsonb := '{}';
  v_changed   text[] := '{}';
  v_pii       text;
begin
  if not kit.has_permission('members', 'manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object';
  end if;

  -- Lock first, so two editors saving at once apply one after the other and
  -- each compares against the other's committed values.
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    raise exception 'unknown member';
  end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not c_labels ? v_key then
      raise exception 'unknown field: %', v_key;
    end if;
  end loop;

  select to_jsonb(v) into v_current from kit.member_edit_values(p_member_id) v;

  for v_key in select jsonb_object_keys(p_changes) order by 1 loop
    v_label := c_labels->>v_key;

    if v_key = 'bad_address' then
      if jsonb_typeof(p_changes->'bad_address') <> 'boolean' then
        raise exception 'Bad address must be true or false';
      end if;
      v_value := p_changes->>'bad_address';
    else
      v_value := nullif(btrim(p_changes->>v_key), '');
      v_limit := (c_limits->>v_key)::int;

      if v_value is null and v_key in ('first_name', 'last_name') then
        raise exception '% is required', v_label;
      end if;
      if v_value is not null and length(v_value) > v_limit then
        raise exception '% must be % characters or fewer', v_label, v_limit;
      end if;
      if v_value is not null and v_key in ('primary_email', 'email_secondary')
         and v_value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception '% is not a valid email address', v_label;
      end if;
    end if;

    if v_current->>v_key is distinct from v_value then
      v_effective := v_effective || jsonb_build_object(v_key, v_value);
      v_changed := v_changed || v_key;
    end if;
  end loop;

  if cardinality(v_changed) = 0 then
    return;
  end if;

  v_pii := kit.members_pii_key();

  update public.members set
    prefix        = case when v_effective ? 'prefix'        then v_effective->>'prefix'        else prefix end,
    first_name    = case when v_effective ? 'first_name'    then v_effective->>'first_name'    else first_name end,
    middle_name   = case when v_effective ? 'middle_name'   then v_effective->>'middle_name'   else middle_name end,
    last_name     = case when v_effective ? 'last_name'     then v_effective->>'last_name'     else last_name end,
    suffix        = case when v_effective ? 'suffix'        then v_effective->>'suffix'        else suffix end,
    primary_email = case when v_effective ? 'primary_email' then v_effective->>'primary_email' else primary_email end,
    city          = case when v_effective ? 'city'          then v_effective->>'city'          else city end,
    state         = case when v_effective ? 'state'         then v_effective->>'state'         else state end,
    country       = case when v_effective ? 'country'       then v_effective->>'country'       else country end,
    bad_address   = case when v_effective ? 'bad_address'   then (v_effective->>'bad_address')::boolean else bad_address end,
    email_secondary_enc   = case when v_effective ? 'email_secondary'   then extensions.pgp_sym_encrypt(v_effective->>'email_secondary',   v_pii) else email_secondary_enc end,
    phone_cell_enc        = case when v_effective ? 'phone_cell'        then extensions.pgp_sym_encrypt(v_effective->>'phone_cell',        v_pii) else phone_cell_enc end,
    phone_residence_enc   = case when v_effective ? 'phone_residence'   then extensions.pgp_sym_encrypt(v_effective->>'phone_residence',   v_pii) else phone_residence_enc end,
    phone_business_enc    = case when v_effective ? 'phone_business'    then extensions.pgp_sym_encrypt(v_effective->>'phone_business',    v_pii) else phone_business_enc end,
    address_line1_enc     = case when v_effective ? 'address_line1'     then extensions.pgp_sym_encrypt(v_effective->>'address_line1',     v_pii) else address_line1_enc end,
    address_line2_enc     = case when v_effective ? 'address_line2'     then extensions.pgp_sym_encrypt(v_effective->>'address_line2',     v_pii) else address_line2_enc end,
    postal_code_enc       = case when v_effective ? 'postal_code'       then extensions.pgp_sym_encrypt(v_effective->>'postal_code',       v_pii) else postal_code_enc end,
    secondary_address_enc = case when v_effective ? 'secondary_address' then extensions.pgp_sym_encrypt(v_effective->>'secondary_address', v_pii) else secondary_address_enc end,
    updated_at = now()
  where id = p_member_id;

  insert into public.member_edits (member_id, edited_by, fields)
  values (p_member_id, auth.uid(), v_changed);
end $$;

revoke all on function public.member_for_edit(uuid)        from public, anon;
revoke all on function public.member_update(uuid, jsonb)   from public, anon;
grant execute on function public.member_for_edit(uuid)      to authenticated;
grant execute on function public.member_update(uuid, jsonb) to authenticated;
```

`extensions.pgp_sym_encrypt(null, key)` returns `null`, so a cleared encrypted field is stored as `null`, which the roster import's `coalesce` fills again.

- [ ] **Step 4: Apply and run the tests**

Run:
```bash
pnpm --filter portal exec supabase migration up
pnpm --filter portal exec supabase test db
```
Expected: every file passes, including `member_edit.test.sql` (29 tests).

- [ ] **Step 5: Regenerate the types**

Run: `pnpm supabase:web:typegen`
Expected: `packages/supabase/src/database.types.ts` gains `member_for_edit`, `member_update` and `member_edits`. Check with `git diff --stat`.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/supabase/migrations/20261001120000_member_edit.sql apps/portal/supabase/tests/member_edit.test.sql packages/supabase/src/database.types.ts apps/portal/lib/database.types.ts
git commit -m "feat(members): member_for_edit and member_update, with an edit log"
```

---

### Task 2: Schema, form values and the changed-fields diff

**Files:**
- Create: `packages/features/members/src/lib/member-edit.ts`
- Test: `packages/features/members/src/lib/member-edit.test.ts`

**Interfaces:**
- Produces (from `@kit/members/lib/member-edit`):
  - `MEMBER_EDIT_FIELDS: readonly MemberEditField[]` (the 18 keys, in dialog order)
  - `MEMBER_EDIT_LABELS: Record<MemberEditField, string>`
  - `type MemberEditValues = { [K in Exclude<MemberEditField,'bad_address'>]: string } & { bad_address: boolean }`
  - `type MemberEditChanges = Partial<{ [K in Exclude<MemberEditField,'bad_address'>]: string | null } & { bad_address: boolean }>`
  - `interface MemberForEdit { membershipNumber: string; values: MemberEditValues }`
  - `MemberEditSchema` (zod object over `MemberEditValues`)
  - `toFormValues(row: Record<string, unknown>): MemberEditValues`
  - `changedFields(initial: MemberEditValues, next: MemberEditValues): MemberEditChanges`

- [ ] **Step 1: Write the failing test**

`packages/features/members/src/lib/member-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  MEMBER_EDIT_FIELDS,
  MemberEditSchema,
  changedFields,
  toFormValues,
} from './member-edit';
import type { MemberEditValues } from './member-edit';

function values(overrides: Partial<MemberEditValues> = {}): MemberEditValues {
  return {
    ...toFormValues({ first_name: 'Ada', last_name: 'Lovelace' }),
    ...overrides,
  };
}

describe('toFormValues', () => {
  it('turns nulls into empty strings and keeps the flag a boolean', () => {
    const form = toFormValues({
      first_name: 'Ada',
      last_name: 'Lovelace',
      city: null,
      bad_address: true,
    });

    expect(form.city).toBe('');
    expect(form.phone_cell).toBe('');
    expect(form.bad_address).toBe(true);
    expect(Object.keys(form).sort()).toEqual([...MEMBER_EDIT_FIELDS].sort());
  });
});

describe('MemberEditSchema', () => {
  it('trims and accepts a valid member', () => {
    const parsed = MemberEditSchema.parse(values({ first_name: '  Ada ' }));

    expect(parsed.first_name).toBe('Ada');
  });

  it('requires first and last name', () => {
    const result = MemberEditSchema.safeParse(values({ first_name: '   ', last_name: '' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).sort()).toEqual([
      'First name is required',
      'Last name is required',
    ]);
  });

  it('checks email shape but allows a blank email', () => {
    expect(MemberEditSchema.safeParse(values({ primary_email: '' })).success).toBe(true);
    expect(MemberEditSchema.safeParse(values({ email_secondary: 'a@b.co' })).success).toBe(true);

    const bad = MemberEditSchema.safeParse(values({ primary_email: 'not-an-email' }));

    expect(bad.error?.issues[0]?.message).toBe('Primary email is not a valid email address');
  });

  it('enforces the length limits', () => {
    const bad = MemberEditSchema.safeParse(values({ postal_code: '9'.repeat(21) }));

    expect(bad.error?.issues[0]?.message).toBe('Postal code must be 20 characters or fewer');
    expect(MemberEditSchema.safeParse(values({ postal_code: '9'.repeat(20) })).success).toBe(true);
    expect(
      MemberEditSchema.safeParse(values({ secondary_address: 'x'.repeat(501) })).error?.issues[0]?.message,
    ).toBe('Second address must be 500 characters or fewer');
  });
});

describe('changedFields', () => {
  it('returns nothing when nothing changed, ignoring surrounding spaces', () => {
    const initial = values({ city: 'Ashburn' });

    expect(changedFields(initial, { ...initial, city: ' Ashburn ' })).toEqual({});
  });

  it('returns only the changed fields, with a cleared one as null', () => {
    const initial = values({ city: 'Ashburn', phone_cell: '555-0101' });

    expect(
      changedFields(initial, { ...initial, city: 'Florissant', phone_cell: '', bad_address: true }),
    ).toEqual({ city: 'Florissant', phone_cell: null, bad_address: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kit/members exec vitest run src/lib/member-edit.test.ts`
Expected: FAIL with `Cannot find module './member-edit'`.

- [ ] **Step 3: Implement**

`packages/features/members/src/lib/member-edit.ts`:

```ts
import * as z from 'zod';

/** Every field the edit dialog can change, in the order it shows them. */
export const MEMBER_EDIT_FIELDS = [
  'prefix',
  'first_name',
  'middle_name',
  'last_name',
  'suffix',
  'primary_email',
  'email_secondary',
  'phone_cell',
  'phone_residence',
  'phone_business',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'country',
  'secondary_address',
  'bad_address',
] as const;

export type MemberEditField = (typeof MEMBER_EDIT_FIELDS)[number];

type TextField = Exclude<MemberEditField, 'bad_address'>;

export const MEMBER_EDIT_LABELS: Record<MemberEditField, string> = {
  prefix: 'Prefix',
  first_name: 'First name',
  middle_name: 'Middle name',
  last_name: 'Last name',
  suffix: 'Suffix',
  primary_email: 'Primary email',
  email_secondary: 'Secondary email',
  phone_cell: 'Cell phone',
  phone_residence: 'Home phone',
  phone_business: 'Business phone',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  city: 'City',
  state: 'State',
  postal_code: 'Postal code',
  country: 'Country',
  secondary_address: 'Second address',
  bad_address: 'Bad address',
};

/** What the form holds: '' for an empty field, never null. */
export type MemberEditValues = { [K in TextField]: string } & {
  bad_address: boolean;
};

/** What `member_update` receives: only changed fields, null for cleared. */
export type MemberEditChanges = Partial<
  { [K in TextField]: string | null } & { bad_address: boolean }
>;

export interface MemberForEdit {
  membershipNumber: string;
  values: MemberEditValues;
}

// Mirrors `public.member_update`, which stays the authority; this only
// saves the officer a round trip.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function text(field: TextField, max: number) {
  const label = MEMBER_EDIT_LABELS[field];

  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`);
}

function required(field: TextField, max: number) {
  return text(field, max).min(1, `${MEMBER_EDIT_LABELS[field]} is required`);
}

function email(field: TextField) {
  return text(field, 254).refine(
    (value) => value === '' || EMAIL.test(value),
    `${MEMBER_EDIT_LABELS[field]} is not a valid email address`,
  );
}

export const MemberEditSchema = z.object({
  prefix: text('prefix', 100),
  first_name: required('first_name', 100),
  middle_name: text('middle_name', 100),
  last_name: required('last_name', 100),
  suffix: text('suffix', 100),
  primary_email: email('primary_email'),
  email_secondary: email('email_secondary'),
  phone_cell: text('phone_cell', 40),
  phone_residence: text('phone_residence', 40),
  phone_business: text('phone_business', 40),
  address_line1: text('address_line1', 200),
  address_line2: text('address_line2', 200),
  city: text('city', 200),
  state: text('state', 200),
  postal_code: text('postal_code', 20),
  country: text('country', 200),
  secondary_address: text('secondary_address', 500),
  bad_address: z.boolean(),
});

/** A `member_for_edit` row (nulls and all) as form values. */
export function toFormValues(row: Record<string, unknown>): MemberEditValues {
  const form = {} as Record<string, string | boolean>;

  for (const field of MEMBER_EDIT_FIELDS) {
    form[field] =
      field === 'bad_address'
        ? row[field] === true
        : typeof row[field] === 'string'
          ? (row[field] as string)
          : '';
  }

  return form as MemberEditValues;
}

/**
 * The fields that differ, compared after trimming, so re-typing the same
 * value is not a change. A cleared field is sent as null.
 */
export function changedFields(
  initial: MemberEditValues,
  next: MemberEditValues,
): MemberEditChanges {
  const changes: Record<string, string | null | boolean> = {};

  for (const field of MEMBER_EDIT_FIELDS) {
    if (field === 'bad_address') {
      if (initial.bad_address !== next.bad_address) {
        changes.bad_address = next.bad_address;
      }
      continue;
    }

    const before = initial[field].trim();
    const after = next[field].trim();

    if (before !== after) {
      changes[field] = after === '' ? null : after;
    }
  }

  return changes as MemberEditChanges;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kit/members exec vitest run src/lib/member-edit.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/features/members/src/lib/member-edit.ts packages/features/members/src/lib/member-edit.test.ts
git commit -m "feat(members): member edit schema and changed-fields diff"
```

---

### Task 3: Service methods and server actions

**Files:**
- Modify: `packages/features/members/src/server/members.service.ts` (add two methods to `MembersService`)
- Modify: `packages/features/members/src/server/members-actions.ts` (add two actions)
- Test: `packages/features/members/src/server/members-actions.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `MemberForEdit`, `MemberEditChanges`, `toFormValues` from Task 2; the `member_for_edit` and `member_update` RPCs from Task 1.
- Produces:
  - `MembersService.getForEdit(id: string): Promise<MemberForEdit | null>`
  - `MembersService.update(id: string, changes: MemberEditChanges): Promise<void>`
  - `loadMemberForEditAction(input: { memberId: string }): Promise<{ success: true; member: MemberForEdit } | { success: false; error: string }>`
  - `updateMemberAction(input: { memberId: string; changes: MemberEditChanges }): Promise<{ success: true } | { success: false; error: string }>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/features/members/src/server/members-actions.test.ts`. The file already mocks `enhanceAction`, permissions and both Supabase clients through `h`. Change the dynamic import line to:

```ts
const { exportMembersAction, loadMemberForEditAction, updateMemberAction } =
  await import('./members-actions');
```

Then add at the end:

```ts
describe('member edit actions', () => {
  const MEMBER_ID = 'bd1d9c3a-1111-2222-3333-444455556666';

  function editClient(result: { data?: unknown; error?: { message: string } | null }) {
    const calls: RpcCall[] = [];

    return {
      calls,
      client: {
        rpc: (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });

          return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
        },
      },
    };
  }

  beforeEach(() => {
    h.perms = { members: { canView: true, canManage: true } };
  });

  it('refuses both actions without members.manage, before any RPC', async () => {
    h.perms = { members: { canView: true, canManage: false } };
    const fake = editClient({});
    h.officer = fake.client;

    expect(await loadMemberForEditAction({ memberId: MEMBER_ID })).toEqual({
      success: false,
      error: 'You do not have permission to edit members.',
    });
    expect(
      await updateMemberAction({ memberId: MEMBER_ID, changes: { city: 'X' } }),
    ).toEqual({ success: false, error: 'You do not have permission to edit members.' });
    expect(fake.calls).toEqual([]);
  });

  it('loads a member as form values', async () => {
    const fake = editClient({
      data: [{ membership_number: '1000001', first_name: 'Ada', last_name: 'Lovelace', city: null, bad_address: false }],
    });
    h.officer = fake.client;

    const result = await loadMemberForEditAction({ memberId: MEMBER_ID });

    expect(fake.calls).toEqual([{ name: 'member_for_edit', args: { p_member_id: MEMBER_ID } }]);
    expect(result.success && result.member.membershipNumber).toBe('1000001');
    expect(result.success && result.member.values.city).toBe('');
  });

  it('says a vanished member no longer exists', async () => {
    h.officer = editClient({ error: { message: 'unknown member' } }).client;

    expect(await loadMemberForEditAction({ memberId: MEMBER_ID })).toEqual({
      success: false,
      error: 'That member no longer exists.',
    });
  });

  it('refuses a malformed id without calling the database', async () => {
    const fake = editClient({});
    h.officer = fake.client;

    expect((await loadMemberForEditAction({ memberId: 'nope' })).success).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('sends the changes and returns a database refusal as a value', async () => {
    const ok = editClient({});
    h.officer = ok.client;

    expect(await updateMemberAction({ memberId: MEMBER_ID, changes: { city: 'Florissant' } })).toEqual({
      success: true,
    });
    expect(ok.calls).toEqual([
      { name: 'member_update', args: { p_member_id: MEMBER_ID, p_changes: { city: 'Florissant' } } },
    ]);

    h.officer = editClient({ error: { message: 'First name is required' } }).client;

    expect(await updateMemberAction({ memberId: MEMBER_ID, changes: { first_name: null } })).toEqual({
      success: false,
      error: 'First name is required',
    });
  });

  it('makes no call for an empty change set', async () => {
    const fake = editClient({});
    h.officer = fake.client;

    expect(await updateMemberAction({ memberId: MEMBER_ID, changes: {} })).toEqual({ success: true });
    expect(fake.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @kit/members exec vitest run src/server/members-actions.test.ts`
Expected: FAIL, because `loadMemberForEditAction` is not a function.

- [ ] **Step 3: Add the service methods**

In `members.service.ts`, add to the imports:

```ts
import { toFormValues } from '../lib/member-edit';
import type { MemberEditChanges, MemberForEdit } from '../lib/member-edit';
```

Add inside `class MembersService`:

```ts
  /**
   * One member's editable fields, decrypted, via `member_for_edit`
   * (members.manage). `null` for a member that no longer exists.
   */
  async getForEdit(id: string): Promise<MemberForEdit | null> {
    const { data, error } = await this.client.rpc('member_for_edit', {
      p_member_id: id,
    });

    if (error) {
      if (error.message === 'unknown member') return null;
      throw new Error(error.message);
    }

    const row = data?.[0];

    if (!row) return null;

    return {
      membershipNumber: row.membership_number,
      values: toFormValues(row),
    };
  }

  /** Applies only the given fields; `member_update` validates and logs. */
  async update(id: string, changes: MemberEditChanges): Promise<void> {
    const { error } = await this.client.rpc('member_update', {
      p_member_id: id,
      p_changes: changes,
    });

    if (error) {
      throw new Error(error.message);
    }
  }
```

- [ ] **Step 4: Add the actions**

In `members-actions.ts`, add to the imports:

```ts
import * as z from 'zod';

import type { MemberEditChanges, MemberForEdit } from '../lib/member-edit';
```

Append:

```ts
const EDIT_UNAUTHORIZED = 'You do not have permission to edit members.';

const MemberId = z.string().uuid();

export type LoadForEditResult =
  | { success: true; member: MemberForEdit }
  | { success: false; error: string };

export type UpdateMemberResult =
  | { success: true }
  | { success: false; error: string };

async function canEditMembers(userId: string): Promise<boolean> {
  const permissions = await loadPermissionsForUser(
    getSupabaseServerAdminClient(),
    userId,
  );

  return hasPermission(permissions, 'members', 'manage');
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}

/**
 * The dialog's initial values. `members.manage` is re-checked here because a
 * Server Action is a public endpoint, and this one returns decrypted
 * addresses and phones. The RPC runs as the officer, whose `auth.uid()` is
 * what `member_for_edit` checks.
 */
export const loadMemberForEditAction = enhanceAction(
  async (input: { memberId: string }, user): Promise<LoadForEditResult> => {
    if (!(await canEditMembers(user.id))) {
      return { success: false, error: EDIT_UNAUTHORIZED };
    }

    if (!MemberId.safeParse(input.memberId).success) {
      return { success: false, error: 'That member no longer exists.' };
    }

    try {
      const member = await new MembersService(getSupabaseServerClient()).getForEdit(
        input.memberId,
      );

      return member
        ? { success: true, member }
        : { success: false, error: 'That member no longer exists.' };
    } catch (cause) {
      return { success: false, error: messageOf(cause, 'The member could not be loaded.') };
    }
  },
);

/** Saves the changed fields. `member_update` is the authority on validation. */
export const updateMemberAction = enhanceAction(
  async (
    input: { memberId: string; changes: MemberEditChanges },
    user,
  ): Promise<UpdateMemberResult> => {
    if (!(await canEditMembers(user.id))) {
      return { success: false, error: EDIT_UNAUTHORIZED };
    }

    if (!MemberId.safeParse(input.memberId).success) {
      return { success: false, error: 'That member no longer exists.' };
    }

    if (Object.keys(input.changes).length === 0) {
      return { success: true };
    }

    try {
      await new MembersService(getSupabaseServerClient()).update(
        input.memberId,
        input.changes,
      );

      return { success: true };
    } catch (cause) {
      return { success: false, error: messageOf(cause, 'The member could not be saved.') };
    }
  },
);
```

- [ ] **Step 5: Run the tests and typecheck**

Run:
```bash
pnpm --filter @kit/members exec vitest run
pnpm --filter @kit/members typecheck
```
Expected: all tests pass, and typecheck is clean.

- [ ] **Step 6: Commit**

```bash
git add packages/features/members/src/server/members.service.ts packages/features/members/src/server/members-actions.ts packages/features/members/src/server/members-actions.test.ts
git commit -m "feat(members): load and update member actions, gated on members.manage"
```

---

### Task 4: The dialog, the Edit column and the Edit button on the member page

**Files:**
- Create: `packages/features/members/src/components/member-edit-dialog.tsx`
- Modify: `packages/features/members/package.json` (devDependencies `"react-hook-form": "catalog:"`, `"@hookform/resolvers": "catalog:"`)
- Modify: `packages/features/members/src/components/members-list.tsx` (the `canEdit` prop, the Edit column, the empty-state `colSpan`)
- Modify: `packages/features/members/src/components/members-list.test.tsx`
- Modify: `apps/portal/app/home/members/page.tsx` (pass `canEdit={canManage}` to `MembersList`)
- Modify: `apps/portal/app/home/members/[id]/page.tsx` (Edit button in `PageHeader`)

**Interfaces:**
- Consumes:
  - `MemberEditSchema`, `MEMBER_EDIT_LABELS`, `changedFields`, `MemberEditValues`, `MemberEditField` (Task 2);
  - `loadMemberForEditAction`, `updateMemberAction` (Task 3).
- Produces:
  - `MemberEditDialog({ memberId, trigger }: { memberId: string; trigger: React.ReactElement })`;
  - the `MembersList` prop `canEdit?: boolean`;
  - test IDs:

    | Test ID | Element |
    | --- | --- |
    | `member-edit-<id>` | row button |
    | `member-edit` | member page button |
    | `member-edit-dialog` | the dialog |
    | `member-edit-<field>` | each input |
    | `member-edit-save` | save button |
    | `member-edit-error` | error line |

- [ ] **Step 1: Write the failing list test**

In `members-list.test.tsx`:
- add `canEdit?: boolean` to `render`'s options, and pass `canEdit={options.canEdit}` to `<MembersList>`;
- extend the `next/navigation` mock to `useRouter: () => ({ replace, refresh: vi.fn() })`, because the dialog calls `router.refresh()`;
- extend the actions mock to include `loadMemberForEditAction: vi.fn(), updateMemberAction: vi.fn()`.

Then add:

```ts
  it('offers an Edit button per row only to someone who can edit', () => {
    expect(render({ canEdit: true })).toContain(
      'data-test="member-edit-bd1d9c3a-1111-2222-3333-444455556666"',
    );
    expect(render()).not.toContain('data-test="member-edit-');
  });

  it('widens the empty row to cover the Edit column', () => {
    expect(render({ members: [], canEdit: true })).toContain('colspan="9"');
    expect(render({ members: [] })).toContain('colspan="8"');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kit/members exec vitest run src/components/members-list.test.tsx`
Expected: FAIL. No `member-edit-` markup yet, and `colspan="9"` is missing (React renders the attribute in lowercase).

- [ ] **Step 3: Add dependencies and write the dialog**

Add the two devDependencies to `packages/features/members/package.json`, then run `pnpm install` (with network access to `registry.npmjs.org`).

`packages/features/members/src/components/member-edit-dialog.tsx`:

```tsx
'use client';

import { useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

import {
  MEMBER_EDIT_LABELS,
  MemberEditSchema,
  changedFields,
} from '../lib/member-edit';
import type { MemberEditField, MemberEditValues } from '../lib/member-edit';
import {
  loadMemberForEditAction,
  updateMemberAction,
} from '../server/members-actions';

type TextField = Exclude<MemberEditField, 'bad_address'>;

const SECTIONS: { title: string; note?: string; fields: TextField[] }[] = [
  {
    title: 'Name',
    fields: ['prefix', 'first_name', 'middle_name', 'last_name', 'suffix'],
  },
  {
    title: 'Contact',
    note: 'Clearing a field here lets the next roster import fill it again.',
    fields: [
      'primary_email',
      'email_secondary',
      'phone_cell',
      'phone_residence',
      'phone_business',
    ],
  },
  {
    title: 'Address',
    note: 'Clearing a field here lets the next roster import fill it again.',
    fields: [
      'address_line1',
      'address_line2',
      'city',
      'state',
      'postal_code',
      'country',
      'secondary_address',
    ],
  },
];

/**
 * Edits one member's name, contact details and address. The values are
 * fetched when the dialog opens, never before, so decrypted details reach
 * the browser only for the member being edited. Save sends only the fields
 * that changed; `member_update` validates again and logs the change.
 */
export function MemberEditDialog({
  memberId,
  trigger,
}: {
  memberId: string;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [membershipNumber, setMembershipNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const initial = useRef<MemberEditValues | null>(null);

  const form = useForm<MemberEditValues>({
    resolver: zodResolver(MemberEditSchema),
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);

    if (!next) return;

    setError(null);
    setMembershipNumber(null);
    initial.current = null;

    startLoading(async () => {
      const result = await loadMemberForEditAction({ memberId });

      if (!result.success) {
        setError(result.error);

        return;
      }

      initial.current = result.member.values;
      setMembershipNumber(result.member.membershipNumber);
      form.reset(result.member.values);
    });
  };

  const onSubmit = (values: MemberEditValues) => {
    if (!initial.current) return;

    const changes = changedFields(initial.current, values);

    startSaving(async () => {
      const result = await updateMemberAction({ memberId, changes });

      if (!result.success) {
        setError(result.error);

        return;
      }

      toast.success('Member updated.');
      setOpen(false);
      router.refresh();
    });
  };

  const ready = initial.current !== null && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />

      <DialogContent
        data-test="member-edit-dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            Edit member{membershipNumber ? ` #${membershipNumber}` : ''}
          </DialogTitle>
          <DialogDescription>
            Changes are saved to the member record. The member&apos;s sign-in
            email is not changed.
          </DialogDescription>
        </DialogHeader>

        <If condition={error}>
          {(message) => (
            <p
              role="alert"
              className="text-destructive text-sm"
              data-test="member-edit-error"
            >
              {message}
            </p>
          )}
        </If>

        <If condition={loading}>
          <p className="text-muted-foreground text-sm">Loading…</p>
        </If>

        <If condition={ready}>
          <Form {...form}>
            <form
              className="flex flex-col gap-y-6"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              {SECTIONS.map((section) => (
                <fieldset key={section.title} className="flex flex-col gap-y-3">
                  <legend className="font-heading text-sm font-semibold">
                    {section.title}
                  </legend>

                  <If condition={section.note}>
                    {(note) => (
                      <p className="text-muted-foreground text-xs">{note}</p>
                    )}
                  </If>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.fields.map((name) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{MEMBER_EDIT_LABELS[name]}</FormLabel>
                            <FormControl>
                              <Input
                                data-test={`member-edit-${name}`}
                                type={name.includes('email') ? 'email' : 'text'}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>

                  <If condition={section.title === 'Address'}>
                    <FormField
                      control={form.control}
                      name="bad_address"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2">
                          <FormControl>
                            <Checkbox
                              data-test="member-edit-bad_address"
                              checked={field.value}
                              onCheckedChange={(checked) =>
                                field.onChange(checked === true)
                              }
                            />
                          </FormControl>
                          <FormLabel>
                            Bad address (mail to this address is returned)
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </If>
                </fieldset>
              ))}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-test="member-edit-save"
                  disabled={!form.formState.isDirty || saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </If>
      </DialogContent>
    </Dialog>
  );
}
```

If `@kit/ui/checkbox`'s `onCheckedChange` signature differs, read `packages/ui/src/shadcn/checkbox.tsx` and adapt only the callback. The checked value must still reach `field.onChange` as a boolean.

- [ ] **Step 4: Wire the Edit column into `MembersList`**

In `members-list.tsx`:
1. Import `MemberEditDialog` from `./member-edit-dialog` (`Button` is already imported).
2. Add the prop `canEdit?: boolean` (default `false`) to the destructured props and its type, with the doc comment `/** members.manage: shows an Edit button per row. */`.
3. After the last `<TableHead>` (after the dues heads), add:

```tsx
              <If condition={canEdit}>
                <TableHead className={FIT}>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </If>
```

4. Change the empty-state `colSpan={dues ? 11 : 8}` to `colSpan={(dues ? 11 : 8) + (canEdit ? 1 : 0)}`.
5. After each row's last `<TableCell>`, add:

```tsx
                <If condition={canEdit}>
                  <TableCell>
                    <MemberEditDialog
                      memberId={member.id}
                      trigger={
                        <Button
                          variant="outline"
                          size="sm"
                          data-test={`member-edit-${member.id}`}
                        >
                          Edit
                        </Button>
                      }
                    />
                  </TableCell>
                </If>
```

- [ ] **Step 5: Pass `canEdit` from the pages**

- In `apps/portal/app/home/members/page.tsx`, `MembersContent` renders `<MembersList … />`. Compute `const canEdit = hasPermission(await getCurrentPermissions(), 'members', 'manage');` beside the existing `canSeeDues`, reusing one `getCurrentPermissions()` result for both. Pass `canEdit={canEdit}`.
- In `apps/portal/app/home/members/[id]/page.tsx`:
  - add `const canEditMember = hasPermission(permissions, 'members', 'manage');`;
  - make `<PageHeader …>` a non-self-closing element whose children are:

```tsx
        <If condition={canEditMember}>
          <MemberEditDialog
            memberId={member.id}
            trigger={<Button data-test="member-edit">Edit</Button>}
          />
        </If>
```

  - with imports `import { MemberEditDialog } from '@kit/members/components/member-edit-dialog';` and `import { Button } from '@kit/ui/button';`.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run:
```bash
pnpm --filter @kit/members exec vitest run
pnpm turbo run typecheck --filter=@kit/members --filter=portal
pnpm --filter portal exec oxlint
```
Expected: all pass. The new list tests pass, and the existing 259+ still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/features/members pnpm-lock.yaml apps/portal/app/home/members
git commit -m "feat(members): edit a member in a dialog from the roster and the member page"
```

---

### Task 5: End-to-end

**Files:**
- Create: `apps/e2e/tests/members/member-edit.spec.ts`

**Interfaces:**
- Consumes:
  - `DuesPageObject`: `goToImport`, `goToMembers`, `uploadAndConfirmRoster`, `searchFor`, `memberRow`, `openMember`, `createRoleWithMembersViewOnly`;
  - `buildOneRowRosterFixture` from `../dues/dues.po`;
  - `AuthPageObject.signUpFlow` from `../authentication/auth.po`;
  - `RbacPageObject`: `promoteToAdministrator`, `goToRoles`, `goToUsers`, `changeUserRole`, from `../rbac/rbac.po`;
  - test IDs from Task 4.

- [ ] **Step 1: Write the spec**

`apps/e2e/tests/members/member-edit.spec.ts`:

```ts
/**
 * Member editing end to end: an administrator corrects a member's phone and
 * city in the dialog and sees them in the roster; a user with members.view
 * only is offered no Edit control. Run against the Docker stack
 * (`pnpm stack:up`) and local Supabase, like the other member suites.
 */
import { BrowserContext, Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { DuesPageObject, buildOneRowRosterFixture } from '../dues/dues.po';
import { RbacPageObject } from '../rbac/rbac.po';

test.describe('Member editing', () => {
  test.describe.configure({ mode: 'serial' });

  const fixture = buildOneRowRosterFixture();

  let officerPage: Page;
  let officerRbac: RbacPageObject;
  let officerDues: DuesPageObject;
  let memberContext: BrowserContext;
  let memberId: string;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    officerRbac = new RbacPageObject(officerPage);
    officerDues = new DuesPageObject(officerPage);

    const officerEmail = await new AuthPageObject(officerPage).signUpFlow('/home');
    await officerRbac.promoteToAdministrator(officerEmail);
    await officerPage.reload();
  });

  test.afterAll(async () => {
    await officerPage.close();
    await memberContext?.close();
  });

  test('1. an administrator edits a phone and city and sees them in the roster', async () => {
    test.setTimeout(90_000);

    await officerDues.goToImport();
    await officerDues.uploadAndConfirmRoster(fixture);

    memberId = await officerDues.openMember(fixture.membershipNumber);
    await expect(officerPage.locator('[data-test="member-edit"]')).toBeVisible();

    await officerDues.goToMembers();
    await officerDues.searchFor(fixture.membershipNumber);

    const row = officerDues.memberRow(fixture.membershipNumber);
    await expect(row).toBeVisible();

    await row.locator(`[data-test="member-edit-${memberId}"]`).click();

    const dialog = officerPage.locator('[data-test="member-edit-dialog"]');
    await expect(dialog).toBeVisible();

    const phone = dialog.locator('[data-test="member-edit-phone_cell"]');
    await expect(phone).toBeVisible();
    await phone.fill('(314) 555-0142');
    await dialog.locator('[data-test="member-edit-city"]').fill('Florissant');

    await dialog.locator('[data-test="member-edit-save"]').click();

    await expect(officerPage.getByText('Member updated.')).toBeVisible();
    await expect(dialog).toBeHidden();

    await expect(row.locator('[data-test="member-phone"]')).toHaveText('(314) 555-0142');
    await expect(row).toContainText('Florissant');
  });

  test('2. a user with members.view only sees no Edit control', async ({ browser }) => {
    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    const memberEmail = await new AuthPageObject(memberPage).signUpFlow('/home');

    await officerRbac.goToRoles();
    const roleName = await officerDues.createRoleWithMembersViewOnly();
    await officerRbac.goToUsers();
    await officerRbac.changeUserRole(memberEmail, roleName);
    await expect(officerPage.getByText('Role updated.')).toBeVisible();

    await memberPage.goto('/home/members');
    await expect(
      memberPage.getByRole('heading', { name: 'Members', level: 1 }),
    ).toBeVisible();
    await expect(memberPage.locator('[data-test^="member-edit-"]')).toHaveCount(0);

    await memberPage.goto(`/home/members/${memberId}`);
    await expect(memberPage.locator('[data-test="member-roster-details"]')).toBeVisible();
    await expect(memberPage.locator('[data-test="member-edit"]')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it against a rebuilt stack**

Run:
```bash
pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/members/member-edit.spec.ts
```
Expected: 2 passed. The global teardown then removes the fixture member, its users and the viewer role.

If the stack is already running for the user, rebuild with `pnpm stack:up`. That's the same command, and it rebuilds the images in place.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/members/member-edit.spec.ts
git commit -m "test(e2e): administrator edits a member; a viewer cannot"
```
