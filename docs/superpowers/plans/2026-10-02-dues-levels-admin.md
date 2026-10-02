# Dues Levels Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finance officers add, edit, retire (moving members) and restore dues levels from Settings → Dues levels. A payment created before a price change or a retirement still records its dues period.

**Architecture:**
- **Database:**
  - Three security-definer functions write `public.dues_levels`, gated by `kit.assert_finance_manage()` and logged to a new `public.dues_level_changes` table.
  - One more function lists the levels for the admin page.
  - The online-payment trigger judges a payment against the level *as it was when the payment was created*, reconstructed from that log.
- **Portal:**
  - `DuesService` methods and zod schemas.
  - Server actions that return their failures instead of throwing.
  - A client `DuesLevelsManager` on a new settings page.

**Tech Stack:**
- Database: Postgres 17 (Supabase CLI), plpgsql, pgTAP.
- Portal: Next.js 16 server components and server actions, zod 4.4, react-hook-form, Base UI (`@kit/ui`).
- Tests: Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-dues-levels-admin-design.md`

## Global Constraints

- **Access:**
  - Every write and the admin list require `finance.manage` (`kit.assert_finance_manage()`, which raises `forbidden` with SQLSTATE `42501`).
  - The page guard is `requirePermission('finance', 'manage')`.
- **Slugs:**
  - A level's `slug` never changes after it is created.
  - New slugs are generated as follows:
    1. Lowercase the name.
    2. Replace every run of `[^a-z0-9]` with `_`.
    3. Trim `_` from both ends; if nothing is left, use `level`.
    4. On a clash, append `_2`, `_3`, and so on.
- **Names:**
  - Trimmed, 1–80 characters.
  - Unique among all levels, retired ones included, ignoring case.
- **Amounts:** whole cents from 0 to 100000. The UI takes dollars from 0 to 1000 with at most 2 decimals.
- **Retiring:**
  - The move and the retirement happen in one transaction.
  - A target level (`p_move_to`) is required when any member is on the level.
  - The target must be active and different from the level being retired.
  - No retirement or edit may leave zero active `self_service` levels.
- **Messages:** user-facing database messages are raised as plain `raise exception '…'` (SQLSTATE `P0001`) and shown verbatim. They are:
  - `Another level is already named <name>`
  - `At least one level members can choose must stay active`
  - `Choose another level to move this level's members to`
  - `Members can only be moved to an active level`
  - `That level is not active`
  - `That level is not retired`
  - `A level name is required (at most 80 characters)`
  - `The amount must be between $0 and $1,000`
  - `That level does not exist`
  - `Choose whether members can pick this level, and its order`
- **Grants:**
  - `kit.*` helpers revoke all from `public, anon, authenticated`. `kit_authenticated_grants.test.sql` pins the exact executable set.
  - New `public` functions revoke from `public, anon` and grant execute to `authenticated`.
  - The new table revokes all from `anon, authenticated` and grants select to `authenticated`.
- **Migration filenames** must sort after `20261003120200_event_emails_hardening.sql`.
- **Copy:** this is officer-facing, so plain, polite sentences.
- **Formatting and imports:**
  - Format with `npx oxfmt <changed files>` (never a whole directory) and lint with `npx oxlint <paths>`.
  - UI imports are `@kit/ui/<name>`. Use `render`, never `asChild`. Add `data-test` attributes on everything the tests touch.

## Review Focus

1. **Payments that straddle a change.**
   - **Input:** a payment created at the old price, or on a level later retired, succeeds after the change. Bank (ACH) payments stay `processing` for days.
   - **Expected:** the dues period is still recorded, at the amount charged.
   - **Tests:** Task 2, both straddle cases.
2. **Editing away the last self-service level.**
   - **Input:** the officer unticks "Members choose it" on the only active self-service level.
   - **Expected:** refused with the same message as retiring it.
   - **Test:** Task 1.
3. **Renaming to an existing name in different case** ("regular" vs "Regular"), including a retired level's name.
   - **Expected:** refused.
   - **Test:** Task 1.
4. **Amounts typed with a `$`, a comma, or three decimals** ("$58", "1,000", "58.005").
   - **Expected:** the form rejects them with a clear message and never sends rounded cents.
   - **Test:** Task 3, schema tests.
5. **Retiring a level with zero members, no target chosen.**
   - **Expected:** it retires; nobody is moved; the log has an empty `moved_member_ids`.
   - **Tests:** Task 1, and Task 4 hides the select.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/portal/supabase/migrations/20261004120000_dues_levels_admin.sql` | The log table and the slug helper; `save_dues_level`, `retire_dues_level`, `restore_dues_level` and `dues_levels_admin` |
| `apps/portal/supabase/migrations/20261004120100_dues_level_price_at_payment.sql` | `kit.dues_level_as_of`, plus `kit.record_online_dues_period` judging the payment's level as of its creation |
| `apps/portal/supabase/tests/dues_levels_admin.test.sql` | pgTAP for migration 1 |
| `apps/portal/supabase/tests/dues_level_price_at_payment.test.sql` | pgTAP for migration 2 |
| `packages/supabase/src/database.types.ts`, `apps/portal/lib/database.types.ts` | Regenerated types |
| `packages/features/dues/src/types.ts` | `AdminDuesLevel` |
| `packages/features/dues/src/schemas.ts` (+ `.test.ts`) | `SaveDuesLevelSchema`, `RetireDuesLevelSchema`, `dollarsToCents`, `priceChangeNotice` |
| `packages/features/dues/src/server/dues.service.ts` | `adminLevels`, `saveLevel`, `retireLevel`, `restoreLevel` |
| `packages/features/dues/src/server/dues-level-actions.ts` | Server actions |
| `packages/features/dues/src/components/dues-levels-manager.tsx` (+ test) | The table and the Restore button |
| `packages/features/dues/src/components/dues-level-form-dialog.tsx` | The Add/Edit dialog |
| `packages/features/dues/src/components/retire-dues-level-dialog.tsx` (+ test) | The Retire dialog; exports `RetireLevelFields` for tests |
| `packages/brand/src/config/paths.config.ts`, `packages/brand/i18n/messages/en/common.json`, `apps/portal/config/navigation.config.tsx` | The route, its label and the navigation entry |
| `apps/portal/app/home/settings/dues-levels/page.tsx` | The page |
| `apps/e2e/tests/dues/dues-levels.po.ts`, `apps/e2e/tests/dues/dues-levels.spec.ts` | End-to-end tests |

**Database test command** (Docker and local Supabase running; `pnpm supabase:web:start` from the repo root):
`pnpm --filter portal exec supabase db reset && pnpm --filter portal supabase:test`

---

### Task 1: Database — log table and the level write functions

**Files:**
- Create: `apps/portal/supabase/migrations/20261004120000_dues_levels_admin.sql`
- Test: `apps/portal/supabase/tests/dues_levels_admin.test.sql`

**Interfaces:**
- Produces:
  - **Table:** `public.dues_level_changes(id bigint, level text, action text, changed_by uuid, changed_at timestamptz, before jsonb, after jsonb, moved_to text, moved_member_ids uuid[])`.
  - **Functions:**
    - `public.save_dues_level(p_name text, p_amount_cents integer, p_self_service boolean, p_sort_order integer, p_slug text default null) returns text`. `p_slug` comes last, with a default, so the generated TypeScript type makes it optional. The spec lists it first; this order is deliberate.
    - `public.retire_dues_level(p_slug text, p_move_to text default null) returns integer`
    - `public.restore_dues_level(p_slug text) returns void`
    - `public.dues_levels_admin() returns table(slug text, name text, amount_cents integer, self_service boolean, sort_order integer, active boolean, member_count integer, changed_at timestamptz, changed_by_email text)`
  - **Kit helper:** `kit.dues_level_slug(p_name text) returns text`, revoked from authenticated.

- [ ] **Step 1: Write the failing pgTAP test**

`apps/portal/supabase/tests/dues_levels_admin.test.sql`:

```sql
-- Dues levels admin (2026-10-04): finance.manage writes dues_levels only
-- through save/retire/restore, each logged to dues_level_changes.
begin;
\ir helpers/dues_fixtures.inc
select plan(32);

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
select is((select moved_member_ids @> array[:'m1'::uuid, :'m2'::uuid] and moved_to = 'regular'
             from public.dues_level_changes where level = 'public_service_2027' and action = 'retire'),
  true, 'the retirement logs who moved and where');
