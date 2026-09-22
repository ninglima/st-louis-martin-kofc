# RBAC and User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins create users and assign roles from the UI, where roles are UI-configurable and toggle each site section on or off.

**Architecture:** A code-defined catalog of sections (`SECTIONS`) is the source of truth for what can be gated; the database stores only role→section grants. Permissions resolve via one React-cached query per page render, enforced in four layers (page guard, server action re-check, RLS, plus cosmetic nav filtering). The existing flat `admin_users` table is migrated into a seeded Administrator role and dropped in a late cutover task, so every intermediate state leaves the tree green.

**Tech Stack:** Next.js 16 (App Router, server components/actions), Supabase (Postgres + RLS + auth admin API), TypeScript, Zod 4, react-hook-form, Base UI via `@kit/ui`, Vitest, Playwright, pnpm workspaces + Turbo.

**Spec:** `docs/superpowers/specs/2026-09-21-rbac-user-management-design.md`

## Global Constraints

- Supabase project is remote: `ktpircfnfdwhpowagppk`. Apply migrations via the Supabase MCP `apply_migration` tool, then **rename the local migration file to match the version Supabase records**, or a later `supabase db push` will re-apply and fail.
- Regenerate types into **both** locations after any migration: `packages/supabase/src/database.types.ts` and `apps/web/lib/database.types.ts`. They must stay byte-identical.
- Zod: always `import * as z from 'zod'`.
- react-hook-form: never pass generics to `useForm`; never call `watch()` — use the `useWatch` hook.
- `@kit/ui` is **Base UI, not Radix**: never use `asChild`; use the `render` prop. Import only as `@kit/ui/<name>`.
- Every form field gets a `FormMessage`. Every interactive element gets a `data-test` attribute.
- Use semantic Tailwind classes (`bg-background`, `text-muted-foreground`) — never hardcoded colors.
- Never edit `packages/ui/src/shadcn/` (upstream-owned). `packages/ui/src/makerkit/` is project-owned and safe to extend.
- `manage` implies `view` everywhere — encode this in one place (`hasPermission`) so the two can never disagree.
- Run `pnpm run typecheck` before every commit; it must report 9+ successful tasks and zero errors.

---

### Task 1: Additive migration — roles schema, permission function, seed, backfill

Purely additive. `admin_users` and `kit.is_admin()` are left intact so the payments feature keeps working; they are removed in Task 10.

**Files:**
- Create: `apps/web/supabase/migrations/<version>_rbac.sql` (version assigned after apply)
- Modify: `packages/supabase/src/database.types.ts`, `apps/web/lib/database.types.ts`

**Interfaces:**
- Consumes: existing `kit` schema, `extensions.uuid_generate_v4()`, `public.admin_users`.
- Produces: tables `roles`, `role_permissions`, `user_roles`; function `kit.has_permission(p_section text, p_verb text) returns boolean`.

- [ ] **Step 1: Write the migration SQL**

Create `apps/web/supabase/migrations/20260921000002_rbac.sql`:

```sql
-- Roles
create table if not exists public.roles (
    id          uuid primary key default extensions.uuid_generate_v4(),
    slug        text unique not null,
    name        text not null,
    description text,
    is_system   boolean not null default false,
    is_default  boolean not null default false,
    created_at  timestamp with time zone default now(),
    updated_at  timestamp with time zone default now()
);

comment on table public.roles is 'Assignable roles; is_system roles are protected from deletion';

-- At most one default role
create unique index roles_single_default_idx
    on public.roles (is_default) where is_default;

create table if not exists public.role_permissions (
    role_id    uuid not null references public.roles on delete cascade,
    section    text not null,
    can_view   boolean not null default false,
    can_manage boolean not null default false,
    primary key (role_id, section)
);

create table if not exists public.user_roles (
    user_id     uuid primary key references auth.users on delete cascade,
    role_id     uuid not null references public.roles on delete restrict,
    assigned_at timestamp with time zone default now(),
    assigned_by uuid references auth.users
);

alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;

-- Permission oracle. security definer so it can read the tables above
-- without their own RLS policies recursing.
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

grant execute on function kit.has_permission(text, text) to authenticated, service_role;

-- RLS: anyone signed in may read roles (needed to render their own nav);
-- only users.manage may write.
create policy roles_select on public.roles
    for select to authenticated using (true);

create policy roles_write on public.roles
    for all to authenticated
    using (kit.has_permission('roles', 'manage'))
    with check (kit.has_permission('roles', 'manage'));

create policy role_permissions_select on public.role_permissions
    for select to authenticated using (true);

create policy role_permissions_write on public.role_permissions
    for all to authenticated
    using (kit.has_permission('roles', 'manage'))
    with check (kit.has_permission('roles', 'manage'));

-- Users see their own assignment; users.view sees all.
create policy user_roles_select on public.user_roles
    for select to authenticated
    using (user_id = (select auth.uid()) or kit.has_permission('users', 'view'));

create policy user_roles_write on public.user_roles
    for all to authenticated
    using (kit.has_permission('users', 'manage'))
    with check (kit.has_permission('users', 'manage'));

revoke all on public.roles, public.role_permissions, public.user_roles
    from authenticated, service_role;
grant select on public.roles, public.role_permissions, public.user_roles to authenticated;
grant insert, update, delete on public.roles, public.role_permissions, public.user_roles to authenticated;
grant all on public.roles, public.role_permissions, public.user_roles to service_role;

create index user_roles_role_id_idx        on public.user_roles (role_id);
create index role_permissions_role_id_idx  on public.role_permissions (role_id);

-- Seed system roles
insert into public.roles (slug, name, description, is_system, is_default)
values
    ('administrator', 'Administrator', 'Full access to every section', true, false),
    ('member',        'Member',        'Standard council member',      true, true)
on conflict (slug) do nothing;

-- Administrator: view + manage on everything
insert into public.role_permissions (role_id, section, can_view, can_manage)
select r.id, s.section, true, true
from public.roles r
cross join (values ('home'), ('payments'), ('checkout'),
                   ('payment_settings'), ('users'), ('roles')) as s(section)
where r.slug = 'administrator'
on conflict (role_id, section) do nothing;

-- Member: view-only on the member-facing sections
insert into public.role_permissions (role_id, section, can_view, can_manage)
select r.id, s.section, true, false
from public.roles r
cross join (values ('home'), ('payments'), ('checkout')) as s(section)
where r.slug = 'member'
on conflict (role_id, section) do nothing;

-- Backfill: every existing admin becomes an Administrator
insert into public.user_roles (user_id, role_id)
select au.user_id, r.id
from public.admin_users au
cross join public.roles r
where r.slug = 'administrator'
on conflict (user_id) do nothing;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP tool `apply_migration` with name `rbac` and the SQL above as `query`.

- [ ] **Step 3: Reconcile the local filename with the recorded version**

Call MCP `list_migrations`. Note the new version string (e.g. `20260922041500`). Then:

```bash
cd apps/web/supabase/migrations
mv 20260921000002_rbac.sql <recorded_version>_rbac.sql
```

Expected: the local filename exactly matches the version Supabase recorded. Skipping this makes a future `supabase db push` re-run the migration and fail on the duplicate unique index.

- [ ] **Step 4: Verify the backfill and the permission function**

Run via MCP `execute_sql`:

```sql
select
  (select count(*) from public.roles)            as roles,
  (select count(*) from public.role_permissions) as grants,
  (select count(*) from public.user_roles)       as assignments,
  (select count(*) from public.admin_users)      as legacy_admins;
