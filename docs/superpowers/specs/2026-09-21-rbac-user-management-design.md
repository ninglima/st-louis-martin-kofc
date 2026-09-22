# RBAC and User Management — Design

**Date:** 2026-09-21
**Status:** Approved for planning

## Goal

Let admins create users from the UI and assign them roles. Roles are
configurable from the UI, and each role toggles site sections on or off.

This replaces the flat `admin_users` table and `kit.is_admin()` helper built
for the payments feature.

## Prerequisites

A fresh database has zero administrators. The rbac migration's backfill only
promotes rows already present in the now-dropped `admin_users` table (empty
on a fresh database), and self-signup only assigns the role marked
`is_default` (`member`), never `administrator`. With no administrator,
`kit.count_active_user_admins()` returns 0, which makes the
deactivate/ban trigger refuse *any* deactivation with a misleading "no
active administrator" error.

After the first account signs up through the app, promote it manually by
running the commented block in `apps/web/supabase/seed.sql` (edit the email,
then run it against the database -- e.g. via the Supabase SQL editor or
`psql`):

```sql
insert into public.user_roles (user_id, role_id)
select u.id, r.id
from auth.users u
cross join public.roles r
where u.email = '<first-admin@example.org>'
  and r.slug = 'administrator'
on conflict (user_id) do update set role_id = excluded.role_id;
```

This has to run *after* signup, not as part of the seed itself, because it
references an `auth.users` row that does not exist until someone signs up.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Permission granularity | View + Manage per section | Matches the distinction payments already needs: see own history vs. configure providers. |
| Roles per user | Exactly one | Maps cleanly to council jobs; effective permissions are unambiguous. |
| User creation | Invite **and** admin-set password | Some members lack reliable email; admin picks per user. |
| Permission freshness | DB lookup per page, React-cached | Revocation takes effect on next navigation. One indexed query per render is negligible at this traffic. |
| Section catalog | Defined in code | A section only means something if code checks it. DB-defined sections produce orphan rows and false configurability. |
| Deletion | Deactivate, not delete | `payments.user_id` is `ON DELETE CASCADE`; deleting a user destroys dues history. |

Roles and their permissions remain fully UI-configurable. Only the *catalog* of
sections is code, because it must match routes that actually exist.

## Section registry

Source of truth is a `SECTIONS` constant in `@kit/rbac`. Each entry declares
which verbs are meaningful, so the admin UI never renders a nonsense checkbox.

| Section | View | Manage |
| --- | --- | --- |
| `home` | dashboard | — |
| `payments` | own history | all members' payments |
| `checkout` | make a payment | — |
| `payment_settings` | — | provider config and API keys |
| `users` | list users | create, invite, edit, deactivate |
| `roles` | view roles | create, edit, delete roles |

Profile is ungated — everyone manages their own.

`manage` implies `view`. A role with `can_manage` needs no separate
`can_view` grant, and the permission function encodes this so the two can
never disagree.

## Schema

```sql
create table public.roles (
  id          uuid primary key default extensions.uuid_generate_v4(),
  slug        text unique not null,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  is_default  boolean not null default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table public.role_permissions (
  role_id    uuid not null references public.roles on delete cascade,
  section    text not null,
  can_view   boolean not null default false,
  can_manage boolean not null default false,
  primary key (role_id, section)
);

create table public.user_roles (
  user_id     uuid primary key references auth.users on delete cascade,
  role_id     uuid not null references public.roles on delete restrict,
  assigned_at timestamptz default now(),
  assigned_by uuid references auth.users
);
```

Three deliberate choices:

- `user_roles.user_id` is the primary key. One role per user is enforced by the
  schema, not by convention.
- It is a separate table rather than a `role_id` column on `accounts`, to avoid
  touching MakerKit's table and its `protect_account_fields` trigger.
- `role_id` uses `on delete restrict`. Deleting a role that still has users
  fails loudly; admins must reassign first.

Only one role may have `is_default = true`, enforced by a partial unique index.

## Permission function

```sql
create or replace function kit.has_permission(p_section text, p_verb text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = (select auth.uid())
      and rp.section = p_section
      and case p_verb
            when 'manage' then rp.can_manage
            when 'view'   then rp.can_view or rp.can_manage
            else false
          end
  );
$$;
```

`security definer` is required so the function can read `user_roles` and
`role_permissions` without those tables' own RLS policies recursing. This is the
same pattern the existing `kit.is_admin()` uses.

## Correction: the payments policies must change

An earlier sketch proposed keeping `kit.is_admin()` and redefining its body, so
the seven existing payments RLS policies would need no edits. **That is wrong
and is not what we will build.**

`kit.is_admin()` currently gates two unrelated things: the provider secrets in
`payment_config`, and the see-all-members' view of `payments`. Any redefinition
maps it to a single permission. If it became `users.manage`, then a Treasurer
role holding `payment_settings.manage` but not `users.manage` would pass the
application guard, see the payment settings page, and get zero rows back from
the database. The feature would appear broken, and the granularity this project
exists to provide would be defeated.

So the migration rewrites the policies to name the permission they actually
mean:

