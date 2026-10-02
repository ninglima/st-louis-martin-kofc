# Dues Levels Admin — Design

**Date:** 2026-10-02
**Status:** Draft for review

## Goal

Let a finance officer add, edit, retire and restore dues levels from inside
the portal. Today the six levels are rows a migration inserted into
`public.dues_levels`. Authenticated users can only read them, so any change
means writing SQL.

There is nothing to sync with Stripe or Square. Neither provider holds
products or prices for dues. Checkout creates a one-off charge for
`dues_levels.amount_cents` (Stripe `paymentIntents.create`, Square
`payments.create`), and the database checks that amount again when the
payment succeeds. Mirroring levels as Stripe Products/Prices or Square
catalog items was considered and rejected. It would mean a second copy of
every price, kept in sync with two external services, that checkout never
reads.

## Decisions

| Decision | Choice |
| --- | --- |
| Access | `finance.manage`, the same permission that records dues payments and sets members' levels. Without it, the page is hidden and the database refuses every write |
| Where | Settings → **Dues levels** (`/home/settings/dues-levels`) |
| Editable | Name, amount, "members choose it" (`self_service`), order (`sort_order`) |
| Identity | A level's `slug` is generated from its name when the level is created and never changes, because `members.dues_level` and `dues_periods.level` reference it |
| Removing | **Retire** (`active = false`), never delete. Retiring requires choosing an active level to move the level's members to. The move and the retirement happen in one transaction |
| Restoring | A retired level can be restored. No members move back |
| Price changes | Apply to payments **created** from then on. Recorded dues periods keep the amount that was paid. A payment created before the change still records its dues period when it succeeds |
| Writes | Security-definer functions that check `finance.manage`, like `dues_writes.sql`. No new table grants |
| Audit | A `dues_level_changes` log: who changed what, when, the before and after values, and which members were moved |

## Database (one migration)

### `public.dues_level_changes`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` identity | primary key |
| `level` | `text` | references `dues_levels(slug)` |
| `action` | `text` | `create`, `update`, `retire` or `restore` |
| `changed_by` | `uuid` | references `auth.users`; `auth.uid()` of the caller |
| `changed_at` | `timestamptz` | default `now()` |
| `before` | `jsonb` | the row before the change (`null` for `create`) |
| `after` | `jsonb` | the row after the change |
| `moved_to` | `text` | `retire` only: the level members were moved to |
| `moved_member_ids` | `uuid[]` | `retire` only: the members moved, default `{}` |

There is an index on `(level, changed_at)`. RLS allows select only, with
`kit.has_permission('finance', 'view')`. Nobody writes to the table
directly; only the functions below do.

### Functions

All are `security definer`, use `set search_path = ''`, raise
`insufficient_privilege` without `kit.has_permission('finance', 'manage')`,
and are granted to `authenticated`.

- **`public.save_dues_level(p_slug text, p_name text, p_amount_cents integer, p_self_service boolean, p_sort_order integer) returns text`**
  - With `p_slug` null, it creates a level and returns its new slug. The slug is the name lowercased, with every run of non-alphanumeric characters turned into `_` and leading or trailing `_` removed. On a clash it appends `_2`, `_3`, and so on.
  - Otherwise it updates the named level and returns `p_slug`. It raises if the level doesn't exist.
  - It validates that the name is trimmed and not empty, unique among all levels ignoring case, and at most 80 characters, and that the amount is between 0 and 100000.
  - It logs a `create` or `update` row. An update that changes nothing logs nothing.
- **`public.retire_dues_level(p_slug text, p_move_to text) returns integer`**, which returns the number of members moved.
  - It raises when:
    - the level is unknown or already retired;
    - `p_move_to` equals `p_slug`, or isn't an active level;
    - retiring would leave no active self-service level.
  - It runs `update members set dues_level = p_move_to where dues_level = p_slug`, then sets `active = false`, then logs `retire` with the moved IDs.
- **`public.restore_dues_level(p_slug text)`**: raises unless the level is retired, then sets `active = true` and logs `restore`.
- **`public.dues_levels_admin()`** returns `table (slug, name, amount_cents, self_service, sort_order, active, member_count, changed_at, changed_by_email)`.
  - It returns every level, including retired ones.
  - `member_count` is the number of members currently on the level.
  - The last-changed columns come from the newest log row, if there is one.
  - It requires `finance.manage`.

### Recording payments made across a change