select is(public.retire_dues_level('public_service_2027_2'), 0, 'a level with no members retires without a target');

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

-- 32: the admin list includes retired levels, member counts and the last change
select is((select row(active, member_count, changed_by_email)::text from public.dues_levels_admin()
            where slug = 'public_service_2027'),
  row(true, 0, 'levels-fs@example.com')::text, 'the admin list shows status, members and who changed it last');
reset role;

select * from finish();
rollback;
```

Also update `apps/portal/supabase/tests/dues_table_grants.test.sql`: change `plan(28)` to `plan(32)` and add these four checks before `select * from finish();`:

```sql
select ok(not has_table_privilege('authenticated', 'public.dues_level_changes', 'INSERT'), 'authenticated cannot insert level changes');
select ok(not has_table_privilege('authenticated', 'public.dues_level_changes', 'UPDATE'), 'authenticated cannot update level changes');
select ok(not has_table_privilege('authenticated', 'public.dues_level_changes', 'DELETE'), 'authenticated cannot delete level changes');
select ok(not has_table_privilege('anon', 'public.dues_level_changes', 'SELECT'), 'anon cannot read level changes');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter portal exec supabase db reset && pnpm --filter portal supabase:test`
Expected: `dues_levels_admin.test.sql` fails with `function public.save_dues_level(...) does not exist`. The grants test fails on the missing table.

- [ ] **Step 3: Write the migration**

`apps/portal/supabase/migrations/20261004120000_dues_levels_admin.sql`:

```sql
-- Dues levels admin: finance.manage adds, edits, retires (moving members) and
-- restores dues levels from the portal. Writes only through the functions
-- below; every change is logged to dues_level_changes, which the online
-- payment trigger also reads to judge a payment against the level as it was
-- when the payment was created (20261004120100).

create table public.dues_level_changes (
  id               bigint generated always as identity primary key,
  level            text not null references public.dues_levels (slug),
  action           text not null check (action in ('create', 'update', 'retire', 'restore')),
  changed_by       uuid references auth.users (id) on delete set null,
  changed_at       timestamptz not null default now(),
  before           jsonb,
  after            jsonb not null,
  moved_to         text references public.dues_levels (slug),
  moved_member_ids uuid[] not null default '{}'
);
create index dues_level_changes_level_at on public.dues_level_changes (level, changed_at);

alter table public.dues_level_changes enable row level security;
create policy dues_level_changes_select on public.dues_level_changes
  for select to authenticated using (kit.has_permission('finance', 'view'));
revoke all on public.dues_level_changes from anon, authenticated;
grant select on public.dues_level_changes to authenticated;