| Policy | New predicate |
| --- | --- |
| `payment_config_select` / `payment_config_update` | `kit.has_permission('payment_settings', 'manage')` |
| `payments_select_own` | `user_id = auth.uid() or kit.has_permission('payments','manage')` |
| `payment_items_select` | mirrors parent payment visibility |

`kit.is_admin()` is then dropped, so there is exactly one way to ask an
authorization question.

## Migration sequence

Single migration, ordered so no step observes a half-built state:

1. Create `roles`, `role_permissions`, `user_roles` with RLS enabled.
2. Create `kit.has_permission()`.
3. Seed system roles: **Administrator** (all sections, view + manage,
   `is_system`) and **Member** (`home.view`, `checkout.view`, `payments.view`,
   `is_default`).
4. Migrate every existing `admin_users` row into `user_roles` pointing at
   Administrator. This carries over the already-seeded admin.
5. Drop and recreate the payments policies using `kit.has_permission`.
6. Drop `kit.is_admin()` and `admin_users`.
7. Add the lockout triggers below.

Step 4 must run before step 6, or the existing admin loses access.

## Lockout guards

Enforced by database triggers, not only in the UI, because server actions are
reachable by direct POST.

- **Last-admin guard.** Reject any change leaving zero *active* users with
  `users.manage`. Covers: deactivating the user, changing their role,
  un-checking `users.manage` on Administrator, and deleting that role.
- **System roles.** `is_system` roles cannot be deleted or have their slug
  changed. Administrator cannot have `users.manage` revoked.
- **No self-role-change.** Blocked in the server action, with the last-admin
  trigger as backstop.

## Enforcement layers

1. `requirePermission(section, verb)` — server helper wrapping the lookup in
   React `cache()`, mirroring the existing `requireUserInServerComponent`, so
   repeated calls in one render cost one query. Redirects to `/home` on failure.
2. Page and layout guards call it. `/home/settings/users` and
   `/home/settings/roles` guard in `layout.tsx` so children inherit it.
3. Every mutating server action re-checks independently.
4. RLS via `kit.has_permission` as the backstop on data.

Layers 1–2 are user experience. Layers 3–4 are the security boundary. A hidden
button proves nothing.

## Navigation filtering

`NavigationConfigSchema` in `packages/ui/src/makerkit/navigation-config.schema.ts`
is built from plain `z.object()`, which **strips unknown keys** in Zod 4. A
`section` field added to a route entry would be silently dropped by `.parse()`.

That file lives in `src/makerkit/`, which the UI `AGENTS.md` designates as
project-owned (unlike upstream `src/shadcn/`), so extending it is sanctioned.
Add optional `section` and `verb` to `RouteChild` and `RouteSubChild`.

`app/home/layout.tsx` is already a server component. It resolves the permission
set once, filters the config, and passes it down. Consumers change as follows:

| File | Change |
| --- | --- |
| `home-sidebar.tsx` | already takes `config` as a prop — pass filtered |
| `home-mobile-navigation.tsx` | imports the const directly — switch to prop |
| `home-menu-navigation.tsx` | imports the const directly — switch to prop |

Groups left with zero visible children are dropped, so no empty "Settings"
heading appears.

## User management

- **Invite:** `auth.admin.inviteUserByEmail`. Requires SMTP configured in
  Supabase; the built-in sandbox mailer is rate-limited and not viable in
  production. See Prerequisites.
- **Set password:** `auth.admin.createUser({ email_confirm: true })`, plus a
  `must_change_password` flag in user metadata that forces a redirect to
  `/update-password` on next sign-in. Without this, a password the admin knows
  stays valid indefinitely.
- **Deactivate / reactivate:** toggle `ban_duration`, preserving payment history.
- Role assignment happens in the server action *after* the existing
  `on_auth_user_created` trigger has created the `accounts` row.

Users with no role see only their profile. New self-signups receive the role
marked `is_default`; clearing that flag means signups get nothing until an admin
assigns a role.

## Structure

New package `packages/features/rbac/` (`@kit/rbac`), mirroring `@kit/payments`:
`types/`, `schemas/`, `server/`, `components/`, `hooks/`.

Routes: `/home/settings/users` and `/home/settings/roles`.

## Testing

Existing infrastructure: Vitest (`test:unit` in `@kit/ui`, no config file —
defaults) and Playwright in `apps/e2e` with account and auth specs to model on.

- **Vitest** — permission resolution and navigation filtering as pure functions,
  tested independently of the database.
- **Playwright** — create user, assign role, confirm that user sees exactly the
  expected sections; confirm revocation takes effect on next navigation.
- **SQL-level** — the last-admin trigger, exercised by attempting the lockout
  directly against the database. This is the guard most likely to be reached by
  a path the UI never exercises.

## Prerequisites and risks

- **SMTP must be configured in Supabase** before the invite flow is usable in
  production. The password mode works without it.
- The migration rewrites live RLS policies on `payments` and `payment_config`.
  It should be verified against a branch or local database before production.
- Self-signup is currently enabled (`NEXT_PUBLIC_AUTH_PASSWORD=true`). Whether a
  council site should allow it is a product question left open; the
  `is_default` role mechanism supports either answer.

## Out of scope

- Multiple roles per user.
- Per-record permissions (e.g. "edit only payments you created").
- Audit log of permission changes.
- Hard user deletion.