`kit.record_online_dues_period` currently checks a succeeded payment against
the level as it is **now**: it must be active, it must be available to the
member, and its price must match. Bank payments can stay `processing` for
about four business days. Without the change below, a price edit or
retirement in that window would leave a member's payment with no dues
period recorded.

The function changes to judge the payment against the level **as it was
when the payment was created**:

- **Level state:** the `before` value of the earliest `dues_level_changes`
  row for that level with `changed_at > payments.created_at`. If there is no
  such row, it uses the current row.
- **Active, self-service and price** checks use that state. The dues period
  records that state's `amount_cents`, which is the amount actually charged.
- **Availability:** a member who was moved off the level by a retirement
  after the payment was created still qualifies. Their ID is in that
  retirement row's `moved_member_ids`.

Everything else in the function is unchanged.

## Portal

### Data layer (`@kit/dues`)

- `DuesService`:
  - `adminLevels()` calls `dues_levels_admin`;
  - `saveLevel(input)`, `retireLevel(slug, moveTo)` and `restoreLevel(slug)` call the functions.
- `schemas.ts` gains two zod schemas, `SaveDuesLevelSchema` and `RetireDuesLevelSchema`:
  - the name is trimmed, 1–80 characters;
  - the amount is entered in dollars, converted to whole cents, and must be between 0 and 1000;
  - the order is an integer;
  - `moveTo` is required when retiring.
- `server/dues-level-actions.ts`: server actions built with the existing action
  helper, requiring `finance.manage`. Each one revalidates
  `/home/settings/dues-levels`, `/home/checkout` and `/home`.

### Page

- **Route:** `apps/portal/app/home/settings/dues-levels/page.tsx`, guarded with
  `requirePermission('finance', 'manage')`.
- **Navigation:** the path `paths.config.ts → settings.duesLevels`. A link in the settings
  navigation sits beside Payments and is filtered by the same permission logic as the
  other settings links.
- **`DuesLevelsManager`** (`@kit/dues/components/dues-levels-manager.tsx`) shows a
  table with these columns:
  - name;
  - amount;
  - "Members choose it" (yes/no);
  - order;
  - members;
  - status (Active, or Retired in muted text);
  - last changed ("by fs@… on Oct 2").
- **Add level / Edit:** a dialog with name, amount, "Members choose it" and order.
  - When the amount differs from the saved one, the dialog shows: "Applies to payments made from now on. Recorded dues keep the amount paid."
- **Retire:** a dialog showing "N members are on {name}." with a required
  "Move them to" select listing the active levels other than this one. It
  confirms with "Retire and move N members". With zero members, the select is
  hidden and nobody is moved.
- **Restore:** a button on retired rows.
- **Errors:** database errors come back as the action's error message, shown
  in the dialog. For example: "Another level is already named Regular" or
  "At least one level members can choose must stay active".

### Unchanged

- Checkout, the officers' record-payment form and `availableDuesLevels`
  already read only active levels.
- Dues notices read the amount when they send.
- The finance dashboard reads recorded periods.

## Tests

- **pgTAP** (`apps/portal/supabase/tests/dues_levels_admin.test.sql`):
  - each function refuses a caller without `finance.manage`;
  - creating a level generates its slug, including suffixing a clash;
  - a duplicate name is refused, ignoring case;
  - the amount bounds are enforced;
  - an update never changes the slug;
  - a no-op update logs nothing;
  - retiring moves the members, logs their IDs and returns the count;
  - retiring refuses the last active self-service level, a retired target and the level itself as target;
  - restoring works and logs;
  - **a payment created before a price change succeeds afterwards and records a period at the old amount**;
  - **a payment created before its level was retired, and its member moved, still records a period**;
  - a payment created after a price change at the old amount records nothing, as today.
- **Unit:**
  - the zod schemas, including dollars to cents and the bounds;
  - `DuesLevelsManager`:
    - rows render, including retired ones;
    - the price-change notice appears;
    - the retire dialog requires a target when there are members and hides it when there are none.
- **E2E** (`apps/e2e/tests/dues/dues-levels.spec.ts`): a finance officer
  adds a level, changes its price, assigns a member to it, retires it while
  moving that member, then restores it. A plain member gets a redirect from
  the page.

## Out of scope

- Special assessments (KOVAR, PKD, VKCCI).
- Changing a level's slug.
- Bulk-editing members' levels outside a retirement.
- Stripe or Square catalog sync.