```

Expected: `roles = 2`, `grants = 9` (6 administrator + 3 member), `assignments = legacy_admins` (1).

Then confirm the oracle works under a real JWT:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f530046b-751e-41a8-98b1-709d53c5b258","role":"authenticated"}';
select kit.has_permission('payment_settings','manage') as should_be_true,
       kit.has_permission('nonexistent','manage')      as should_be_false;
rollback;
```

Expected: `true`, `false`.

- [ ] **Step 5: Regenerate types into both locations**

Call MCP `generate_typescript_types`, write the result to `packages/supabase/src/database.types.ts`, then:

```bash
cp packages/supabase/src/database.types.ts apps/web/lib/database.types.ts
diff -q packages/supabase/src/database.types.ts apps/web/lib/database.types.ts
```

Expected: no diff output. The files must contain `roles`, `role_permissions`, and `user_roles`.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm run typecheck
git add apps/web/supabase/migrations packages/supabase/src/database.types.ts apps/web/lib/database.types.ts
git commit -m "feat(rbac): add roles schema, permission function, and seed roles"
```

---

### Task 2: Lockout-prevention triggers

Database-level, because server actions are reachable by direct POST and must not be the only guard.

**Files:**
- Create: `apps/web/supabase/migrations/<version>_rbac_guards.sql`

**Interfaces:**
- Consumes: `roles`, `role_permissions`, `user_roles` from Task 1.
- Produces: triggers `protect_system_roles`, `prevent_admin_lockout`.

- [ ] **Step 1: Write the guard migration**

Create `apps/web/supabase/migrations/20260921000003_rbac_guards.sql`:

```sql
-- Count users who can still manage users, excluding banned accounts.
create or replace function kit.count_active_user_admins()
returns integer
language sql
security definer
set search_path = ''
stable
as $$
    select count(*)::integer
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join auth.users u on u.id = ur.user_id
    where rp.section = 'users'
      and rp.can_manage
      and (u.banned_until is null or u.banned_until < now());
$$;

-- System roles cannot be deleted or re-slugged.
create or replace function kit.protect_system_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        if old.is_system then
            raise exception 'System roles cannot be deleted';
        end if;
        return old;
    end if;

    if old.is_system and new.slug <> old.slug then
        raise exception 'System role slug cannot be changed';
    end if;

    return new;
end;
$$;

create trigger protect_system_roles
    before update or delete on public.roles
    for each row execute function kit.protect_system_roles();

-- Any change that would leave zero active users.manage holders is rejected.
create or replace function kit.prevent_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if kit.count_active_user_admins() = 0 then
        raise exception 'This change would leave no active administrator';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

-- AFTER triggers: the count must be evaluated post-change.
create constraint trigger prevent_admin_lockout_user_roles
    after update or delete on public.user_roles
    deferrable initially immediate
    for each row execute function kit.prevent_admin_lockout();

create constraint trigger prevent_admin_lockout_permissions
    after update or delete on public.role_permissions
    deferrable initially immediate
    for each row execute function kit.prevent_admin_lockout();
```

- [ ] **Step 2: Apply and reconcile the filename**

Apply via MCP `apply_migration` with name `rbac_guards`. Then `list_migrations` and rename the local file to the recorded version, exactly as in Task 1 Step 3.

- [ ] **Step 3: Verify the guards actually fire**

This is the highest-value verification in the plan — it is the guard most likely to be reached by a path the UI never exercises. Run each via MCP `execute_sql` and confirm each **raises an exception**:

```sql
-- must fail: deleting a system role
begin;
delete from public.roles where slug = 'administrator';
rollback;
```
Expected: `ERROR: System roles cannot be deleted`

```sql
-- must fail: revoking users.manage from the only admin role
begin;
update public.role_permissions rp
set can_manage = false
from public.roles r
where r.id = rp.role_id and r.slug = 'administrator' and rp.section = 'users';
rollback;
```
Expected: `ERROR: This change would leave no active administrator`

```sql
-- must fail: removing the last admin's assignment
begin;
delete from public.user_roles
where user_id = 'f530046b-751e-41a8-98b1-709d53c5b258';
rollback;
```
Expected: `ERROR: This change would leave no active administrator`

If any of these **succeeds**, the trigger is wrong — stop and fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/supabase/migrations
git commit -m "feat(rbac): add system-role and admin-lockout guards"
```

---

### Task 3: `@kit/rbac` package with section registry and permission logic

Pure, dependency-free logic — the part worth unit testing in isolation.

**Files:**
- Create: `packages/features/rbac/package.json`, `packages/features/rbac/tsconfig.json`
- Create: `packages/features/rbac/src/types/sections.ts`
- Create: `packages/features/rbac/src/types/permissions.ts`
- Test: `packages/features/rbac/src/types/permissions.test.ts`

**Interfaces:**
- Produces:
  - `SECTIONS: readonly SectionDef[]`, `SectionKey`, `Verb = 'view' | 'manage'`
  - `PermissionMap = Record<string, { canView: boolean; canManage: boolean }>`
  - `hasPermission(perms: PermissionMap, section: SectionKey, verb: Verb): boolean`
  - `emptyPermissions(): PermissionMap`

- [ ] **Step 1: Create the package manifest**

`packages/features/rbac/package.json`:

```json
{
  "name": "@kit/rbac",
  "version": "0.1.0",
  "private": true,
  "typesVersions": { "*": { "*": ["src/*"] } },
  "exports": {
    "./types": "./src/types/permissions.ts",
    "./sections": "./src/types/sections.ts",
    "./schemas/*": "./src/schemas/*.ts",
    "./server/*": "./src/server/*.ts",
    "./components/*": "./src/components/*.tsx",
    "./hooks/*": "./src/hooks/*.ts"
  },
  "scripts": {
    "clean": "git clean -xdf .turbo node_modules",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@kit/i18n": "workspace:*",
    "next-intl": "catalog:"
  },
  "devDependencies": {
    "@hookform/resolvers": "catalog:",
    "@kit/next": "workspace:*",
    "@kit/shared": "workspace:*",
    "@kit/supabase": "workspace:*",
    "@kit/tsconfig": "workspace:*",
    "@kit/ui": "workspace:*",
    "@supabase/supabase-js": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "lucide-react": "catalog:",
    "next": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-hook-form": "catalog:",
    "sonner": "catalog:",
    "vitest": "catalog:",
    "zod": "catalog:"
  }
}
```

`packages/features/rbac/tsconfig.json`:

```json
{
  "extends": "@kit/tsconfig/base.json",
  "compilerOptions": { "tsBuildInfoFile": "node_modules/.cache/tsbuildinfo.json" },
  "include": ["*.ts", "*.tsx", "src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Write the section registry**

`packages/features/rbac/src/types/sections.ts`:

```ts
export type Verb = 'view' | 'manage';

export interface SectionDef {
  key: string;
  label: string;
  description: string;
  verbs: readonly Verb[];
}

export const SECTIONS = [
  {
    key: 'home',
    label: 'Home',
    description: 'The main dashboard',
    verbs: ['view'],
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'View: own payment history. Manage: all members’ payments',
    verbs: ['view', 'manage'],
  },
  {
    key: 'checkout',
    label: 'Checkout',
    description: 'Make a payment',
    verbs: ['view'],
  },
  {
    key: 'payment_settings',
    label: 'Payment Settings',
    description: 'Configure the payment provider and API keys',
    verbs: ['manage'],
  },
  {
    key: 'users',
    label: 'User Management',
    description: 'View: list users. Manage: create, invite, edit, deactivate',
    verbs: ['view', 'manage'],
  },
  {
    key: 'roles',
    label: 'Roles',
    description: 'View: see roles. Manage: create, edit, delete roles',
    verbs: ['view', 'manage'],
  },
] as const satisfies readonly SectionDef[];

export type SectionKey = (typeof SECTIONS)[number]['key'];

export function getSection(key: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.key === key);
}

export function sectionSupportsVerb(key: string, verb: Verb): boolean {
  return getSection(key)?.verbs.includes(verb) ?? false;
}
```

- [ ] **Step 3: Write the failing test**

`packages/features/rbac/src/types/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { emptyPermissions, hasPermission } from './permissions';