create or replace function kit.dues_level_slug(p_name text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text := trim(both '_' from regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'));
  v_slug text;
  v_n    int := 1;
begin
  if v_base = '' then v_base := 'level'; end if;
  v_slug := v_base;
  while exists (select 1 from public.dues_levels where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '_' || v_n;
  end loop;
  return v_slug;
end $$;
revoke all on function kit.dues_level_slug(text) from public, anon, authenticated;

-- Raises unless some active level remains that members can choose
-- themselves; checkout offers self-service members nothing otherwise.
create or replace function kit.assert_self_service_level_remains()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.dues_levels where active and self_service) then
    raise exception 'At least one level members can choose must stay active';
  end if;
end $$;
revoke all on function kit.assert_self_service_level_remains() from public, anon, authenticated;

create or replace function public.save_dues_level(
  p_name text, p_amount_cents integer, p_self_service boolean, p_sort_order integer,
  p_slug text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_before public.dues_levels;
  v_after  public.dues_levels;
begin
  perform kit.assert_finance_manage();

  if v_name = '' or length(v_name) > 80 then
    raise exception 'A level name is required (at most 80 characters)';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > 100000 then
    raise exception 'The amount must be between $0 and $1,000';
  end if;
  if p_self_service is null or p_sort_order is null then
    raise exception 'Choose whether members can pick this level, and its order';
  end if;
  if exists (select 1 from public.dues_levels
              where lower(name) = lower(v_name) and slug is distinct from p_slug) then
    raise exception 'Another level is already named %', v_name;
  end if;

  if p_slug is null then
    insert into public.dues_levels (slug, name, amount_cents, self_service, sort_order)
    values (kit.dues_level_slug(v_name), v_name, p_amount_cents, p_self_service, p_sort_order)
    returning * into v_after;

    insert into public.dues_level_changes (level, action, changed_by, before, after)
    values (v_after.slug, 'create', auth.uid(), null, to_jsonb(v_after));

    return v_after.slug;
  end if;

  select * into v_before from public.dues_levels where slug = p_slug for update;
  if not found then
    raise exception 'That level does not exist';
  end if;

  update public.dues_levels
     set name = v_name, amount_cents = p_amount_cents,
         self_service = p_self_service, sort_order = p_sort_order
   where slug = p_slug
  returning * into v_after;

  perform kit.assert_self_service_level_remains();

  if to_jsonb(v_after) is distinct from to_jsonb(v_before) then
    insert into public.dues_level_changes (level, action, changed_by, before, after)
    values (p_slug, 'update', auth.uid(), to_jsonb(v_before), to_jsonb(v_after));
  end if;

  return p_slug;
end $$;

create or replace function public.retire_dues_level(p_slug text, p_move_to text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_before public.dues_levels;
  v_after  public.dues_levels;
  v_moved  uuid[];
begin
  perform kit.assert_finance_manage();

  select * into v_before from public.dues_levels where slug = p_slug for update;
  if not found or not v_before.active then
    raise exception 'That level is not active';
  end if;

  if p_move_to is not null and p_move_to <> p_slug
     and not exists (select 1 from public.dues_levels where slug = p_move_to and active) then
    raise exception 'Members can only be moved to an active level';
  end if;

  if exists (select 1 from public.members where dues_level = p_slug)
     and (p_move_to is null or p_move_to = p_slug) then
    raise exception 'Choose another level to move this level''s members to';
  end if;

  with moved as (
    update public.members set dues_level = p_move_to
     where dues_level = p_slug
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_moved from moved;

  update public.dues_levels set active = false where slug = p_slug returning * into v_after;

  perform kit.assert_self_service_level_remains();

  insert into public.dues_level_changes (level, action, changed_by, before, after, moved_to, moved_member_ids)
  values (p_slug, 'retire', auth.uid(), to_jsonb(v_before), to_jsonb(v_after),
          case when cardinality(v_moved) > 0 then p_move_to end, v_moved);

  return cardinality(v_moved);
end $$;

create or replace function public.restore_dues_level(p_slug text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before public.dues_levels;
  v_after  public.dues_levels;
begin
  perform kit.assert_finance_manage();

  select * into v_before from public.dues_levels where slug = p_slug for update;
  if not found or v_before.active then
    raise exception 'That level is not retired';
  end if;

  update public.dues_levels set active = true where slug = p_slug returning * into v_after;

  insert into public.dues_level_changes (level, action, changed_by, before, after)
  values (p_slug, 'restore', auth.uid(), to_jsonb(v_before), to_jsonb(v_after));
end $$;

create or replace function public.dues_levels_admin()
returns table (
  slug text, name text, amount_cents integer, self_service boolean, sort_order integer,
  active boolean, member_count integer, changed_at timestamptz, changed_by_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();

  return query
  select l.slug, l.name, l.amount_cents, l.self_service, l.sort_order, l.active,
         (select count(*)::int from public.members m where m.dues_level = l.slug),
         c.changed_at, u.email::text
    from public.dues_levels l
    left join lateral (
      select x.changed_at, x.changed_by from public.dues_level_changes x
       where x.level = l.slug
       order by x.changed_at desc, x.id desc
       limit 1) c on true
    left join auth.users u on u.id = c.changed_by
   order by l.active desc, l.sort_order, l.name;
end $$;

revoke all on function public.save_dues_level(text, integer, boolean, integer, text) from public, anon;
revoke all on function public.retire_dues_level(text, text) from public, anon;
revoke all on function public.restore_dues_level(text) from public, anon;
revoke all on function public.dues_levels_admin() from public, anon;
grant execute on function public.save_dues_level(text, integer, boolean, integer, text) to authenticated;
grant execute on function public.retire_dues_level(text, text) to authenticated;
grant execute on function public.restore_dues_level(text) to authenticated;
grant execute on function public.dues_levels_admin() to authenticated;
```

**Note on the self-service check:** in both `save` and `retire`, `assert_self_service_level_remains` runs *after* the row change. When it raises, the whole statement is rolled back, so nothing is left half-done.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter portal exec supabase db reset && pnpm --filter portal supabase:test`
Expected: every file passes, including `dues_levels_admin.test.sql` (32), `dues_table_grants.test.sql` (32) and `kit_authenticated_grants.test.sql`, which must stay unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/supabase/migrations/20261004120000_dues_levels_admin.sql apps/portal/supabase/tests/dues_levels_admin.test.sql apps/portal/supabase/tests/dues_table_grants.test.sql
git commit -m "feat(dues): save, retire and restore dues levels, logged"
```

---

### Task 2: Database — judge a payment against its level as of creation

**Files:**
- Create: `apps/portal/supabase/migrations/20261004120100_dues_level_price_at_payment.sql`
- Test: `apps/portal/supabase/tests/dues_level_price_at_payment.test.sql`

**Interfaces:**
- Consumes: `public.dues_level_changes` and the write functions from Task 1.
- Produces:
  - `kit.dues_level_as_of(p_slug text, p_at timestamptz) returns public.dues_levels`. It is revoked from authenticated, and returns a row of nulls when the level is unknown.
  - A replaced `kit.record_online_dues_period(uuid)` with the same signature.

- [ ] **Step 1: Write the failing pgTAP test**

The test transaction gives every `now()` the same value. Payments are therefore inserted with `created_at = now() - interval '1 hour'`, so each level change counts as *after* the payment.

`apps/portal/supabase/tests/dues_level_price_at_payment.test.sql`:

```sql
-- 20261004120100: a dues payment is judged against its level as it was when
-- the payment was created, so a price change or a retirement while a bank
-- payment is processing does not strand it.
begin;
\ir helpers/dues_fixtures.inc
select plan(6);

select tests.make_user('straddle-fs@example.com', 'administrator') as fs \gset
select tests.make_user('straddle-a@example.com', 'member') as ua \gset
select tests.make_user('straddle-b@example.com', 'member') as ub \gset
select tests.make_user('straddle-c@example.com', 'member') as uc \gset
select tests.make_member('420001', :'ua') as ma \gset
select tests.make_member('420002', :'ub') as mb \gset
select tests.make_member('420003', :'uc') as mc \gset
update public.members set accepted_on = current_date - 10 where id in (:'ma', :'mb', :'mc');

-- An FS-assigned level for member B, so availability depends on assignment.
select tests.act_as(:'fs');
select public.save_dues_level('Straddle Honorary', 1900, false, 20) as hon \gset
reset role;
update public.members set dues_level = :'hon' where id = :'mb';

-- Three bank payments created an hour ago, still processing.
set local role service_role;
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata, created_at)
values
  ('00000000-0000-0000-0000-0000000d1001', :'ua', 'stripe', 'pi_straddle_a', 5000, 'processing', 'dues',
   '{"dues_level": "regular"}', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000d1002', :'ub', 'stripe', 'pi_straddle_b', 1900, 'processing', 'dues',
   jsonb_build_object('dues_level', :'hon'), now() - interval '1 hour');
reset role;

-- While they process: Regular goes up to $55; Straddle Honorary is retired,
-- its member moved to Regular.
select tests.act_as(:'fs');
select public.save_dues_level('Regular', 5500, true, 2, 'regular') as _priced \gset
select public.retire_dues_level(:'hon', 'regular') as _retired \gset
reset role;

-- Payment C is created after the price change, at the old price.
set local role service_role;
insert into public.payments (id, user_id, provider, provider_payment_id, amount, status, payment_type, metadata)
values ('00000000-0000-0000-0000-0000000d1003', :'uc', 'stripe', 'pi_straddle_c', 5000, 'processing', 'dues',
        '{"dues_level": "regular"}');

update public.payments set status = 'succeeded'
 where provider_payment_id in ('pi_straddle_a', 'pi_straddle_b', 'pi_straddle_c');
reset role;

select is((select count(*)::int from public.dues_periods where member_id = :'ma'), 1,
  'a payment created before a price change still records its period');
select is((select amount_cents from public.dues_periods where member_id = :'ma'), 5000,
  'at the amount actually charged');
select is((select count(*)::int from public.dues_periods where member_id = :'mb'), 1,
  'a payment on a level retired while it processed still records its period');
select is((select level from public.dues_periods where member_id = :'mb'), :'hon',
  'on the level it was paid for');
select is((select count(*)::int from public.dues_periods where member_id = :'mc'), 0,
  'a payment created after the change at the old price records nothing');

-- kit.dues_level_as_of stays internal
select ok(not has_function_privilege('authenticated', 'kit.dues_level_as_of(text, timestamptz)', 'EXECUTE'),
  'authenticated cannot call kit.dues_level_as_of');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter portal exec supabase db reset && pnpm --filter portal supabase:test`
Expected: the new file fails. Member A gets 0 periods because the amount no longer matches the current price.

- [ ] **Step 3: Write the migration**

This replaces `kit.record_online_dues_period` in full. The only behavioural changes:
- the level comes from `kit.dues_level_as_of(..., v_pay.created_at)`;
- availability also accepts a member moved off the level by a later retirement.

`apps/portal/supabase/migrations/20261004120100_dues_level_price_at_payment.sql`:

```sql
-- A dues payment is judged against its level as it was when the payment was
-- CREATED, not as it is when it succeeds. Bank payments stay processing for
-- days; without this, a price change or a retirement in that window would
-- leave the member's money received but no dues period recorded.

-- The level's row as of p_at: the `before` of its earliest change after p_at,
-- else the current row. Fields are all null when the level is unknown.
create or replace function kit.dues_level_as_of(p_slug text, p_at timestamptz)
returns public.dues_levels language plpgsql stable security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_level  public.dues_levels;
begin
  select c.before into v_before
    from public.dues_level_changes c
   where c.level = p_slug and c.changed_at > p_at and c.before is not null
   order by c.changed_at, c.id
   limit 1;

  if v_before is not null then
    return jsonb_populate_record(null::public.dues_levels, v_before);
  end if;

  select * into v_level from public.dues_levels where slug = p_slug;
  return v_level;
end $$;
revoke all on function kit.dues_level_as_of(text, timestamptz) from public, anon, authenticated;

create or replace function kit.record_online_dues_period(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pay         public.payments;
  v_member      public.members;
  v_lvl         public.dues_levels;
  v_start       date;
  v_received_on date;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found or v_pay.payment_type <> 'dues' then return; end if;

  select * into v_member from public.members where user_id = v_pay.user_id for update;
  if not found then
    raise warning 'dues payment % has no linked member; no period recorded', p_payment_id;
    return;
  end if;

  -- Never trust the client's level or amount (fix round 1, C1), now judged
  -- as of the payment's creation (20261004120100).
  if coalesce(jsonb_typeof(v_pay.metadata), '') <> 'object' then
    raise warning 'dues payment % has no usable metadata; no period recorded', p_payment_id;
    return;
  end if;

  v_lvl := kit.dues_level_as_of(v_pay.metadata ->> 'dues_level', v_pay.created_at);
  if v_lvl.slug is null or not v_lvl.active then
    raise warning 'dues payment % names an unknown or inactive dues level; no period recorded', p_payment_id;
    return;
  end if;

  if not (v_lvl.self_service
          or v_lvl.slug = v_member.dues_level
          or (v_lvl.slug = 'student' and v_member.is_student)
          or exists (select 1 from public.dues_level_changes c
                      where c.level = v_lvl.slug and c.action = 'retire'
                        and c.changed_at > v_pay.created_at
                        and v_member.id = any (c.moved_member_ids))) then
    raise warning 'dues payment % chose a level not available to this member; no period recorded', p_payment_id;
    return;
  end if;

  if v_pay.amount <> v_lvl.amount_cents then
    raise warning 'dues payment % amount % does not match % price %; no period recorded',
      p_payment_id, v_pay.amount, v_lvl.slug, v_lvl.amount_cents;
    return;
  end if;

  v_received_on := (now() at time zone 'America/Chicago')::date;
  v_start := coalesce(kit.dues_next_period_start(v_member.id), v_received_on);

  insert into public.dues_periods
    (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
  values
    (v_member.id, v_lvl.slug, v_lvl.amount_cents, 'online', v_received_on, v_start, v_start + 365, v_pay.id)
  on conflict (payment_id) do nothing;
end $$;
revoke all on function kit.record_online_dues_period(uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter portal exec supabase db reset && pnpm --filter portal supabase:test`
Expected: all files pass. The existing `dues_online_and_load.test.sql` and `dues_payment_contract.test.sql` must stay green: with no changes logged, `dues_level_as_of` returns the current row, exactly as before.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/supabase/migrations/20261004120100_dues_level_price_at_payment.sql apps/portal/supabase/tests/dues_level_price_at_payment.test.sql
git commit -m "fix(dues): judge an online payment by its level as of creation"
```

---

### Task 3: Types, schemas, service and actions

**Files:**
- Regenerate: `packages/supabase/src/database.types.ts`, `apps/portal/lib/database.types.ts`
- Modify: `packages/features/dues/src/types.ts`, `packages/features/dues/src/schemas.ts`, `packages/features/dues/src/server/dues.service.ts`
- Create: `packages/features/dues/src/server/dues-level-actions.ts`
- Test: `packages/features/dues/src/schemas.test.ts`

**Interfaces:**
- Consumes: the Task 1 functions (via the generated types).
- Produces:
  - `AdminDuesLevel` (in `@kit/dues/types`).
  - `SaveDuesLevelSchema`, `RetireDuesLevelSchema`, `dollarsToCents(amount: string): number` and `priceChangeNotice(savedCents: number | null, entered: string): string | null` (in `@kit/dues/schemas`).
  - `DuesService.adminLevels(): Promise<AdminDuesLevel[]>`, `saveLevel(input: { slug: string | null; name: string; amountCents: number; selfService: boolean; sortOrder: number }): Promise<string>`, `retireLevel(slug: string, moveTo: string | null): Promise<number>` and `restoreLevel(slug: string): Promise<void>`.
  - The actions `saveDuesLevelAction`, `retireDuesLevelAction` and `restoreDuesLevelAction`, all returning `DuesLevelActionResult = { success: true } | { success: false; error: string }`.

- [ ] **Step 1: Regenerate the database types**

Run: `pnpm --filter portal supabase:typegen`
Expected: `git diff --stat` shows both `database.types.ts` files gaining `dues_level_changes`, `save_dues_level`, `retire_dues_level`, `restore_dues_level` and `dues_levels_admin`. Check that `save_dues_level`'s `Args` has `p_slug?: string` and `retire_dues_level`'s has `p_move_to?: string`.

- [ ] **Step 2: Write the failing schema tests**

Append to `packages/features/dues/src/schemas.test.ts`, and add `dollarsToCents, priceChangeNotice, RetireDuesLevelSchema, SaveDuesLevelSchema` to its import from `./schemas`:

```ts
describe('SaveDuesLevelSchema', () => {
  const level = {
    slug: null,
    name: 'Public Service',
    amount: '20',
    selfService: false,
    sortOrder: '4',
  };

  it('accepts whole dollars and dollars with cents', () => {
    expect(SaveDuesLevelSchema.safeParse(level).success).toBe(true);
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, amount: '58.50' }).success,
    ).toBe(true);
  });

  it.each(['$58', '1,000', '58.005', '-1', '', 'abc'])(
    'rejects the amount %j rather than guessing',
    (amount) => {
      expect(SaveDuesLevelSchema.safeParse({ ...level, amount }).success).toBe(
        false,
      );
    },
  );

  it('caps the amount at $1,000', () => {
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, amount: '1000' }).success,
    ).toBe(true);
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, amount: '1000.01' }).success,
    ).toBe(false);
  });

  it('trims the name and refuses blank or over-long names', () => {
    const parsed = SaveDuesLevelSchema.parse({ ...level, name: '  Student  ' });
    expect(parsed.name).toBe('Student');
    expect(SaveDuesLevelSchema.safeParse({ ...level, name: '   ' }).success).toBe(
      false,
    );
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, name: 'x'.repeat(81) }).success,
    ).toBe(false);
  });

  it('needs a whole-number order', () => {
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, sortOrder: '2.5' }).success,
    ).toBe(false);
  });
});

describe('dollarsToCents', () => {
  it('converts without floating-point drift', () => {
    expect(dollarsToCents('58')).toBe(5800);
    expect(dollarsToCents('19.99')).toBe(1999);
    expect(dollarsToCents('0.1')).toBe(10);
    expect(dollarsToCents('1000')).toBe(100000);
  });
});

describe('priceChangeNotice', () => {
  it('says a new price applies from now on only when it changed', () => {
    expect(priceChangeNotice(5800, '60')).toBe(
      'Applies to payments made from now on. Recorded dues keep the amount paid.',
    );
    expect(priceChangeNotice(5800, '58.00')).toBeNull();
    expect(priceChangeNotice(null, '58')).toBeNull();
    expect(priceChangeNotice(5800, 'abc')).toBeNull();
  });
});

describe('RetireDuesLevelSchema', () => {
  it('requires a level to move members to when there are any', () => {
    expect(
      RetireDuesLevelSchema.safeParse({
        slug: 'honorary',
        memberCount: 3,
        moveTo: '',
      }).success,
    ).toBe(false);
    expect(
      RetireDuesLevelSchema.safeParse({
        slug: 'honorary',
        memberCount: 3,
        moveTo: 'regular',
      }).success,
    ).toBe(true);
  });

  it('needs no target when nobody is on the level', () => {
    expect(
      RetireDuesLevelSchema.safeParse({
        slug: 'honorary',
        memberCount: 0,
        moveTo: '',
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd packages/features/dues && ./node_modules/.bin/vitest run src/schemas.test.ts`
Expected: FAIL, with `SaveDuesLevelSchema` etc. not exported.

- [ ] **Step 4: Implement the schemas, types, service methods and actions**

Append to `packages/features/dues/src/schemas.ts`:

```ts
/** Plain dollars, at most two decimals: `58`, `58.5`, `58.50`. No `$`, no
 * commas -- anything else is refused rather than guessed at. */
const DOLLARS = /^\d{1,4}(\.\d{1,2})?$/;

export const SaveDuesLevelSchema = z.object({
  slug: z.string().min(1).nullable(),
  name: z
    .string()
    .trim()
    .min(1, 'A name is required')
    .max(80, 'At most 80 characters'),
  amount: z
    .string()
    .regex(DOLLARS, 'Enter dollars like 58 or 58.50')
    .refine((value) => Number(value) <= 1000, 'At most $1,000'),
  selfService: z.boolean(),
  sortOrder: z.string().regex(/^\d{1,3}$/, 'A whole number, 0 to 999'),
});

export type SaveDuesLevelValues = z.infer<typeof SaveDuesLevelSchema>;

export const RetireDuesLevelSchema = z
  .object({
    slug: z.string().min(1),
    memberCount: z.number().int().min(0),
    moveTo: z.string(),
  })
  .refine((value) => value.memberCount === 0 || value.moveTo !== '', {
    message: 'Choose a level to move these members to',
    path: ['moveTo'],
  });

export type RetireDuesLevelValues = z.infer<typeof RetireDuesLevelSchema>;

/** `'19.99'` -> `1999`, split on the point so no float ever rounds a cent. */
export function dollarsToCents(amount: string): number {
  const [whole, fraction = ''] = amount.split('.');

  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** The dialog's note when an edit changes a saved price, else `null`. */
export function priceChangeNotice(
  savedCents: number | null,
  entered: string,
): string | null {
  if (savedCents === null || !DOLLARS.test(entered)) {
    return null;
  }

  return dollarsToCents(entered) === savedCents
    ? null
    : 'Applies to payments made from now on. Recorded dues keep the amount paid.';
}
```

Append to `packages/features/dues/src/types.ts`:

```ts
/** One row of the Dues levels admin page (`dues_levels_admin`): every level,
 * retired ones included, with how many members are on it and its last change. */
export interface AdminDuesLevel extends DuesLevel {
  sortOrder: number;
  active: boolean;
  memberCount: number;
  changedAt: string | null;
  changedByEmail: string | null;
}
```

In `packages/features/dues/src/server/dues.service.ts`, add `AdminDuesLevel` to the `../types` import and add these methods to `DuesService`, after `levels()`:

```ts
  async adminLevels(): Promise<AdminDuesLevel[]> {
    const { data, error } = await this.client.rpc('dues_levels_admin');

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      slug: row.slug,
      name: row.name,
      amountCents: row.amount_cents,
      selfService: row.self_service,
      sortOrder: row.sort_order,
      active: row.active,
      memberCount: row.member_count,
      changedAt: row.changed_at,
      changedByEmail: row.changed_by_email,
    }));
  }

  /** Creates (`slug: null`) or edits a level; returns its slug. */
  async saveLevel(input: {
    slug: string | null;
    name: string;
    amountCents: number;
    selfService: boolean;
    sortOrder: number;
  }): Promise<string> {
    const { data, error } = await this.client.rpc('save_dues_level', {
      p_name: input.name,
      p_amount_cents: input.amountCents,
      p_self_service: input.selfService,
      p_sort_order: input.sortOrder,
      p_slug: input.slug ?? undefined,
    });

    if (error) {
      throw error;
    }

    return data;
  }

  /** Retires a level, moving its members to `moveTo`; returns how many moved. */
  async retireLevel(slug: string, moveTo: string | null): Promise<number> {
    const { data, error } = await this.client.rpc('retire_dues_level', {
      p_slug: slug,
      p_move_to: moveTo ?? undefined,
    });

    if (error) {
      throw error;
    }

    return data;
  }

  async restoreLevel(slug: string): Promise<void> {
    const { error } = await this.client.rpc('restore_dues_level', {
      p_slug: slug,
    });

    if (error) {
      throw error;
    }
  }
```

Create `packages/features/dues/src/server/dues-level-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  RetireDuesLevelSchema,
  SaveDuesLevelSchema,
  dollarsToCents,
} from '../schemas';
import { DuesService } from './dues.service';

/** Failures are returned, never thrown: Next redacts thrown action messages
 * in production (see `dues-actions.ts`). */
export type DuesLevelActionResult =
  | { success: true }
  | { success: false; error: string };

function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to manage dues levels.';
    // The functions raise plain, user-facing sentences (P0001).
    case 'P0001':
      return e.message ?? 'The dues level change was refused.';
    default:
      return 'Something went wrong saving the dues level.';
  }
}

async function run(
  fn: (service: DuesService) => Promise<unknown>,
): Promise<DuesLevelActionResult> {
  try {
    await fn(new DuesService(getSupabaseServerClient()));

    revalidatePath('/home/settings/dues-levels');
    revalidatePath('/home/checkout');
    revalidatePath('/home');

    return { success: true };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

function invalid(issues: { message: string }[]): DuesLevelActionResult {
  return { success: false, error: issues[0]?.message ?? 'Invalid input' };
}

export const saveDuesLevelAction = enhanceAction(async (data: unknown) => {
  const parsed = SaveDuesLevelSchema.safeParse(data);

  if (!parsed.success) {
    return invalid(parsed.error.issues);
  }

  const { slug, name, amount, selfService, sortOrder } = parsed.data;

  return run((service) =>
    service.saveLevel({
      slug,
      name,
      amountCents: dollarsToCents(amount),
      selfService,
      sortOrder: Number(sortOrder),
    }),
  );
}, {});

export const retireDuesLevelAction = enhanceAction(async (data: unknown) => {
  const parsed = RetireDuesLevelSchema.safeParse(data);

  if (!parsed.success) {
    return invalid(parsed.error.issues);
  }

  const { slug, moveTo } = parsed.data;

  return run((service) => service.retireLevel(slug, moveTo || null));
}, {});

export const restoreDuesLevelAction = enhanceAction(async (data: unknown) => {
  const slug = (data as { slug?: unknown } | null)?.slug;

  if (typeof slug !== 'string' || slug === '') {
    return invalid([{ message: 'Invalid input' }]);
  }

  return run((service) => service.restoreLevel(slug));
}, {});
```

- [ ] **Step 5: Run the tests and typecheck**

Run:
```bash
cd packages/features/dues && ./node_modules/.bin/vitest run && cd ../../..
TSC=$PWD/node_modules/.pnpm/typescript@7.0.2/node_modules/typescript/bin/tsc
(cd packages/features/dues && node $TSC --noEmit) && (cd apps/portal && node $TSC --noEmit)
```
Expected: all dues tests pass, including the new ones; the typecheck prints nothing.

- [ ] **Step 6: Commit**

```bash
npx oxfmt packages/features/dues/src/schemas.ts packages/features/dues/src/schemas.test.ts packages/features/dues/src/types.ts packages/features/dues/src/server/dues.service.ts packages/features/dues/src/server/dues-level-actions.ts
git add packages/supabase/src/database.types.ts apps/portal/lib/database.types.ts packages/features/dues/src/schemas.ts packages/features/dues/src/schemas.test.ts packages/features/dues/src/types.ts packages/features/dues/src/server/dues.service.ts packages/features/dues/src/server/dues-level-actions.ts
git commit -m "feat(dues): service, schemas and actions for managing dues levels"
```

---

### Task 4: The Dues levels manager components

**Files:**
- Create: `packages/features/dues/src/components/dues-levels-manager.tsx`, `packages/features/dues/src/components/dues-level-form-dialog.tsx`, `packages/features/dues/src/components/retire-dues-level-dialog.tsx`
- Test: `packages/features/dues/src/components/dues-levels-manager.test.tsx`, `packages/features/dues/src/components/retire-dues-level-dialog.test.tsx`

**Interfaces:**
- Consumes: `AdminDuesLevel`; `SaveDuesLevelSchema`, `SaveDuesLevelValues`, `RetireDuesLevelSchema`, `RetireDuesLevelValues` and `priceChangeNotice`; the three actions; `formatAmountCents` from `../lib/format-amount`.
- Produces:
  - `DuesLevelsManager({ levels }: { levels: AdminDuesLevel[] })`;
  - `DuesLevelFormDialog({ level }: { level: AdminDuesLevel | null })`, where `null` means Add;
  - `RetireDuesLevelDialog({ level, levels })`;
  - `RetireLevelFields({ form, level, targets })` for tests.
- **`data-test` hooks (used by Task 5's end-to-end test):**
  - `dues-levels-table`, `dues-level-row` (with `data-slug`), `dues-level-status`, `add-dues-level`, `edit-dues-level`, `retire-dues-level`, `restore-dues-level`;
  - `dues-level-name`, `dues-level-amount`, `dues-level-self-service`, `dues-level-order`, `dues-level-price-notice`, `dues-level-save`;
  - `retire-move-to`, `retire-submit`.

- [ ] **Step 1: Write the failing tests**

`packages/features/dues/src/components/dues-levels-manager.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AdminDuesLevel } from '../types';
import { DuesLevelsManager } from './dues-levels-manager';

vi.mock('../server/dues-level-actions', () => ({
  saveDuesLevelAction: vi.fn(),
  retireDuesLevelAction: vi.fn(),
  restoreDuesLevelAction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const level = (overrides: Partial<AdminDuesLevel>): AdminDuesLevel => ({
  slug: 'regular',
  name: 'Regular',
  amountCents: 5000,
  selfService: true,
  sortOrder: 2,
  active: true,
  memberCount: 12,
  changedAt: null,
  changedByEmail: null,
  ...overrides,
});

describe('DuesLevelsManager', () => {
  const html = renderToStaticMarkup(
    <DuesLevelsManager
      levels={[
        level({}),
        level({
          slug: 'honorary',
          name: 'Honorary',
          amountCents: 1900,
          selfService: false,
          sortOrder: 5,
          active: false,
          memberCount: 0,
          changedAt: '2026-10-02T15:00:00Z',
          changedByEmail: 'fs@example.com',
        }),
      ]}
    />,
  );

  it('lists every level, retired ones included', () => {
    expect(html.split('data-test="dues-level-row"').length - 1).toBe(2);
    expect(html).toContain('data-slug="honorary"');
  });

  it('shows the price, who chooses it, the order and the members', () => {
    expect(html).toContain('$50.00');
    expect(html).toContain('$19.00');
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    expect(html).toContain('>12<');
  });

  it('marks retired levels and who last changed a level', () => {
    expect(html).toContain('Retired');
    expect(html).toContain('fs@example.com');
  });

  it('offers Retire on active levels and Restore only on retired ones', () => {
    expect(html.split('data-test="retire-dues-level"').length - 1).toBe(1);
    expect(html.split('data-test="restore-dues-level"').length - 1).toBe(1);
    expect(html).toContain('data-test="add-dues-level"');
  });
});
```

`packages/features/dues/src/components/retire-dues-level-dialog.test.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RetireDuesLevelSchema } from '../schemas';
import type { AdminDuesLevel } from '../types';
import { RetireLevelFields } from './retire-dues-level-dialog';

vi.mock('../server/dues-level-actions', () => ({
  retireDuesLevelAction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const honorary: AdminDuesLevel = {
  slug: 'honorary',
  name: 'Honorary',
  amountCents: 1900,
  selfService: false,
  sortOrder: 5,
  active: true,
  memberCount: 3,
  changedAt: null,
  changedByEmail: null,
};

const regular: AdminDuesLevel = {
  ...honorary,
  slug: 'regular',
  name: 'Regular',
  amountCents: 5000,
  selfService: true,
};

function Harness({ level }: { level: AdminDuesLevel }) {
  const form = useForm({
    resolver: zodResolver(RetireDuesLevelSchema),
    defaultValues: {
      slug: level.slug,
      memberCount: level.memberCount,
      moveTo: '',
    },
  });

  return <RetireLevelFields form={form} level={level} targets={[regular]} />;
}

describe('RetireLevelFields', () => {
  it('says how many members are on the level and asks where to move them', () => {
    const html = renderToStaticMarkup(<Harness level={honorary} />);

    expect(html).toContain('3 members are on Honorary.');
    expect(html).toContain('data-test="retire-move-to"');
  });

  it('hides the target when nobody is on the level', () => {
    const html = renderToStaticMarkup(
      <Harness level={{ ...honorary, memberCount: 0 }} />,
    );

    expect(html).toContain('No members are on Honorary.');
    expect(html).not.toContain('data-test="retire-move-to"');
  });

  it('says "1 member is", not "1 members are"', () => {
    const html = renderToStaticMarkup(
      <Harness level={{ ...honorary, memberCount: 1 }} />,
    );

    expect(html).toContain('1 member is on Honorary.');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd packages/features/dues && ./node_modules/.bin/vitest run src/components/dues-levels-manager.test.tsx src/components/retire-dues-level-dialog.test.tsx`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 3: Implement the three components**

`packages/features/dues/src/components/dues-level-form-dialog.tsx`:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

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
import { Input } from '@kit/ui/input';

import {
  SaveDuesLevelSchema,
  type SaveDuesLevelValues,
  priceChangeNotice,
} from '../schemas';
import { saveDuesLevelAction } from '../server/dues-level-actions';
import type { AdminDuesLevel } from '../types';

function defaults(level: AdminDuesLevel | null): SaveDuesLevelValues {
  return level
    ? {
        slug: level.slug,
        name: level.name,
        amount: (level.amountCents / 100).toFixed(2),
        selfService: level.selfService,
        sortOrder: String(level.sortOrder),
      }
    : { slug: null, name: '', amount: '', selfService: true, sortOrder: '0' };
}

/** Add (`level` null) or edit one dues level. A changed price applies to
 * payments made from then on; the database keeps earlier payments whole. */
export function DuesLevelFormDialog({
  level,
}: {
  level: AdminDuesLevel | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(SaveDuesLevelSchema),
    defaultValues: defaults(level),
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults(level));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const notice = priceChangeNotice(
    level?.amountCents ?? null,
    form.watch('amount'),
  );

  const onSubmit = (values: SaveDuesLevelValues) => {
    startTransition(async () => {
      const result = await saveDuesLevelAction(values);

      if (result.success) {
        toast.success(level ? 'Dues level saved.' : 'Dues level added.');
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          level ? (
            <Button
              variant="outline"
              size="sm"
              data-test="edit-dues-level"
              aria-label={`Edit ${level.name}`}
            >
              Edit
            </Button>
          ) : (
            <Button data-test="add-dues-level">Add level</Button>
          )
        }
      />

      <DialogContent data-test="dues-level-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {level ? `Edit ${level.name}` : 'Add a dues level'}
          </DialogTitle>
          <DialogDescription>
            Members see the name and amount at checkout.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input data-test="dues-level-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (dollars)</FormLabel>
                  <FormControl>
                    <Input
                      data-test="dues-level-amount"
                      inputMode="decimal"
                      placeholder="58.00"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {notice ? (
                    <p
                      className="text-muted-foreground text-sm"
                      data-test="dues-level-price-notice"
                    >
                      {notice}
                    </p>
                  ) : null}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="selfService"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox
                      data-test="dues-level-self-service"
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                  </FormControl>
                  <FormLabel>
                    Members choose it themselves (otherwise the Financial
                    Secretary assigns it)
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order</FormLabel>
                  <FormControl>
                    <Input
                      data-test="dues-level-order"
                      inputMode="numeric"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="dues-level-save"
                disabled={isPending}
              >
                {level ? 'Save' : 'Add level'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

`packages/features/dues/src/components/retire-dues-level-dialog.tsx`:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { type UseFormReturn, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { formatAmountCents } from '../lib/format-amount';
import { RetireDuesLevelSchema, type RetireDuesLevelValues } from '../schemas';
import { retireDuesLevelAction } from '../server/dues-level-actions';
import type { AdminDuesLevel } from '../types';

function membersSentence(count: number, name: string): string {
  if (count === 0) return `No members are on ${name}.`;
  if (count === 1) return `1 member is on ${name}.`;

  return `${count} members are on ${name}.`;
}

/** The dialog body, exported so it can be rendered in tests without a
 * portal. The target select appears only when there are members to move. */
export function RetireLevelFields({
  form,
  level,
  targets,
}: {
  form: UseFormReturn<RetireDuesLevelValues>;
  level: AdminDuesLevel;
  targets: AdminDuesLevel[];
}) {
  return (
    <div className="flex flex-col gap-y-4">
      <p data-test="retire-member-count">
        {membersSentence(level.memberCount, level.name)}
      </p>

      {level.memberCount > 0 ? (
        <FormField
          control={form.control}
          name="moveTo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Move them to</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-test="retire-move-to" className="w-full">
                    <SelectValue placeholder="Choose a level">
                      {(value: string | null) => {
                        const target = targets.find((t) => t.slug === value);

                        return target
                          ? `${target.name} — ${formatAmountCents(target.amountCents)}`
                          : 'Choose a level';
                      }}
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem key={target.slug} value={target.slug}>
                      {target.name} — {formatAmountCents(target.amountCents)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  );
}

/** Retire a level, moving its members in the same step. Retired levels
 * disappear from checkout and can be restored later. */
export function RetireDuesLevelDialog({
  level,
  levels,
}: {
  level: AdminDuesLevel;
  levels: AdminDuesLevel[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const targets = levels.filter((l) => l.active && l.slug !== level.slug);

  const form = useForm({
    resolver: zodResolver(RetireDuesLevelSchema),
    defaultValues: {
      slug: level.slug,
      memberCount: level.memberCount,
      moveTo: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        slug: level.slug,
        memberCount: level.memberCount,
        moveTo: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = (values: RetireDuesLevelValues) => {
    startTransition(async () => {
      const result = await retireDuesLevelAction(values);

      if (result.success) {
        toast.success(`${level.name} retired.`);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-test="retire-dues-level"
            aria-label={`Retire ${level.name}`}
          >
            Retire
          </Button>
        }
      />

      <DialogContent data-test="retire-dues-level-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retire {level.name}</DialogTitle>
          <DialogDescription>
            It will no longer be offered at checkout. Recorded dues are kept,
            and you can restore it later.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-y-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <RetireLevelFields form={form} level={level} targets={targets} />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-test="retire-submit"
                disabled={isPending}
              >
                {level.memberCount > 0
                  ? `Retire and move ${level.memberCount} ${level.memberCount === 1 ? 'member' : 'members'}`
                  : 'Retire level'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

`packages/features/dues/src/components/dues-levels-manager.tsx`:

```tsx
'use client';

import { useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@kit/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import { formatAmountCents } from '../lib/format-amount';
import { restoreDuesLevelAction } from '../server/dues-level-actions';
import type { AdminDuesLevel } from '../types';
import { DuesLevelFormDialog } from './dues-level-form-dialog';
import { RetireDuesLevelDialog } from './retire-dues-level-dialog';

function lastChanged(level: AdminDuesLevel): string {
  if (!level.changedAt) return '—';

  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(level.changedAt));

  return level.changedByEmail ? `${level.changedByEmail}, ${day}` : day;
}

function RestoreButton({ level }: { level: AdminDuesLevel }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      data-test="restore-dues-level"
      aria-label={`Restore ${level.name}`}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreDuesLevelAction({ slug: level.slug });

          if (result.success) {
            toast.success(`${level.name} restored.`);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      Restore
    </Button>
  );
}

/**
 * Settings → Dues levels: every level, retired ones last and muted. Prices
 * live only here (in `dues_levels`); checkout charges them directly, so
 * there is nothing to change in Stripe or Square.
 */
export function DuesLevelsManager({ levels }: { levels: AdminDuesLevel[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Price changes apply to payments made from then on. Retiring a level
          moves its members to another level and keeps their recorded dues.
        </p>
        <DuesLevelFormDialog level={null} />
      </div>

      <div className="rounded-lg border">
        <Table data-test="dues-levels-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Members choose it</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last changed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {levels.map((level) => (
              <TableRow
                key={level.slug}
                data-test="dues-level-row"
                data-slug={level.slug}
                className={cn(!level.active && 'text-muted-foreground')}
              >
                <TableCell>{level.name}</TableCell>
                <TableCell>{formatAmountCents(level.amountCents)}</TableCell>
                <TableCell>{level.selfService ? 'Yes' : 'No'}</TableCell>
                <TableCell>{level.sortOrder}</TableCell>
                <TableCell>{level.memberCount}</TableCell>
                <TableCell data-test="dues-level-status">
                  {level.active ? 'Active' : 'Retired'}
                </TableCell>
                <TableCell>{lastChanged(level)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <DuesLevelFormDialog level={level} />
                    {level.active ? (
                      <RetireDuesLevelDialog level={level} levels={levels} />
                    ) : (
                      <RestoreButton level={level} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run:
```bash
cd packages/features/dues && ./node_modules/.bin/vitest run && cd ../../..
TSC=$PWD/node_modules/.pnpm/typescript@7.0.2/node_modules/typescript/bin/tsc
(cd packages/features/dues && node $TSC --noEmit)
```
Expected: all dues tests pass and the typecheck is silent. If `@kit/ui/checkbox`'s `onCheckedChange` has a different signature, adapt only the `onCheckedChange` handler: open `packages/ui/src/shadcn/checkbox.tsx` and pass a boolean to `field.onChange`.

- [ ] **Step 5: Commit**

```bash
npx oxfmt packages/features/dues/src/components/dues-levels-manager.tsx packages/features/dues/src/components/dues-levels-manager.test.tsx packages/features/dues/src/components/dues-level-form-dialog.tsx packages/features/dues/src/components/retire-dues-level-dialog.tsx packages/features/dues/src/components/retire-dues-level-dialog.test.tsx
npx oxlint packages/features/dues/src
git add packages/features/dues/src/components/dues-levels-manager.tsx packages/features/dues/src/components/dues-levels-manager.test.tsx packages/features/dues/src/components/dues-level-form-dialog.tsx packages/features/dues/src/components/retire-dues-level-dialog.tsx packages/features/dues/src/components/retire-dues-level-dialog.test.tsx
git commit -m "feat(dues): dues levels manager with add, edit, retire and restore"
```

---

### Task 5: Settings page, navigation and end-to-end

**Files:**
- Modify: `packages/brand/src/config/paths.config.ts`, `packages/brand/i18n/messages/en/common.json`, `apps/portal/config/navigation.config.tsx`
- Create: `apps/portal/app/home/settings/dues-levels/page.tsx`, `apps/e2e/tests/dues/dues-levels.po.ts`, `apps/e2e/tests/dues/dues-levels.spec.ts`

**Interfaces:**
- Consumes: `DuesService.adminLevels()`; `DuesLevelsManager`; the `data-test` hooks from Task 4.
- Produces: the route `/home/settings/dues-levels` (`pathsConfig.app.duesLevels`).

- [ ] **Step 1: Write the failing end-to-end test**

`apps/e2e/tests/dues/dues-levels.po.ts`:

```ts
import { Page, expect } from '@playwright/test';

import { SUPABASE_SERVICE_ROLE_KEY } from './dues.po';

const SUPABASE_URL = 'http://127.0.0.1:54321';

function serviceRoleHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export class DuesLevelsPageObject {
  constructor(private readonly page: Page) {}

  goTo() {
    return this.page.goto('/home/settings/dues-levels');
  }

  row(slug: string) {
    return this.page.locator(`[data-test="dues-level-row"][data-slug="${slug}"]`);
  }

  rowByName(name: string) {
    return this.page
      .locator('[data-test="dues-level-row"]')
      .filter({ hasText: name });
  }

  async slugOf(name: string): Promise<string> {
    const slug = await this.rowByName(name).getAttribute('data-slug');

    if (!slug) {
      throw new Error(`no dues level row named ${name}`);
    }

    return slug;
  }

  async fillLevel(values: {
    name?: string;
    amount?: string;
    selfService?: boolean;
    order?: string;
  }) {
    if (values.name !== undefined) {
      await this.page.fill('[data-test="dues-level-name"]', values.name);
    }
    if (values.amount !== undefined) {
      await this.page.fill('[data-test="dues-level-amount"]', values.amount);
    }
    if (values.selfService !== undefined) {
      const box = this.page.locator('[data-test="dues-level-self-service"]');
      const checked = (await box.getAttribute('aria-checked')) === 'true';

      if (checked !== values.selfService) {
        await box.click();
      }
    }
    if (values.order !== undefined) {
      await this.page.fill('[data-test="dues-level-order"]', values.order);
    }
  }

  async addLevel(values: { name: string; amount: string; order: string }) {
    await this.page.click('[data-test="add-dues-level"]');
    await this.fillLevel({ ...values, selfService: false });
    await this.page.click('[data-test="dues-level-save"]');
    await expect(this.rowByName(values.name)).toBeVisible();
  }

  async retire(slug: string, moveToName: string | null) {
    await this.row(slug).locator('[data-test="retire-dues-level"]').click();

    if (moveToName) {
      await this.page.click('[data-test="retire-move-to"]');
      await this.page
        .getByRole('option', { name: new RegExp(`^${moveToName} — `) })
        .click();
    }

    await this.page.click('[data-test="retire-submit"]');
    await expect(
      this.row(slug).locator('[data-test="dues-level-status"]'),
    ).toHaveText('Retired');
  }

  /** Seeds a roster member on a level, straight through the service role:
   * the roster import is not what this suite tests. */
  async seedMemberOnLevel(slug: string): Promise<string> {
    const number = String(9_960_000 + (Date.now() % 39_000));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
      method: 'POST',
      headers: { ...serviceRoleHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({
        membership_number: number,
        first_name: 'Level',
        last_name: `Tester${number}`,
        primary_email: `level.${number}@example.com`,
        dues_level: slug,
      }),
    });

    if (!res.ok) {
      throw new Error(`seedMemberOnLevel: ${res.status} ${await res.text()}`);
    }

    return ((await res.json()) as { id: string }[])[0]!.id;
  }

  async memberLevel(memberId: string): Promise<string> {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/members?select=dues_level&id=eq.${memberId}`,
      { headers: serviceRoleHeaders() },
    );

    return ((await res.json()) as { dues_level: string }[])[0]!.dues_level;
  }
}
```

`apps/e2e/tests/dues/dues-levels.spec.ts`:

```ts
/**
 * Settings → Dues levels end to end: a finance officer adds a level, changes
 * its price, retires it while moving its one member to Regular, and restores
 * it; a plain member cannot open the page.
 *
 * Run with the stack up (see dues.spec.ts):
 *   pnpm --filter web-e2e exec playwright test tests/dues/dues-levels.spec.ts
 */
import { Page, expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { RbacPageObject } from '../rbac/rbac.po';
import { DuesLevelsPageObject } from './dues-levels.po';

test.describe('Dues levels', () => {
  test.describe.configure({ mode: 'serial' });

  let officerPage: Page;
  let levels: DuesLevelsPageObject;
  const name = `E2E Level ${Date.now() % 100_000}`;
  let slug: string;
  let memberId: string;

  test.beforeAll(async ({ browser }) => {
    officerPage = await browser.newPage();
    const auth = new AuthPageObject(officerPage);
    const rbac = new RbacPageObject(officerPage);
    levels = new DuesLevelsPageObject(officerPage);

    const email = await auth.signUpFlow('/home');
    await rbac.promoteToAdministrator(email);
    await officerPage.reload();
  });

  test.afterAll(async () => {
    await officerPage.close();
  });

  test('1. an officer adds a level', async () => {
    await levels.goTo();
    await levels.addLevel({ name, amount: '12.34', order: '50' });

    slug = await levels.slugOf(name);

    await expect(levels.row(slug)).toContainText('$12.34');
    await expect(levels.row(slug)).toContainText('No');
  });

  test('2. a price change says it applies from now on', async () => {
    await levels.row(slug).locator('[data-test="edit-dues-level"]').click();
    await levels.fillLevel({ amount: '15' });

    await expect(
      officerPage.locator('[data-test="dues-level-price-notice"]'),
    ).toHaveText(
      'Applies to payments made from now on. Recorded dues keep the amount paid.',
    );

    await officerPage.click('[data-test="dues-level-save"]');
    await expect(levels.row(slug)).toContainText('$15.00');
  });

  test('3. retiring moves the level\'s member to the chosen level', async () => {
    memberId = await levels.seedMemberOnLevel(slug);
    await officerPage.reload();
    await expect(levels.row(slug)).toContainText('1');

    await levels.retire(slug, 'Regular');

    expect(await levels.memberLevel(memberId)).toBe('regular');
    await expect(
      levels.row(slug).locator('[data-test="restore-dues-level"]'),
    ).toBeVisible();
  });

  test('4. a retired level can be restored', async () => {
    await levels.row(slug).locator('[data-test="restore-dues-level"]').click();

    await expect(
      levels.row(slug).locator('[data-test="dues-level-status"]'),
    ).toHaveText('Active');
  });

  test('5. a plain member cannot open the page', async ({ browser }) => {
    const memberPage = await browser.newPage();
    await new AuthPageObject(memberPage).signUpFlow('/home');

    await memberPage.goto('/home/settings/dues-levels');

    await expect(memberPage).not.toHaveURL(/\/home\/settings\/dues-levels/);
    await expect(
      memberPage.locator('[data-test="dues-levels-table"]'),
    ).toHaveCount(0);

    await memberPage.close();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run (with `pnpm supabase:web:start` and a fresh `pnpm stack:up`):
`pnpm --filter web-e2e exec playwright test tests/dues/dues-levels.spec.ts`
Expected: test 1 fails, because the page doesn't exist (404).

- [ ] **Step 3: Add the route, the navigation entry and the page**

In `packages/brand/src/config/paths.config.ts`, add `duesLevels: z.string().min(1),` to the `app` object in `PathsSchema`, after `paymentSettings`. Add `duesLevels: '/home/settings/dues-levels',` to the parsed `app` object, after `paymentSettings`.

In `packages/brand/i18n/messages/en/common.json`, add `"duesLevels": "Dues Levels",` to `routes`, after `"paymentSettings"`.

In `apps/portal/config/navigation.config.tsx`, add `BadgeDollarSign` to the `lucide-react` import. In the settings `children`, add this right after the Payment Settings entry:

```tsx
      {
        label: 'common.routes.duesLevels',
        path: pathsConfig.app.duesLevels,
        Icon: <BadgeDollarSign className={iconClasses} />,
        section: 'finance',
        verb: 'manage' as const,
      },
```

Create `apps/portal/app/home/settings/dues-levels/page.tsx`:

```tsx
import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '@kit/brand/skeletons/page-skeletons';
import { DuesLevelsManager } from '@kit/dues/components/dues-levels-manager';
import { DuesService } from '@kit/dues/server/dues.service';
import { requirePermission } from '~/lib/server/require-permission';

/**
 * Per-user by construction: the guard reads the caller's permissions and can
 * redirect, so nothing is worth prerendering. See app/home/layout.tsx.
 */
export const instant = false;

export const metadata = { title: 'Dues Levels' };

function DuesLevelsPage() {
  return (
    <PageBody>
      <div className="flex w-full flex-1 flex-col">
        <Suspense fallback={<DuesLevelsSkeleton />}>
          <DuesLevelsContent />
        </Suspense>
      </div>
    </PageBody>
  );
}

async function DuesLevelsContent() {
  await requirePermission('finance', 'manage');

  // The officer's own session: dues_levels_admin checks finance.manage
  // against the real caller (see DuesService).
  const levels = await new DuesService(getSupabaseServerClient()).adminLevels();

  return <DuesLevelsManager levels={levels} />;
}

function DuesLevelsSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-96 w-full rounded-lg" />
    </Delayed>
  );
}

export default DuesLevelsPage;
```

- [ ] **Step 4: Run everything**

Run:
```bash
TSC=$PWD/node_modules/.pnpm/typescript@7.0.2/node_modules/typescript/bin/tsc
(cd apps/portal && node $TSC --noEmit) && (cd packages/brand && node $TSC --noEmit)
pnpm stack:down; pnpm stack:up
pnpm --filter web-e2e exec playwright test tests/dues/dues-levels.spec.ts tests/dues/dues.spec.ts
```
Expected: the typecheck is silent, and all 5 dues-levels scenarios plus the existing dues spec pass. Also open http://localhost:3000/home/settings/dues-levels as the officer and check that the "Dues Levels" link shows under Settings.

- [ ] **Step 5: Commit**

```bash
npx oxfmt packages/brand/src/config/paths.config.ts apps/portal/config/navigation.config.tsx apps/portal/app/home/settings/dues-levels/page.tsx apps/e2e/tests/dues/dues-levels.po.ts apps/e2e/tests/dues/dues-levels.spec.ts
git add packages/brand/src/config/paths.config.ts packages/brand/i18n/messages/en/common.json apps/portal/config/navigation.config.tsx apps/portal/app/home/settings/dues-levels/page.tsx apps/e2e/tests/dues/dues-levels.po.ts apps/e2e/tests/dues/dues-levels.spec.ts
git commit -m "feat(dues): Settings → Dues levels page"
```