describe('hasPermission', () => {
  it('grants view when can_view is set', () => {
    const perms = { payments: { canView: true, canManage: false } };
    expect(hasPermission(perms, 'payments', 'view')).toBe(true);
  });

  it('denies manage when only can_view is set', () => {
    const perms = { payments: { canView: true, canManage: false } };
    expect(hasPermission(perms, 'payments', 'manage')).toBe(false);
  });

  it('treats manage as implying view', () => {
    const perms = { payments: { canView: false, canManage: true } };
    expect(hasPermission(perms, 'payments', 'view')).toBe(true);
  });

  it('denies everything for an unknown section', () => {
    const perms = { payments: { canView: true, canManage: true } };
    expect(hasPermission(perms, 'roles', 'view')).toBe(false);
  });

  it('denies everything for an empty permission map', () => {
    expect(hasPermission(emptyPermissions(), 'home', 'view')).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

```bash
pnpm install
pnpm --filter @kit/rbac test:unit
```
Expected: FAIL — `Failed to resolve import "./permissions"`.

- [ ] **Step 5: Implement the permission logic**

`packages/features/rbac/src/types/permissions.ts`:

```ts
import type { SectionKey, Verb } from './sections';

export interface SectionGrant {
  canView: boolean;
  canManage: boolean;
}

export type PermissionMap = Record<string, SectionGrant>;

export function emptyPermissions(): PermissionMap {
  return {};
}

/**
 * `manage` implies `view`. Encoded here only, so the two can never disagree.
 * Mirrors the CASE expression in kit.has_permission().
 */
export function hasPermission(
  perms: PermissionMap,
  section: SectionKey | string,
  verb: Verb,
): boolean {
  const grant = perms[section];

  if (!grant) {
    return false;
  }

  return verb === 'manage' ? grant.canManage : grant.canView || grant.canManage;
}
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
pnpm --filter @kit/rbac test:unit
```
Expected: PASS, 5 tests.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm run typecheck
git add packages/features/rbac pnpm-lock.yaml
git commit -m "feat(rbac): add section registry and permission resolution"
```

---

### Task 4: Server-side permission resolution

**Files:**
- Create: `packages/features/rbac/src/server/permissions.service.ts`
- Create: `apps/web/lib/server/require-permission.ts`
- Modify: `apps/web/package.json` (add `@kit/rbac` dependency)

**Interfaces:**
- Consumes: `PermissionMap`, `hasPermission`, `SectionKey`, `Verb` (Task 3); `requireUserInServerComponent` from `~/lib/server/require-user-in-server-component`.
- Produces:
  - `loadPermissionsForUser(client, userId): Promise<PermissionMap>`
  - `getCurrentPermissions(): Promise<PermissionMap>` — React-cached
  - `requirePermission(section, verb): Promise<void>` — redirects to `/home` on failure

- [ ] **Step 1: Add `@kit/rbac` to the web app**

In `apps/web/package.json`, add to `dependencies`, keeping alphabetical order:

```json
"@kit/rbac": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 2: Write the permission loader**

`packages/features/rbac/src/server/permissions.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { PermissionMap } from '../types/permissions';

type RbacClient = SupabaseClient<Database>;

/**
 * Resolves one user's effective permissions. A user with no role row gets an
 * empty map, which denies everything except their own profile.
 */
export async function loadPermissionsForUser(
  client: RbacClient,
  userId: string,
): Promise<PermissionMap> {
  const { data, error } = await client
    .from('user_roles')
    .select('role_id, role_permissions:roles(role_permissions(section, can_view, can_manage))')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return {};
  }

  const nested = data as unknown as {
    role_permissions: {
      role_permissions: Array<{
        section: string;
        can_view: boolean;
        can_manage: boolean;
      }>;
    } | null;
  };

  const grants = nested.role_permissions?.role_permissions ?? [];

  return Object.fromEntries(
    grants.map((g) => [g.section, { canView: g.can_view, canManage: g.can_manage }]),
  );
}
```

- [ ] **Step 3: Write the cached request-scoped guard**

`apps/web/lib/server/require-permission.ts`:

```ts
import 'server-only';

import { cache } from 'react';

import { redirect } from 'next/navigation';

import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import type { PermissionMap } from '@kit/rbac/types';
import { hasPermission } from '@kit/rbac/types';
import type { SectionKey, Verb } from '@kit/rbac/sections';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { requireUserInServerComponent } from './require-user-in-server-component';

/**
 * Cached per request, so a page that guards in its layout and again in the
 * page body still costs a single query.
 */
export const getCurrentPermissions = cache(async (): Promise<PermissionMap> => {
  const user = await requireUserInServerComponent();

  return loadPermissionsForUser(getSupabaseServerAdminClient(), user.id);
});

export async function requirePermission(
  section: SectionKey,
  verb: Verb,
): Promise<void> {
  const perms = await getCurrentPermissions();

  if (!hasPermission(perms, section, verb)) {
    redirect('/home');
  }
}
```

- [ ] **Step 4: Verify the nested select returns the expected shape**

The embedded-resource syntax above is the one detail most likely to be wrong. Verify against the live database before building UI on it, via MCP `execute_sql`:

```sql
select ur.user_id, rp.section, rp.can_view, rp.can_manage
from public.user_roles ur
join public.role_permissions rp on rp.role_id = ur.role_id
where ur.user_id = 'f530046b-751e-41a8-98b1-709d53c5b258';
```

Expected: 6 rows, all `can_view = true` and `can_manage = true`.

If the PostgREST embedded form in Step 2 does not produce that shape, replace it with the explicit two-table join:

```ts
const { data } = await client
  .from('user_roles')
  .select('role_id')
  .eq('user_id', userId)
  .maybeSingle();

if (!data) return {};

const { data: grants } = await client
  .from('role_permissions')
  .select('section, can_view, can_manage')
  .eq('role_id', data.role_id);

return Object.fromEntries(
  (grants ?? []).map((g) => [g.section, { canView: g.can_view, canManage: g.can_manage }]),
);
```

Prefer whichever form the verification shows to be correct. Two indexed queries is an acceptable cost given the result is request-cached.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add apps/web/package.json apps/web/lib/server/require-permission.ts packages/features/rbac pnpm-lock.yaml
git commit -m "feat(rbac): add request-cached permission resolution and page guard"
```

---

### Task 5: Permission-aware navigation

**Files:**
- Modify: `packages/ui/src/makerkit/navigation-config.schema.ts`
- Create: `packages/features/rbac/src/server/filter-navigation.ts`
- Test: `packages/features/rbac/src/server/filter-navigation.test.ts`
- Modify: `apps/web/config/navigation.config.tsx`
- Modify: `apps/web/app/home/layout.tsx`
- Modify: `apps/web/app/home/_components/home-mobile-navigation.tsx`
- Modify: `apps/web/app/home/_components/home-menu-navigation.tsx`

**Interfaces:**
- Consumes: `PermissionMap`, `hasPermission` (Task 3); `getCurrentPermissions` (Task 4).
- Produces: `filterRoutesByPermission(routes, perms)` returning the same shape with disallowed entries and now-empty groups removed.

- [ ] **Step 1: Extend the navigation schema**

`packages/ui/src/makerkit/navigation-config.schema.ts` uses plain `z.object()`, which **strips unknown keys** in Zod 4 — a `section` field added to a route would be silently dropped by `.parse()`. Add it to the schema so it survives. This file is in `src/makerkit/` (project-owned), so editing it is sanctioned.

Add to **both** `RouteSubChild` and `RouteChild`:

```ts
  section: z.string().optional(),
  verb: z.enum(['view', 'manage']).optional(),
```

- [ ] **Step 2: Write the failing test**

`packages/features/rbac/src/server/filter-navigation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { filterRoutesByPermission } from './filter-navigation';

const routes = [
  {
    label: 'Application',
    children: [
      { label: 'Home', path: '/home', section: 'home', verb: 'view' as const },
      { label: 'Payments', path: '/home/payments', section: 'payments', verb: 'view' as const },
    ],
  },
  {
    label: 'Settings',
    children: [
      { label: 'Profile', path: '/home/settings' },
      {
        label: 'Payment Settings',
        path: '/home/settings/payments',
        section: 'payment_settings',
        verb: 'manage' as const,
      },
    ],
  },
];

describe('filterRoutesByPermission', () => {
  it('keeps entries the user is allowed to see', () => {
    const perms = { home: { canView: true, canManage: false } };
    const result = filterRoutesByPermission(routes, perms);

    expect(result[0]?.children.map((c) => c.label)).toEqual(['Home']);
  });

  it('keeps ungated entries regardless of permissions', () => {
    const result = filterRoutesByPermission(routes, {});
    const settings = result.find((g) => g.label === 'Settings');

    expect(settings?.children.map((c) => c.label)).toEqual(['Profile']);
  });

  it('drops groups whose children are all filtered out', () => {
    const routesAllGated = [
      {
        label: 'Admin',
        children: [
          { label: 'Roles', path: '/home/settings/roles', section: 'roles', verb: 'manage' as const },
        ],
      },
    ];

    expect(filterRoutesByPermission(routesAllGated, {})).toEqual([]);
  });

  it('preserves dividers', () => {
    const withDivider = [{ divider: true as const }, ...routes];
    const result = filterRoutesByPermission(withDivider, {});

    expect(result[0]).toEqual({ divider: true });
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
pnpm --filter @kit/rbac test:unit
```
Expected: FAIL — cannot resolve `./filter-navigation`.

- [ ] **Step 4: Implement the filter**

`packages/features/rbac/src/server/filter-navigation.ts`:

```ts
import { hasPermission, type PermissionMap } from '../types/permissions';
import type { Verb } from '../types/sections';

interface GatedEntry {
  section?: string;
  verb?: Verb;
}

interface RouteGroupLike {
  label: string;
  children: Array<GatedEntry & Record<string, unknown>>;
}

type RouteEntry = RouteGroupLike | { divider: true };

function isDivider(entry: RouteEntry): entry is { divider: true } {
  return 'divider' in entry;
}

/** An entry with no `section` is ungated and always visible. */
function isVisible(entry: GatedEntry, perms: PermissionMap): boolean {
  if (!entry.section) {
    return true;
  }

  return hasPermission(perms, entry.section, entry.verb ?? 'view');
}

export function filterRoutesByPermission<T extends RouteEntry>(
  routes: readonly T[],
  perms: PermissionMap,
): T[] {
  const result: T[] = [];

  for (const entry of routes) {
    if (isDivider(entry)) {
      result.push(entry);
      continue;
    }

    const children = entry.children.filter((child) => isVisible(child, perms));

    if (children.length > 0) {
      result.push({ ...entry, children } as T);
    }
  }

  return result;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
pnpm --filter @kit/rbac test:unit
```
Expected: PASS, 9 tests total (5 from Task 3 + 4 here).

- [ ] **Step 6: Tag the existing routes with sections**

In `apps/web/config/navigation.config.tsx`, add `section`/`verb` to each entry. Leave Profile ungated:

```tsx
const routes = [
  {
    label: 'common.routes.application',
    children: [
      {
        label: 'common.routes.home',
        path: pathsConfig.app.home,
        Icon: <Home className={iconClasses} />,
        highlightMatch: `^${pathsConfig.app.home}$`,
        section: 'home',
        verb: 'view' as const,
      },
      {
        label: 'common.routes.payments',
        path: pathsConfig.app.payments,
        Icon: <CreditCard className={iconClasses} />,
        section: 'payments',
        verb: 'view' as const,
      },
    ],
  },
  {
    label: 'common.routes.settings',
    children: [
      {
        label: 'common.routes.profile',
        path: pathsConfig.app.profileSettings,
        Icon: <User className={iconClasses} />,
      },
      {
        label: 'common.routes.paymentSettings',
        path: pathsConfig.app.paymentSettings,
        Icon: <Settings className={iconClasses} />,
        section: 'payment_settings',
        verb: 'manage' as const,
      },
      {
        label: 'common.routes.users',
        path: pathsConfig.app.users,
        Icon: <Users className={iconClasses} />,
        section: 'users',
        verb: 'view' as const,
      },
      {
        label: 'common.routes.roles',
        path: pathsConfig.app.roles,
        Icon: <Shield className={iconClasses} />,
        section: 'roles',
        verb: 'view' as const,
      },
    ],
  },
] satisfies z.infer<typeof NavigationConfigSchema>['routes'];
```

Update the lucide import to `import { CreditCard, Home, Settings, Shield, User, Users } from 'lucide-react';`.

`pathsConfig.app.users` and `.roles` are added in Task 9; if that task has not run yet, add them now to `apps/web/config/paths.config.ts` (`users: '/home/settings/users'`, `roles: '/home/settings/roles'`) plus the matching `z.string().min(1)` entries in `PathsSchema`.

- [ ] **Step 7: Filter in the layout and pass down**

In `apps/web/app/home/layout.tsx`, compute the filtered config once and pass it to the nav components:

```tsx
const permissions = await getCurrentPermissions();

const filteredConfig = {
  ...navigationConfig,
  routes: filterRoutesByPermission(navigationConfig.routes, permissions),
};
```

Pass `filteredConfig` as a `config` prop. Then change `home-mobile-navigation.tsx` and `home-menu-navigation.tsx` to accept `config` as a prop instead of importing `navigationConfig` directly — replace each `navigationConfig.routes` reference with `props.config.routes`. `home-sidebar.tsx` already takes `config` as a prop; pass the filtered value through.

- [ ] **Step 8: Verify in the browser**

```bash
pnpm --filter web dev
```

Sign in as the seeded administrator. Expected: all sections visible. This confirms the filter does not over-filter; under-filtering is covered by the e2e test in Task 11.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm run typecheck
git add packages/ui/src/makerkit/navigation-config.schema.ts packages/features/rbac apps/web/config apps/web/app/home
git commit -m "feat(rbac): filter navigation by permissions"
```

---

### Task 6: Role management — schemas, service, and server actions

**Files:**
- Create: `packages/features/rbac/src/schemas/role.schema.ts`
- Create: `packages/features/rbac/src/server/roles.service.ts`
- Create: `packages/features/rbac/src/server/role-actions.ts`

**Interfaces:**
- Consumes: `SECTIONS`, `sectionSupportsVerb` (Task 3); `getCurrentPermissions` (Task 4).
- Produces:
  - `RoleSchema`, `RoleFormValues`
  - `RolesService` with `listRoles()`, `createRole(values, userId)`, `updateRole(id, values)`, `deleteRole(id)`
  - Actions `saveRoleAction`, `deleteRoleAction`

- [ ] **Step 1: Write the schema**

`packages/features/rbac/src/schemas/role.schema.ts`:

```ts
import * as z from 'zod';

export const RolePermissionSchema = z.object({
  section: z.string().min(1),
  can_view: z.boolean(),
  can_manage: z.boolean(),
});

export const RoleSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
  name: z.string().min(2).max(100),
  description: z.string().max(500),
  is_default: z.boolean(),
  permissions: z.array(RolePermissionSchema),
});

export type RoleFormValues = z.infer<typeof RoleSchema>;
```

- [ ] **Step 2: Write the service**

`packages/features/rbac/src/server/roles.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { RoleFormValues } from '../schemas/role.schema';
import { sectionSupportsVerb } from '../types/sections';

type RbacClient = SupabaseClient<Database>;

export interface RoleWithPermissions {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_default: boolean;
  permissions: Array<{ section: string; can_view: boolean; can_manage: boolean }>;
  user_count: number;
}

export class RolesService {
  constructor(private client: RbacClient) {}

  async listRoles(): Promise<RoleWithPermissions[]> {
    const { data: roles, error } = await this.client
      .from('roles')
      .select('id, slug, name, description, is_system, is_default')
      .order('name');

    if (error) {
      throw new Error(`Failed to load roles: ${error.message}`);
    }

    const { data: grants } = await this.client
      .from('role_permissions')
      .select('role_id, section, can_view, can_manage');

    const { data: assignments } = await this.client
      .from('user_roles')
      .select('role_id');

    return (roles ?? []).map((role) => ({
      ...role,
      permissions: (grants ?? [])
        .filter((g) => g.role_id === role.id)
        .map(({ section, can_view, can_manage }) => ({ section, can_view, can_manage })),
      user_count: (assignments ?? []).filter((a) => a.role_id === role.id).length,
    }));
  }

  /**
   * Drops grants for verbs the section does not define, so a malformed payload
   * cannot store a permission the UI would never show.
   */
  private sanitize(permissions: RoleFormValues['permissions']) {
    return permissions
      .filter((p) => sectionSupportsVerb(p.section, 'view') || sectionSupportsVerb(p.section, 'manage'))
      .map((p) => ({
        section: p.section,
        can_view: sectionSupportsVerb(p.section, 'view') ? p.can_view : false,
        can_manage: sectionSupportsVerb(p.section, 'manage') ? p.can_manage : false,
      }));
  }

  async createRole(values: RoleFormValues): Promise<string> {
    if (values.is_default) {
      await this.client.from('roles').update({ is_default: false }).eq('is_default', true);
    }

    const { data, error } = await this.client
      .from('roles')
      .insert({
        slug: values.slug,
        name: values.name,
        description: values.description || null,
        is_default: values.is_default,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create role: ${error?.message}`);
    }

    await this.replacePermissions(data.id, values);

    return data.id;
  }

  async updateRole(id: string, values: RoleFormValues): Promise<void> {
    if (values.is_default) {
      await this.client.from('roles').update({ is_default: false }).eq('is_default', true);
    }

    const { error } = await this.client
      .from('roles')
      .update({
        name: values.name,
        description: values.description || null,
        is_default: values.is_default,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update role: ${error.message}`);
    }

    await this.replacePermissions(id, values);
  }

  private async replacePermissions(roleId: string, values: RoleFormValues) {
    await this.client.from('role_permissions').delete().eq('role_id', roleId);

    const rows = this.sanitize(values.permissions)
      .filter((p) => p.can_view || p.can_manage)
      .map((p) => ({ role_id: roleId, ...p }));

    if (rows.length > 0) {
      const { error } = await this.client.from('role_permissions').insert(rows);

      if (error) {
        throw new Error(`Failed to save permissions: ${error.message}`);
      }
    }
  }

  async deleteRole(id: string): Promise<void> {
    const { error } = await this.client.from('roles').delete().eq('id', id);

    if (error) {
      // Surfaces the trigger's message and the on-delete-restrict violation
      // in a form a human can act on.
      throw new Error(
        error.message.includes('violates foreign key')
          ? 'This role still has users assigned. Reassign them first.'
          : error.message,
      );
    }
  }
}
```

- [ ] **Step 3: Write the server actions**

`packages/features/rbac/src/server/role-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { RoleSchema } from '../schemas/role.schema';
import { loadPermissionsForUser } from './permissions.service';
import { RolesService } from './roles.service';
import { hasPermission } from '../types/permissions';

async function assertCanManageRoles(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'roles', 'manage')) {
    throw new Error('Unauthorized: roles.manage required');
  }

  return client;
}

export const saveRoleAction = enhanceAction(
  async (data: unknown, user) => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI.
    const client = await assertCanManageRoles(user.id);
    const parsed = RoleSchema.parse(data);
    const service = new RolesService(client);

    if (parsed.id) {
      await service.updateRole(parsed.id, parsed);
    } else {
      await service.createRole(parsed);
    }

    revalidatePath('/home/settings/roles');
    revalidatePath('/home', 'layout');

    return { success: true };
  },
  {},
);

export const deleteRoleAction = enhanceAction(
  async (data: { id: string }, user) => {
    const client = await assertCanManageRoles(user.id);

    await new RolesService(client).deleteRole(data.id);

    revalidatePath('/home/settings/roles');

    return { success: true };
  },
  {},
);
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm run typecheck
git add packages/features/rbac
git commit -m "feat(rbac): add role service and server actions"
```

---

### Task 7: Role management UI

**Files:**
- Create: `packages/features/rbac/src/components/roles-manager.tsx`
- Create: `packages/features/rbac/src/components/role-form-dialog.tsx`
- Create: `apps/web/app/home/settings/roles/layout.tsx`
- Create: `apps/web/app/home/settings/roles/page.tsx`

**Interfaces:**
- Consumes: `RoleWithPermissions`, `saveRoleAction`, `deleteRoleAction` (Task 6); `SECTIONS` (Task 3); `requirePermission` (Task 4).

- [ ] **Step 1: Build the permission grid dialog**

`packages/features/rbac/src/components/role-form-dialog.tsx` — a `'use client'` component. Requirements:

- `useForm` with **no generic**, `resolver: zodResolver(RoleSchema)`.
- Read the live provider value with `useWatch({ control: form.control, name: 'permissions' })` — never `form.watch()`.
- Render one row per entry in `SECTIONS`. For each, render a checkbox **only** for verbs in `section.verbs`, so `payment_settings` shows Manage only and `home` shows View only.
- Checking Manage auto-checks View and disables it, mirroring `manage implies view`.
- Every field gets a `FormMessage`.
- `data-test="role-form-dialog"`, `data-test={'perm-' + section.key + '-' + verb}` on each checkbox, `data-test="save-role"` on submit.
- Disable the slug input when editing an existing role, and disable the whole form for `is_system` roles except the permission checkboxes.
- On submit call `saveRoleAction`; show `toast.promise` with success/error/loading strings.

- [ ] **Step 2: Build the roles list**

`packages/features/rbac/src/components/roles-manager.tsx` — `'use client'`. A `Card` per role showing name, slug, description, a `Badge` for `is_system` and `is_default`, the user count, and a compact summary of granted sections. Buttons: Edit (opens the dialog) and Delete (`data-test="delete-role"`), with Delete hidden for `is_system` roles. Wrap Delete in a confirmation dialog. On delete error, surface `error.message` directly — the service already converts the foreign-key violation into "This role still has users assigned."

- [ ] **Step 3: Add the guarded route**

`apps/web/app/home/settings/roles/layout.tsx`:

```tsx
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

async function RolesLayout(props: React.PropsWithChildren) {
  await requirePermission('roles', 'view');

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      {props.children}
    </>
  );
}

export default RolesLayout;
```

`apps/web/app/home/settings/roles/page.tsx` loads roles with `RolesService` via the admin client inside a `Suspense` boundary and renders `<RolesManager roles={roles} canManage={...} />`, where `canManage` comes from `hasPermission(await getCurrentPermissions(), 'roles', 'manage')`.

- [ ] **Step 4: Verify in the browser**

```bash
pnpm --filter web dev
```

Visit `/home/settings/roles` as the administrator. Create a role "Treasurer" with `payment_settings.manage` and `payments.manage`. Expected: it saves, appears in the list with user count 0, and `payment_settings` offers no View checkbox.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add packages/features/rbac apps/web/app/home/settings/roles
git commit -m "feat(rbac): add role management UI"
```

---

### Task 8: User management — service and server actions

**Files:**
- Create: `packages/features/rbac/src/schemas/user.schema.ts`
- Create: `packages/features/rbac/src/server/users.service.ts`
- Create: `packages/features/rbac/src/server/user-actions.ts`

**Interfaces:**
- Consumes: `loadPermissionsForUser`, `hasPermission`.
- Produces: `CreateUserSchema`; `UsersService` with `listUsers()`, `inviteUser()`, `createUserWithPassword()`, `assignRole()`, `setActive()`; actions `createUserAction`, `assignRoleAction`, `setUserActiveAction`.

Verified signatures in `@supabase/auth-js@2.111.0`:
`inviteUserByEmail(email, { data?, redirectTo? })`, `createUser(attributes)`, `updateUserById(id, { ban_duration })` where `ban_duration?: string | 'none'`, `listUsers({ page, perPage })`.

- [ ] **Step 1: Write the schema**

`packages/features/rbac/src/schemas/user.schema.ts`:

```ts
import * as z from 'zod';

export const CreateUserSchema = z
  .object({
    email: z.string().email(),
    role_id: z.string().uuid(),
    mode: z.enum(['invite', 'password']),
    password: z.string().min(8).optional(),
  })
  .refine((v) => v.mode !== 'password' || (v.password?.length ?? 0) >= 8, {
    message: 'A password of at least 8 characters is required',
    path: ['password'],
  });

export type CreateUserFormValues = z.infer<typeof CreateUserSchema>;
```

- [ ] **Step 2: Write the service**

`packages/features/rbac/src/server/users.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

type RbacClient = SupabaseClient<Database>;

/** Effectively permanent; Supabase has no true "ban forever" value. */
const BAN_FOREVER = '876000h';

export interface ManagedUser {
  id: string;
  email: string | null;
  created_at: string;
  is_active: boolean;
  role_id: string | null;
  role_name: string | null;
}

export class UsersService {
  constructor(private adminClient: RbacClient) {}

  async listUsers(): Promise<ManagedUser[]> {
    const { data, error } = await this.adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const { data: assignments } = await this.adminClient
      .from('user_roles')
      .select('user_id, role_id, roles(name)');

    return data.users.map((u) => {
      const assignment = (assignments ?? []).find((a) => a.user_id === u.id) as
        | { role_id: string; roles: { name: string } | null }
        | undefined;

      const bannedUntil = (u as { banned_until?: string }).banned_until;

      return {
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        is_active: !bannedUntil || new Date(bannedUntil) < new Date(),
        role_id: assignment?.role_id ?? null,
        role_name: assignment?.roles?.name ?? null,
      };
    });
  }

  async inviteUser(email: string, roleId: string, invitedBy: string): Promise<void> {
    const { data, error } = await this.adminClient.auth.admin.inviteUserByEmail(email);

    if (error || !data.user) {
      throw new Error(`Failed to invite user: ${error?.message}`);
    }

    await this.assignRole(data.user.id, roleId, invitedBy);
  }

  async createUserWithPassword(
    email: string,
    password: string,
    roleId: string,
    createdBy: string,
  ): Promise<void> {
    const { data, error } = await this.adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // Forces a rotation on first sign-in, so a password the admin knows
      // does not stay valid indefinitely.
      user_metadata: { must_change_password: true },
    });

    if (error || !data.user) {
      throw new Error(`Failed to create user: ${error?.message}`);
    }

    await this.assignRole(data.user.id, roleId, createdBy);
  }

  /** Runs after the on_auth_user_created trigger has made the accounts row. */
  async assignRole(userId: string, roleId: string, assignedBy: string): Promise<void> {
    const { error } = await this.adminClient
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: roleId, assigned_by: assignedBy },
        { onConflict: 'user_id' },
      );

    if (error) {
      throw new Error(error.message);
    }
  }

  async setActive(userId: string, active: boolean): Promise<void> {
    const { error } = await this.adminClient.auth.admin.updateUserById(userId, {
      ban_duration: active ? 'none' : BAN_FOREVER,
    });

    if (error) {
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }
}
```

- [ ] **Step 3: Write the server actions**

`packages/features/rbac/src/server/user-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { CreateUserSchema } from '../schemas/user.schema';
import { loadPermissionsForUser } from './permissions.service';
import { UsersService } from './users.service';
import { hasPermission } from '../types/permissions';

async function assertCanManageUsers(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'users', 'manage')) {
    throw new Error('Unauthorized: users.manage required');
  }

  return client;
}

export const createUserAction = enhanceAction(
  async (data: unknown, user) => {
    const client = await assertCanManageUsers(user.id);
    const parsed = CreateUserSchema.parse(data);
    const service = new UsersService(client);

    if (parsed.mode === 'invite') {
      await service.inviteUser(parsed.email, parsed.role_id, user.id);
    } else {
      await service.createUserWithPassword(
        parsed.email,
        parsed.password!,
        parsed.role_id,
        user.id,
      );
    }

    revalidatePath('/home/settings/users');

    return { success: true };
  },
  {},
);

export const assignRoleAction = enhanceAction(
  async (data: { userId: string; roleId: string }, user) => {
    const client = await assertCanManageUsers(user.id);

    // Prevents self-demotion lockout. The DB trigger is the backstop.
    if (data.userId === user.id) {
      throw new Error('You cannot change your own role');
    }

    await new UsersService(client).assignRole(data.userId, data.roleId, user.id);

    revalidatePath('/home/settings/users');

    return { success: true };
  },
  {},
);

export const setUserActiveAction = enhanceAction(
  async (data: { userId: string; active: boolean }, user) => {
    const client = await assertCanManageUsers(user.id);

    if (data.userId === user.id) {
      throw new Error('You cannot deactivate yourself');
    }

    await new UsersService(client).setActive(data.userId, data.active);

    revalidatePath('/home/settings/users');

    return { success: true };
  },
  {},
);
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm run typecheck
git add packages/features/rbac
git commit -m "feat(rbac): add user management service and actions"
```

---

### Task 9: User management UI and forced password rotation

**Files:**
- Create: `packages/features/rbac/src/components/users-manager.tsx`
- Create: `packages/features/rbac/src/components/create-user-dialog.tsx`
- Create: `apps/web/app/home/settings/users/layout.tsx`
- Create: `apps/web/app/home/settings/users/page.tsx`
- Modify: `apps/web/config/paths.config.ts`
- Modify: `apps/web/app/home/layout.tsx`
- Create: `apps/web/i18n/messages/en/rbac.json`
- Modify: `apps/web/i18n/request.ts`, `apps/web/i18n/messages/en/common.json`

- [ ] **Step 1: Add paths**

In `apps/web/config/paths.config.ts`, add to both `PathsSchema.app` (as `z.string().min(1)`) and the parsed object:

```ts
users: '/home/settings/users',
roles: '/home/settings/roles',
```

- [ ] **Step 2: Build the create-user dialog**

`create-user-dialog.tsx`, `'use client'`. A `Select` for mode (Invite / Set password) read via `useWatch`; the password field renders only when mode is `password`. A `Select` for role populated from props. `data-test="create-user-dialog"`, `data-test="user-email"`, `data-test="user-mode"`, `data-test="user-role"`, `data-test="submit-create-user"`. `FormMessage` on every field. Calls `createUserAction`.

When mode is Invite, show a hint: invites require SMTP configured in Supabase; the built-in sandbox mailer is rate-limited and not viable in production.

- [ ] **Step 3: Build the users table**

`users-manager.tsx`, `'use client'`. A `Table` with columns Email, Role, Status, Created, Actions. Role is an inline `Select` calling `assignRoleAction`. Status is an active/inactive `Badge` with a toggle calling `setUserActiveAction`. Disable both controls on the current user's own row and show a tooltip explaining why. Surface action errors verbatim via `toast.error(error.message)` so the trigger's "This change would leave no active administrator" reaches the admin.

- [ ] **Step 4: Add the guarded route**

`apps/web/app/home/settings/users/layout.tsx` mirrors the roles layout but calls `await requirePermission('users', 'view')`. The page loads users via `UsersService` and roles via `RolesService`, passing `canManage` down.

- [ ] **Step 5: Enforce the password rotation flag**

In `apps/web/app/home/layout.tsx`, after resolving the user, redirect when the flag is set:

```tsx
const mustChangePassword = Boolean(
  (user.user_metadata as { must_change_password?: boolean } | undefined)
    ?.must_change_password,
);

if (mustChangePassword) {
  redirect(pathsConfig.auth.passwordUpdate);
}
```

The flag must be cleared once the password is updated. In the password-update flow, call `supabase.auth.updateUser({ data: { must_change_password: false } })` alongside the password change. Verify the claim shape first — `requireUserInServerComponent` returns a `JwtPayload`, so confirm `user_metadata` is present on it; if not, read the flag with `supabase.auth.getUser()` in the layout instead.

- [ ] **Step 6: Add translations**

Create `apps/web/i18n/messages/en/rbac.json` with keys for both pages: `roles.title`, `roles.create`, `roles.editRole`, `roles.deleteConfirm`, `roles.systemRoleBadge`, `roles.defaultRoleBadge`, `roles.userCount`, `users.title`, `users.createUser`, `users.inviteMode`, `users.passwordMode`, `users.smtpHint`, `users.active`, `users.inactive`, `users.deactivate`, `users.reactivate`, `users.cannotEditSelf`, plus `sections.<key>` labels for all six sections and `verbs.view` / `verbs.manage`.

Add `'rbac'` to the `namespaces` array in `apps/web/i18n/request.ts`. Add `routes.users` ("Users") and `routes.roles` ("Roles") to `apps/web/i18n/messages/en/common.json`.

- [ ] **Step 7: Verify end to end in the browser**

Create a user via Set-password mode with the Treasurer role from Task 7. Sign in as that user in a private window. Expected: forced to `/update-password`; after changing it, the sidebar shows Payments and Payment Settings but **not** Users or Roles.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm run typecheck
git add packages/features/rbac apps/web/app/home apps/web/config apps/web/i18n
git commit -m "feat(rbac): add user management UI and forced password rotation"
```

---

### Task 10: Cutover — migrate payments to `has_permission`, drop `admin_users`

Deliberately last. Until now `admin_users` and `kit.is_admin()` were untouched, so every prior task left a working tree. This task removes them and repoints everything at the new system in one commit.

**Files:**
- Create: `apps/web/supabase/migrations/<version>_rbac_cutover.sql`
- Modify: `apps/web/app/home/settings/payments/page.tsx`, `apps/web/app/home/payments/page.tsx`
- Modify: `packages/features/payments/src/server/server-actions.ts`
- Modify: `packages/supabase/src/database.types.ts`, `apps/web/lib/database.types.ts`

- [ ] **Step 1: Write the cutover migration**

Each policy names the permission it actually means. Mapping `is_admin()` onto a single permission would break granularity — a Treasurer with `payment_settings.manage` but not `users.manage` would pass the app guard and then get zero rows from the database.

Create `apps/web/supabase/migrations/20260921000004_rbac_cutover.sql`:

```sql
-- payment_config: gated by payment_settings.manage
drop policy if exists payment_config_select on public.payment_config;
drop policy if exists payment_config_update on public.payment_config;

create policy payment_config_select on public.payment_config
    for select to authenticated
    using (kit.has_permission('payment_settings', 'manage'));

create policy payment_config_update on public.payment_config
    for update to authenticated
    using (kit.has_permission('payment_settings', 'manage'))
    with check (kit.has_permission('payment_settings', 'manage'));

-- payments: own rows always; all rows with payments.manage
drop policy if exists payments_select_own on public.payments;

create policy payments_select_own on public.payments
    for select to authenticated
    using (
        user_id = (select auth.uid())
        or kit.has_permission('payments', 'manage')
    );

-- payment_items mirrors parent payment visibility
drop policy if exists payment_items_select on public.payment_items;

create policy payment_items_select on public.payment_items
    for select to authenticated
    using (
        exists (
            select 1 from public.payments p
            where p.id = payment_id
              and (
                p.user_id = (select auth.uid())
                or kit.has_permission('payments', 'manage')
              )
        )
    );

-- Remove the legacy system. Backfill already happened in the first migration.
drop function if exists kit.is_admin();
drop table if exists public.admin_users;
```

- [ ] **Step 2: Confirm the backfill before dropping**

Run **before** applying, via MCP `execute_sql`:

```sql
select
  (select count(*) from public.admin_users) as legacy,
  (select count(*) from public.user_roles ur
     join public.role_permissions rp on rp.role_id = ur.role_id
   where rp.section = 'users' and rp.can_manage) as migrated_admins;
```

Expected: `migrated_admins >= legacy`, and `migrated_admins >= 1`. **If `migrated_admins` is 0, stop** — applying would lock everyone out of user management.

- [ ] **Step 3: Apply and reconcile the filename**

Apply via MCP `apply_migration` with name `rbac_cutover`, then `list_migrations` and rename the local file to the recorded version.

- [ ] **Step 4: Repoint the three call sites**

In `apps/web/app/home/settings/payments/page.tsx`, delete the `admin_users` query and the `!adminUser` redirect; replace with:

```tsx
await requirePermission('payment_settings', 'manage');
```

In `apps/web/app/home/payments/page.tsx`, replace the `admin_users` query with:

```tsx
const perms = await getCurrentPermissions();
const isAdmin = hasPermission(perms, 'payments', 'manage');
```

keeping `isAdmin` flowing into `paymentService.getPayments(user.id, isAdmin)` and `showMember`.

In `packages/features/payments/src/server/server-actions.ts`, delete the `checkIsAdmin` helper and its `admin_users` query. Replace both call sites with a permission check using `loadPermissionsForUser` + `hasPermission(perms, 'payment_settings', 'manage')`, matching the pattern in `role-actions.ts`.

- [ ] **Step 5: Regenerate types and confirm the drop**

Call MCP `generate_typescript_types`, write to `packages/supabase/src/database.types.ts`, then `cp` to `apps/web/lib/database.types.ts`.

```bash
grep -c "admin_users" packages/supabase/src/database.types.ts
```
Expected: `0`.

- [ ] **Step 6: Verify RLS under both roles**

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<treasurer-user-id>","role":"authenticated"}';
select count(*) as treasurer_sees_config from public.payment_config;
rollback;
```

Expected: `1` — proving the Treasurer reaches provider config **without** holding `users.manage`. This is the exact case the discarded `is_admin()` shim would have broken.

Then repeat with a Member's id. Expected: `0`.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm run typecheck
grep -rn "admin_users\|is_admin" apps/web/app packages/features | grep -v database.types
```
Expected: typecheck clean; grep returns nothing.

```bash
git add apps/web packages
git commit -m "feat(rbac): migrate payments to has_permission and drop admin_users"
```

---

### Task 11: End-to-end tests

**Files:**
- Create: `apps/e2e/tests/rbac/rbac.spec.ts`

**Interfaces:**
- Consumes: the running app and the roles seeded in Task 1.

- [ ] **Step 1: Read the existing specs for the local conventions**

Read `apps/e2e/tests/account/account.spec.ts` and `apps/e2e/tests/authentication/auth.spec.ts`. Reuse their sign-in helper and page-object style rather than inventing a new one.

- [ ] **Step 2: Write the spec**

`apps/e2e/tests/rbac/rbac.spec.ts` covering:

1. **Admin sees every section.** Sign in as administrator; assert the sidebar exposes Home, Payments, Payment Settings, Users, and Roles.
2. **Create a restricted user.** As admin, open `/home/settings/users`, create a user in password mode with the Member role.
3. **Member sees only member sections.** Sign in as that user in a fresh context; assert Users and Roles are **absent** from the nav.
4. **Direct navigation is blocked.** As the member, navigate straight to `/home/settings/roles`; assert redirection to `/home`. This is the check that distinguishes real enforcement from a hidden link.
5. **Revocation applies on next navigation.** As admin, change that user's role to one without `payments.view`; in the member's context navigate again and assert Payments has disappeared.

- [ ] **Step 3: Run the suite**

```bash
pnpm --filter web-e2e test
```
Expected: all 5 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/tests/rbac
git commit -m "test(rbac): add end-to-end permission enforcement tests"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: section registry → 3; schema → 1; permission function → 1; policy-rewrite correction → 10; migration sequence → 1 and 10; lockout guards → 2; enforcement layers → 4 (guard), 6 and 8 (action re-checks), 1 and 10 (RLS); navigation filtering → 5; user management → 8 and 9; structure → 3; testing → 3, 5, 11; `must_change_password` → 9; `is_default` role → 1 and 6.

**Deviation from the spec's original sketch.** The spec's migration sequence drops `admin_users` in step 6 of a single migration. This plan splits that across Task 1 (additive) and Task 10 (cutover) so that no intermediate task leaves the repository in a state where the payments pages reference a dropped table. The end state is identical.

**Known risk.** The PostgREST embedded-select in Task 4 Step 2 is the least certain line in the plan; Step 4 verifies it against the live database and supplies a two-query fallback.
