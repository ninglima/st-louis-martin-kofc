# Member Roster Import & Members List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Financial Secretary upload the Officers Online Contact Extract as exported, preview every change before it is written, apply it safely and repeatedly, and browse the resulting roster.

**Architecture:** A new `@kit/members` package holds pure, Supabase-free parsing and planning logic (testable with vitest alone) plus the server actions and UI that use it. Member PII lives in `public.members` with the sensitive columns stored as `bytea`, encrypted by `pgcrypto` with a key held in Supabase Vault. The application never sees the key: all reads and writes of encrypted data go through `security definer` functions that check RBAC permissions and handle the crypto internally.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres, RLS, Vault, pgcrypto), `exceljs`, vitest, Playwright, Base UI via `@kit/ui`.

**Spec:** `docs/superpowers/specs/2026-09-22-roster-import-design.md`

## Global Constraints

- **An import must never change dues state.** Not level, not expiry, not paid-through, regardless of whether the member currently has any. A lapsed non-payer is indistinguishable from a never-leveled member; the WordPress build got this wrong and silently re-leveled lapsed members current with no payment made.
- **Fill blanks only.** A contact field is written only where the record currently holds nothing. Where both sides hold differing values, the stored value wins, nothing is written, and the field is reported as a conflict.
- **A changed email is a conflict, never an auto-update.**
- **Members absent from an uploaded file are reported, never deactivated or deleted.**
- **Re-running an identical file must be a no-op** — every row resolves to `update` or `nochange`.
- **The uploaded file is never written to storage.** It is parsed from memory and discarded.
- **The real extract is member PII and must never be committed to this repository.** All fixtures are synthetic and generated.
- Headers are matched **by name, case-insensitively and trimmed** — never by position.
- Required headers: `Membership Number`, `First Name`, `Last Name`, `Primary Email`. A missing one fails the upload before any preview and before any write.
- Names are trimmed but **case is left untouched** (the real sample contains `Iii`; "fixing" it would be guessing).
- Ceilings: 5 MB and 5,000 rows.
- Permission is re-checked on **every** apply chunk, never trusted from the upload.
- `pnpm run typecheck` and `pnpm run lint` stay at zero errors and zero warnings.
- Semantic Tailwind classes only (`text-foreground`, `text-muted-foreground`), never hardcoded colours.
- Base UI, **not** Radix: navigating buttons use `render={<Link href=... />}`, never `asChild`. Selects are controlled with `value=`, never `defaultValue=`.
- Server actions return errors as values (`ActionResult`), never throw them — Next.js redacts thrown Server Action messages in production.
- `apps/web/config/**` is shell-write-denied by the sandbox; use the Edit/Write tools there, never `>>`/`sed -i`/`tee`, and never run a repo-wide formatter from a shell.

---

## File Structure

```
apps/web/supabase/migrations/
  <timestamp>_members.sql                  tables, vault key, crypto fns, RLS

packages/features/members/
  package.json                             @kit/members
  tsconfig.json
  src/
    types/roster.ts                        RosterRecord, PlanRow, ImportPlan, ImportResults
    server/
      normalize.ts                         email/phone/state/zip/name normalization
      normalize.test.ts
      column-map.ts                        header -> field, required-header check
      column-map.test.ts
      roster-reader.ts                     .xlsx/.csv -> string[][]
      roster-reader.test.ts
      roster-parser.ts                     rows -> RosterRecord[] + row errors
      roster-parser.test.ts
      roster-plan.ts                       records + existing -> ImportPlan
      roster-plan.test.ts
      members.service.ts                   read members page, CSV export
      roster-import.service.ts             apply one chunk of a plan
      roster-actions.ts                    server actions
    components/
      roster-import-form.tsx
      roster-import-preview.tsx
      members-list.tsx
  test/fixtures/make-fixture.ts            generates the synthetic .xlsx

apps/web/app/home/members/
  page.tsx                                 members list      (members.view)
  import/page.tsx                          import wizard     (members.manage)

packages/features/rbac/src/types/sections.ts   + 'members' section
apps/web/config/navigation.config.tsx          + nav entry
apps/web/next.config.mjs                       serverActions.bodySizeLimit
apps/e2e/tests/members/members.spec.ts         e2e
```

`normalize`, `column-map`, `roster-reader`, `roster-parser` and `roster-plan` take **no Supabase dependency**. That is what makes the risky logic testable without a database, and it is the same decoupling that let the WordPress version be tested without test infrastructure.

---

### Task 1: Schema, encryption and the `members` RBAC section

**Files:**
- Create: `apps/web/supabase/migrations/<timestamp>_members.sql` (use `mcp__supabase__apply_migration` with name `members`)
- Modify: `packages/features/rbac/src/types/sections.ts`
- Modify: `apps/web/config/navigation.config.tsx`

**Interfaces:**
- Produces: tables `public.members`, `public.roster_imports`; functions `public.members_list(text, int, int)`, `public.member_upsert_from_roster(jsonb)`, `public.members_absent_from(text[])`; RBAC section key `'members'` with verbs `view` and `manage`.

- [ ] **Step 1: Add the `members` section to the RBAC registry**

In `packages/features/rbac/src/types/sections.ts`, add to the `SECTIONS` array after the `roles` entry:

```ts
  {
    key: 'members',
    label: 'Member Roster',
    description:
      'View: the council member list. Manage: upload and apply a roster import',
    verbs: ['view', 'manage'],
  },
```

- [ ] **Step 2: Run the RBAC unit tests to confirm the registry still parses**

Run: `pnpm --filter @kit/rbac test:unit`
Expected: PASS. These tests walk `SECTIONS`; a malformed entry fails here.

- [ ] **Step 3: Create the migration**

Apply with the Supabase MCP tool `apply_migration`, name `members`. Content:

```sql
-- Member roster. Contact data only: the Officers Online extract carries no
-- dues, level, status or join date, and `member_upsert_from_roster` below is
-- deliberately incapable of writing any.
create table if not exists public.members (
    id                  uuid primary key default extensions.uuid_generate_v4(),
    membership_number   text not null unique,
    user_id             uuid references auth.users on delete set null,

    -- Plaintext: needed for search, sort and filter on the members list.
    -- primary_email is deliberately NOT encrypted: the same address is in
    -- auth.users because import creates accounts, so encrypting this copy
    -- would be theatre.
    prefix              text,
    first_name          text not null,
    middle_name         text,
    last_name           text not null,
    suffix              text,
    primary_email       text,
    city                text,
    state               text,
    country             text,
    primary_type        text,
    bad_address         boolean not null default false,

    -- Encrypted with pgcrypto; key lives in Vault. Never readable without
    -- going through the security definer functions below.
    address_line1_enc   bytea,
    address_line2_enc   bytea,
    postal_code_enc     bytea,
    phone_cell_enc      bytea,
    phone_residence_enc bytea,
    phone_business_enc  bytea,
    email_secondary_enc bytea,
    secondary_address_enc bytea,

    roster_last_seen_at timestamptz,
    roster_source_file  text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

comment on table public.members is
  'Supreme Council roster. Sensitive columns are pgcrypto-encrypted; read them only through members_list().';

create index members_last_name_idx on public.members (last_name);
create index members_user_id_idx   on public.members (user_id);

create table if not exists public.roster_imports (
    id           uuid primary key default extensions.uuid_generate_v4(),
    uploaded_by  uuid references auth.users on delete set null,
    filename     text not null,
    status       text not null default 'previewed'
                 check (status in ('previewed','applying','complete','failed')),
    plan         jsonb not null,
    results      jsonb,
    created_at   timestamptz not null default now(),
    completed_at timestamptz
);

comment on table public.roster_imports is
  'Import history. The plan is written before anything is applied, so a failed run is resumable and every month leaves a record of what changed.';

alter table public.members        enable row level security;
alter table public.roster_imports enable row level security;

-- The encryption key. Created once here with a random value; rotate by
-- updating the Vault secret, which requires re-encrypting existing rows.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'members_pii_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'members_pii_key',
      'Symmetric key for pgcrypto-encrypted member PII columns'
    );
  end if;
end $$;

create or replace function kit.members_pii_key()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'members_pii_key'
$$;

revoke all on function kit.members_pii_key() from public, anon, authenticated;

-- Reads. One function so the permission check and the key access live in one
-- place, and the app can never decrypt an arbitrary blob.
create or replace function public.members_list(
    p_search text default null,
    p_limit  int  default 50,
    p_offset int  default 0
)
returns table (
    id uuid, membership_number text, user_id uuid,
    full_name text, primary_email text, city text, state text,
    bad_address boolean, roster_last_seen_at timestamptz,
    address_line1 text, postal_code text, phone text
)
language sql
security definer
set search_path = ''
stable
as $$
  select m.id, m.membership_number, m.user_id,
         trim(concat_ws(' ', m.prefix, m.first_name, m.middle_name, m.last_name, m.suffix)),
         m.primary_email, m.city, m.state, m.bad_address, m.roster_last_seen_at,
         extensions.pgp_sym_decrypt(m.address_line1_enc, kit.members_pii_key()),
         extensions.pgp_sym_decrypt(m.postal_code_enc,   kit.members_pii_key()),
         coalesce(
           extensions.pgp_sym_decrypt(m.phone_cell_enc,      kit.members_pii_key()),
           extensions.pgp_sym_decrypt(m.phone_residence_enc, kit.members_pii_key()),
           extensions.pgp_sym_decrypt(m.phone_business_enc,  kit.members_pii_key())
         )
  from public.members m
  where kit.has_permission('members', 'view')
    and (
      p_search is null or p_search = ''
      or m.membership_number ilike '%' || p_search || '%'
      or m.primary_email     ilike '%' || p_search || '%'
      or m.first_name        ilike '%' || p_search || '%'
      or m.last_name         ilike '%' || p_search || '%'
    )
  order by m.last_name, m.first_name
  limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- Writes. Takes one already-normalized record. Deliberately has no parameter
-- for any dues field: an import cannot change dues state even by mistake.
create or replace function public.member_upsert_from_roster(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := kit.members_pii_key();
  v_id  uuid;
begin
  if not kit.has_permission('members', 'manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  insert into public.members as m (
    membership_number, user_id, prefix, first_name, middle_name, last_name,
    suffix, primary_email, city, state, country, primary_type, bad_address,
    address_line1_enc, address_line2_enc, postal_code_enc,
    phone_cell_enc, phone_residence_enc, phone_business_enc,
    email_secondary_enc, secondary_address_enc,
    roster_last_seen_at, roster_source_file
  )
  values (
    p->>'membership_number', (p->>'user_id')::uuid, p->>'prefix',
    p->>'first_name', p->>'middle_name', p->>'last_name', p->>'suffix',
    p->>'primary_email', p->>'city', p->>'state', p->>'country',
    p->>'primary_type', coalesce((p->>'bad_address')::boolean, false),
    extensions.pgp_sym_encrypt(p->>'address_line1',  v_key),
    extensions.pgp_sym_encrypt(p->>'address_line2',  v_key),
    extensions.pgp_sym_encrypt(p->>'postal_code',    v_key),
    extensions.pgp_sym_encrypt(p->>'phone_cell',     v_key),
    extensions.pgp_sym_encrypt(p->>'phone_residence',v_key),
    extensions.pgp_sym_encrypt(p->>'phone_business', v_key),
    extensions.pgp_sym_encrypt(p->>'email_secondary',v_key),
    extensions.pgp_sym_encrypt(p->>'secondary_address', v_key),
    now(), p->>'source_file'
  )
  on conflict (membership_number) do update set
    -- FILL BLANKS ONLY. coalesce keeps whatever is already stored; the new
    -- value lands only where the column is currently null. This is what makes
    -- the monthly re-import safe: a member's own correction is never reverted.
    user_id             = coalesce(m.user_id, excluded.user_id),
    prefix              = coalesce(m.prefix, excluded.prefix),
    middle_name         = coalesce(m.middle_name, excluded.middle_name),
    suffix              = coalesce(m.suffix, excluded.suffix),
    city                = coalesce(m.city, excluded.city),
    state               = coalesce(m.state, excluded.state),
    country             = coalesce(m.country, excluded.country),
    primary_type        = coalesce(m.primary_type, excluded.primary_type),
    address_line1_enc   = coalesce(m.address_line1_enc, excluded.address_line1_enc),
    address_line2_enc   = coalesce(m.address_line2_enc, excluded.address_line2_enc),
    postal_code_enc     = coalesce(m.postal_code_enc, excluded.postal_code_enc),
    phone_cell_enc      = coalesce(m.phone_cell_enc, excluded.phone_cell_enc),
    phone_residence_enc = coalesce(m.phone_residence_enc, excluded.phone_residence_enc),
    phone_business_enc  = coalesce(m.phone_business_enc, excluded.phone_business_enc),
    email_secondary_enc = coalesce(m.email_secondary_enc, excluded.email_secondary_enc),
    secondary_address_enc = coalesce(m.secondary_address_enc, excluded.secondary_address_enc),
    -- first/last name and primary_email are NOT updated here. A change to any
    -- of them is surfaced as a conflict for a human, never auto-applied.
    bad_address         = excluded.bad_address,
    roster_last_seen_at = now(),
    roster_source_file  = excluded.roster_source_file,
    updated_at          = now()
  returning m.id into v_id;

  return v_id;
end $$;

-- Members on the roster but absent from the uploaded file. Computed only over
-- rows that carry a membership_number, so officer logins never appear.
create or replace function public.members_absent_from(p_numbers text[])
returns table (membership_number text, full_name text)
language sql
security definer
set search_path = ''
stable
as $$
  select m.membership_number,
         trim(concat_ws(' ', m.first_name, m.last_name))
  from public.members m
  where kit.has_permission('members', 'view')
    and not (m.membership_number = any(p_numbers))
$$;

-- RLS. A member may always read their own row; officers read via members_list.
create policy members_select_own on public.members
  for select to authenticated
  using (user_id = (select auth.uid()) or kit.has_permission('members', 'view'));

create policy members_no_direct_write on public.members
  for all to authenticated
  using (false) with check (false);

create policy roster_imports_rw on public.roster_imports
  for all to authenticated
  using (kit.has_permission('members', 'manage'))
  with check (kit.has_permission('members', 'manage'));
```

- [ ] **Step 4: Verify the encryption round-trips and is opaque without the key**

Run via `mcp__supabase__execute_sql`:

```sql
select extensions.pgp_sym_decrypt(
         extensions.pgp_sym_encrypt('123 Test St', kit.members_pii_key()),
         kit.members_pii_key()
       ) as roundtrip,
       length(extensions.pgp_sym_encrypt('123 Test St', kit.members_pii_key())) as cipher_bytes;
```

Expected: `roundtrip` = `123 Test St`, `cipher_bytes` > 30 (ciphertext, not the input).

- [ ] **Step 5: Verify `members_no_direct_write` actually blocks a direct insert**

```sql
set local role authenticated;
insert into public.members (membership_number, first_name, last_name)
values ('999999', 'Should', 'Fail');
```

Expected: error `42501` (new row violates row-level security policy). Reset with `reset role;`.

- [ ] **Step 6: Add the nav entry**

In `apps/web/config/navigation.config.tsx`, add a route entry pointing at `/home/members` with the `Users` icon from `lucide-react`, following the shape of the existing entries. Use the Edit tool — `apps/web/config/**` rejects shell writes.

- [ ] **Step 7: Regenerate database types**

Run `pnpm --filter web supabase:typegen`.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm run typecheck && pnpm run lint
git add apps/web/supabase/migrations packages/features/rbac/src/types/sections.ts apps/web/config/navigation.config.tsx apps/web/lib/database.types.ts packages/supabase/src/database.types.ts
git commit -m "feat(members): add the roster schema, PII encryption and members RBAC section"
```

---

### Task 2: The `@kit/members` package and field normalization

**Files:**
- Create: `packages/features/members/package.json`, `tsconfig.json`
- Create: `packages/features/members/src/types/roster.ts`
- Create: `packages/features/members/src/server/normalize.ts`
- Test: `packages/features/members/src/server/normalize.test.ts`

**Interfaces:**
- Produces: `normalizeEmail`, `normalizePhone`, `normalizeState`, `normalizeName`, `normalizeZip`; type `RosterRecord`.

- [ ] **Step 1: Create the package**

`packages/features/members/package.json`:

```json
{
  "name": "@kit/members",
  "version": "0.1.0",
  "private": true,
  "typesVersions": { "*": { "*": ["src/*"] } },
  "exports": {
    "./types": "./src/types/roster.ts",
    "./server/*": "./src/server/*.ts",
    "./components/*": "./src/components/*.tsx"
  },
  "scripts": {
    "clean": "git clean -xdf .turbo node_modules",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@kit/i18n": "workspace:*",
    "exceljs": "^4.4.0",
    "next-intl": "catalog:"
  },
  "devDependencies": {
    "@kit/next": "workspace:*",
    "@kit/rbac": "workspace:*",
    "@kit/supabase": "workspace:*",
    "@kit/tsconfig": "workspace:*",
    "@kit/ui": "workspace:*",
    "@supabase/supabase-js": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "next": "catalog:",
    "react": "catalog:",
    "vitest": "catalog:",
    "zod": "catalog:"
  }
}
```

Copy `packages/features/rbac/tsconfig.json` to `packages/features/members/tsconfig.json` unchanged.

Run `pnpm install` from the repo root.

- [ ] **Step 2: Define the record type**

`packages/features/members/src/types/roster.ts`:

```ts
/** One roster row after normalization. All fields trimmed; empty means null. */
export interface RosterRecord {
  membershipNumber: string;
  prefix: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  primaryEmail: string | null;
  emailSecondary: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  primaryType: string | null;
  phoneCell: string | null;
  phoneResidence: string | null;
  phoneBusiness: string | null;
  secondaryAddress: Record<string, string> | null;
  badAddress: boolean;
  /** 1-based row number in the source file, for error reporting. */
  sourceRow: number;
}
```

- [ ] **Step 3: Write the failing normalization tests**

`packages/features/members/src/server/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from './normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    // The real extract is full of addresses like this.
    expect(normalizeEmail('  PABRAHAM@PJILAW.COM ')).toBe('pabraham@pjilaw.com');
  });

  it('returns null for blank', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('formats a ten-digit US number', () => {
    expect(normalizePhone('7034774236')).toBe('(703) 477-4236');
  });

  it('strips punctuation before formatting', () => {
    expect(normalizePhone('703.477.4236')).toBe('(703) 477-4236');
  });

  it('drops a leading country code', () => {
    expect(normalizePhone('+1 703 477 4236')).toBe('(703) 477-4236');
  });

  it('leaves a non-US-shaped number unformatted rather than mangling it', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('returns null for blank', () => {
    expect(normalizePhone('')).toBeNull();
  });
});

describe('normalizeState', () => {
  it('uppercases a valid state', () => {
    expect(normalizeState('va')).toBe('VA');
  });

  it('returns null for something that is not a state', () => {
    expect(normalizeState('Virginia')).toBeNull();
    expect(normalizeState('ZZ')).toBeNull();
  });
});

describe('normalizeZip', () => {
  it('preserves ZIP+4, which the whole sample uses', () => {
    expect(normalizeZip('20147-3067')).toBe('20147-3067');
  });

  it('preserves a five-digit ZIP', () => {
    expect(normalizeZip('20147')).toBe('20147');
  });
});

describe('normalizeName', () => {
  it('trims but does not touch case', () => {
    // The sample contains "Iii" where "III" was meant. Silently correcting
    // it would be guessing; the officer fixes it at source.
    expect(normalizeName('  Iii ')).toBe('Iii');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @kit/members test:unit`
Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 5: Implement normalization**

`packages/features/members/src/server/normalize.ts`:

```ts
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY','AS','GU','MP','PR','VI','AA','AE','AP',
]);

function blankToNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeEmail(value: string | undefined | null): string | null {
  const trimmed = blankToNull(value);
  return trimmed === null ? null : trimmed.toLowerCase();
}

/**
 * Digits-only US numbers are formatted `(703) 477-4236`. Anything else is
 * returned trimmed but otherwise untouched: a number we cannot confidently
 * parse is better stored as the officer sees it than reshaped into something
 * that looks right and dials wrong.
 */
export function normalizePhone(value: string | undefined | null): string | null {
  const trimmed = blankToNull(value);
  if (trimmed === null) return null;

  const digits = trimmed.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (local.length !== 10) return trimmed;

  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function normalizeState(value: string | undefined | null): string | null {
  const trimmed = blankToNull(value);
  if (trimmed === null) return null;

  const upper = trimmed.toUpperCase();
  return US_STATES.has(upper) ? upper : null;
}

/** Preserved as-is, including ZIP+4, which the entire real sample uses. */
export function normalizeZip(value: string | undefined | null): string | null {
  return blankToNull(value);
}

/** Trimmed only. Case is deliberately untouched — see normalize.test.ts. */
export function normalizeName(value: string | undefined | null): string | null {
  return blankToNull(value);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @kit/members test:unit`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members pnpm-lock.yaml
git commit -m "feat(members): add the package and roster field normalization"
```

---

### Task 3: Column mapping and required-header validation

**Files:**
- Create: `packages/features/members/src/server/column-map.ts`
- Test: `packages/features/members/src/server/column-map.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `REQUIRED_HEADERS: readonly string[]`, `mapHeaders(headerRow: string[]): HeaderMap`, `type HeaderMap = { index: Record<string, number>; missing: string[] }`.

- [ ] **Step 1: Write the failing tests**

`packages/features/members/src/server/column-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mapHeaders, REQUIRED_HEADERS } from './column-map';

const FULL_HEADER = [
  'Membership Number','Prefix','First Name','Middle Name','Last Name','Suffix',
  'Fraternal - Bad Address','Primary Type','Address Line 1','Address Line 2',
  'City','State/Province','Postal Code','Country','Secondary Type',
  'Address Line 1 (Secondary)','Address Line 2 (Secondary)','City (Secondary)',
  'State/Province (Secondary)','Postal Code (Secondary)','Country (Secondary)',
  'Residence Phone','Business Phone','Cell Phone','Primary Email',
  'Secondary Email','Tertiary Email',
];

describe('mapHeaders', () => {
  it('maps every column of the real extract shape', () => {
    const { index, missing } = mapHeaders(FULL_HEADER);

    expect(missing).toEqual([]);
    expect(index.membershipNumber).toBe(0);
    expect(index.primaryEmail).toBe(24);
    expect(index.cellPhone).toBe(23);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const { index, missing } = mapHeaders([
      '  membership number ', 'FIRST NAME', 'last name', 'Primary EMAIL',
    ]);

    expect(missing).toEqual([]);
    expect(index.membershipNumber).toBe(0);
    expect(index.lastName).toBe(2);
  });

  it('matches by name, not position, so a reordered export still works', () => {
    const { index } = mapHeaders([
      'Primary Email', 'Last Name', 'First Name', 'Membership Number',
    ]);

    expect(index.membershipNumber).toBe(3);
    expect(index.primaryEmail).toBe(0);
  });

  it('reports every missing required header by name', () => {
    const { missing } = mapHeaders(['First Name', 'Last Name']);

    expect(missing).toEqual(['Membership Number', 'Primary Email']);
  });

  it('ignores unrecognized extra columns silently', () => {
    const { index, missing } = mapHeaders([
      'Membership Number','First Name','Last Name','Primary Email','Council Notes',
    ]);

    expect(missing).toEqual([]);
    expect(Object.keys(index)).not.toContain('councilNotes');
  });

  it('exposes exactly the four required headers', () => {
    expect(REQUIRED_HEADERS).toEqual([
      'Membership Number', 'First Name', 'Last Name', 'Primary Email',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kit/members test:unit column-map`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/features/members/src/server/column-map.ts`:

```ts
/**
 * Header text -> field name. Matched by name, case-insensitively and trimmed,
 * never by position: a future Officers Online export could reorder columns and
 * a positional reader would silently import addresses into phone fields.
 */
const HEADER_TO_FIELD: Record<string, string> = {
  'membership number': 'membershipNumber',
  'prefix': 'prefix',
  'first name': 'firstName',
  'middle name': 'middleName',
  'last name': 'lastName',
  'suffix': 'suffix',
  'fraternal - bad address': 'badAddress',
  'primary type': 'primaryType',
  'address line 1': 'addressLine1',
  'address line 2': 'addressLine2',
  'city': 'city',
  'state/province': 'state',
  'postal code': 'postalCode',
  'country': 'country',
  'secondary type': 'secondaryType',
  'address line 1 (secondary)': 'secondaryAddressLine1',
  'address line 2 (secondary)': 'secondaryAddressLine2',
  'city (secondary)': 'secondaryCity',
  'state/province (secondary)': 'secondaryState',
  'postal code (secondary)': 'secondaryPostalCode',
  'country (secondary)': 'secondaryCountry',
  'residence phone': 'residencePhone',
  'business phone': 'businessPhone',
  'cell phone': 'cellPhone',
  'primary email': 'primaryEmail',
  'secondary email': 'secondaryEmail',
  'tertiary email': 'tertiaryEmail',
};

export const REQUIRED_HEADERS = [
  'Membership Number',
  'First Name',
  'Last Name',
  'Primary Email',
] as const;

export interface HeaderMap {
  /** field name -> column index */
  index: Record<string, number>;
  /** required headers absent from the file, in REQUIRED_HEADERS order */
  missing: string[];
}

export function mapHeaders(headerRow: string[]): HeaderMap {
  const index: Record<string, number> = {};

  headerRow.forEach((raw, position) => {
    const field = HEADER_TO_FIELD[(raw ?? '').trim().toLowerCase()];
    // Unrecognized columns are ignored silently; first occurrence wins.
    if (field !== undefined && index[field] === undefined) {
      index[field] = position;
    }
  });

  const missing = REQUIRED_HEADERS.filter(
    (header) => index[HEADER_TO_FIELD[header.toLowerCase()]!] === undefined,
  );

  return { index, missing };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kit/members test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/features/members/src/server/column-map.ts packages/features/members/src/server/column-map.test.ts
git commit -m "feat(members): map extract headers by name rather than position"
```

---

### Task 4: The file reader and a synthetic fixture

**Files:**
- Create: `packages/features/members/src/server/roster-reader.ts`
- Create: `packages/features/members/test/fixtures/make-fixture.ts`
- Test: `packages/features/members/src/server/roster-reader.test.ts`

**Interfaces:**
- Produces: `readRoster(buffer: Buffer, filename: string): Promise<string[][]>` — returns the first sheet as rows of strings, header row included. Throws `RosterReadError` with a human-readable message on an unreadable file.

- [ ] **Step 1: Write the fixture generator**

`packages/features/members/test/fixtures/make-fixture.ts`. **The real extract is member PII and must never be committed.** This generates a synthetic file reproducing the edge cases the real one contains.

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ExcelJS from 'exceljs';

const HEADER = [
  'Membership Number','Prefix','First Name','Middle Name','Last Name','Suffix',
  'Fraternal - Bad Address','Primary Type','Address Line 1','Address Line 2',
  'City','State/Province','Postal Code','Country','Secondary Type',
  'Address Line 1 (Secondary)','Address Line 2 (Secondary)','City (Secondary)',
  'State/Province (Secondary)','Postal Code (Secondary)','Country (Secondary)',
  'Residence Phone','Business Phone','Cell Phone','Primary Email',
  'Secondary Email','Tertiary Email',
];

/** Each row exercises an edge case the real extract actually contains. */
const ROWS: string[][] = [
  // normal, fully populated
  ['1000001','Mr','John','Q','Smith','','','Member','1 Oak St','','Ashburn','VA','20147-3067','US','','','','','','','','703-555-0001','','7035550002','JOHN.SMITH@EXAMPLE.COM','',''],
  // uppercase email + ZIP+4 only, sparse everything else
  ['1000002','','Paul','','Abraham','','','Member','2 Elm St','','Ashburn','VA','20147','US','','','','','','','','','','','PABRAHAM@PJILAW.COM','',''],
  // NO EMAIL — cannot become an auth account, must be reported not dropped
  ['1000003','','Carl','','Krebs','','','Member','3 Pine St','','Ashburn','VA','20148','US','','','','','','','','7035550003','','','','',''],
  // bad-address flag set
  ['1000004','','Peter','','Nolan','Jr','X','Member','4 Ash St','','Sterling','VA','20164','US','','','','','','','','','','7035550004','peter@example.com','',''],
  // "Iii" as it appears in the source — case must survive untouched
  ['1000005','','Robert','','Vance','Iii','','Member','5 Birch St','Apt 2','Leesburg','VA','20176','US','','','','','','','','','7035550005','','robert@example.com','rv@alt.example.com',''],
  // secondary/seasonal address populated
  ['1000006','Dr','Luis','M','Ortiz','','','Member','6 Cedar St','','Ashburn','VA','20147','US','Seasonal','100 Beach Rd','','Naples','FL','34102','US','','','7035550006','luis@example.com','',''],
  // duplicate membership number of row 1 — must be skipped
  ['1000001','','Duplicate','','Number','','','Member','9 Dup St','','Ashburn','VA','20147','US','','','','','','','','','','','dup.number@example.com','',''],
  // duplicate email of row 4 — must be skipped
  ['1000007','','Duplicate','','Email','','','Member','10 Dup St','','Ashburn','VA','20147','US','','','','','','','','','','','peter@example.com','',''],
  // blank membership number — must be skipped
  ['','','Missing','','Number','','','Member','11 No St','','Ashburn','VA','20147','US','','','','','','','','','','','missing.number@example.com','',''],
  // malformed email — must be skipped
  ['1000008','','Bad','','Email','','','Member','12 Bad St','','Ashburn','VA','20147','US','','','','','','','','','','','not-an-email','',''],
  // non-US phone shape — stored unformatted rather than mangled
  ['1000009','','Ian','','Fraser','','','Member','13 Kew Rd','','London','','SW1A 1AA','GB','','','','','','','','+44 20 7946 0958','','','ian@example.co.uk','',''],
];

export function buildFixtureWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Contact Extract');

  sheet.addRow(HEADER);
  // An unrecognized extra column: must be ignored silently, not error.
  sheet.getRow(1).getCell(HEADER.length + 1).value = 'Council Notes';
  ROWS.forEach((row) => sheet.addRow(row));

  return wb;
}

if (process.argv[1]?.endsWith('make-fixture.ts')) {
  void buildFixtureWorkbook()
    .xlsx.writeBuffer()
    .then((buffer) => {
      const out = join(import.meta.dirname, 'roster-sample.xlsx');
      writeFileSync(out, Buffer.from(buffer));
      console.log(`wrote ${out}`);
    });
}
```

- [ ] **Step 2: Write the failing reader tests**

`packages/features/members/src/server/roster-reader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildFixtureWorkbook } from '../../test/fixtures/make-fixture';
import { readRoster, RosterReadError } from './roster-reader';

async function fixtureBuffer(): Promise<Buffer> {
  const buffer = await buildFixtureWorkbook().xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe('readRoster', () => {
  it('returns the header row first', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    expect(rows[0]?.[0]).toBe('Membership Number');
    expect(rows[0]?.[24]).toBe('Primary Email');
  });

  it('returns every data row', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    // 11 data rows in the fixture, plus the header.
    expect(rows).toHaveLength(12);
  });

  it('yields strings, not numbers, so a numeric member number keeps its shape', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    expect(typeof rows[1]?.[0]).toBe('string');
    expect(rows[1]?.[0]).toBe('1000001');
  });

  it('pads short rows so column indexes stay aligned', async () => {
    const rows = await readRoster(await fixtureBuffer(), 'roster.xlsx');

    for (const row of rows.slice(1)) {
      expect(row.length).toBeGreaterThanOrEqual(27);
    }
  });

  it('reads a .csv with the same contract', async () => {
    const csv = 'Membership Number,First Name,Last Name,Primary Email\n1,A,B,a@b.com\n';
    const rows = await readRoster(Buffer.from(csv), 'roster.csv');

    expect(rows[0]?.[0]).toBe('Membership Number');
    expect(rows[1]?.[3]).toBe('a@b.com');
  });

  it('rejects an unsupported extension by name', async () => {
    await expect(readRoster(Buffer.from('x'), 'roster.pdf')).rejects.toThrow(
      RosterReadError,
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @kit/members test:unit roster-reader`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the reader**

`packages/features/members/src/server/roster-reader.ts`:

```ts
import ExcelJS from 'exceljs';

export class RosterReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterReadError';
  }
}

/** Widest column index the extract uses, so short rows stay index-aligned. */
const MIN_COLUMNS = 27;

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '');
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  return String(value);
}

function padRow(row: string[]): string[] {
  while (row.length < MIN_COLUMNS) row.push('');
  return row;
}

/**
 * First sheet only, header row included. Every cell is returned as a string:
 * a membership number is an identifier, not a quantity, and letting Excel
 * hand back `1000001` as a number invites precision and formatting surprises.
 */
export async function readRoster(
  buffer: Buffer,
  filename: string,
): Promise<string[][]> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.csv')) {
    return buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => padRow(line.split(',').map((cell) => cell.trim())));
  }

  if (!lower.endsWith('.xlsx')) {
    throw new RosterReadError(
      `Unsupported file type. Upload the Officers Online export as .xlsx or .csv, not "${filename}".`,
    );
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new RosterReadError(
      'That file could not be read as a spreadsheet. Re-export it from Officers Online and try again.',
    );
  }

  const sheet = workbook.worksheets[0];

  if (!sheet) {
    throw new RosterReadError('That spreadsheet has no sheets.');
  }

  const rows: string[][] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    // ExcelJS row values are 1-based with a leading hole at index 0.
    for (let column = 1; column <= Math.max(sheet.columnCount, MIN_COLUMNS); column++) {
      values.push(cellToString(row.getCell(column).value));
    }
    rows.push(padRow(values));
  });

  return rows;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @kit/members test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members
git commit -m "feat(members): read .xlsx and .csv rosters with a synthetic fixture"
```

---

### Task 5: The parser — rows to records, with per-row errors

**Files:**
- Create: `packages/features/members/src/server/roster-parser.ts`
- Test: `packages/features/members/src/server/roster-parser.test.ts`

**Interfaces:**
- Consumes: `mapHeaders` (Task 3), `normalize*` (Task 2), `RosterRecord` (Task 2).
- Produces: `parseRoster(rows: string[][]): ParseResult` where
  `type ParseResult = { records: RosterRecord[]; missingHeaders: string[]; rowErrors: RowError[] }`
  and `type RowError = { sourceRow: number; reason: string }`.

- [ ] **Step 1: Write the failing tests**

`packages/features/members/src/server/roster-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildFixtureWorkbook } from '../../test/fixtures/make-fixture';
import { readRoster } from './roster-reader';
import { parseRoster } from './roster-parser';

async function parseFixture() {
  const buffer = Buffer.from(await buildFixtureWorkbook().xlsx.writeBuffer());
  return parseRoster(await readRoster(buffer, 'roster.xlsx'));
}

describe('parseRoster', () => {
  it('reports missing required headers and parses nothing', () => {
    const result = parseRoster([['First Name', 'Last Name']]);

    expect(result.missingHeaders).toEqual(['Membership Number', 'Primary Email']);
    expect(result.records).toEqual([]);
  });

  it('normalizes email case', async () => {
    const { records } = await parseFixture();
    const paul = records.find((r) => r.membershipNumber === '1000002');

    expect(paul?.primaryEmail).toBe('pabraham@pjilaw.com');
  });

  it('formats US phones and leaves other shapes alone', async () => {
    const { records } = await parseFixture();

    expect(records.find((r) => r.membershipNumber === '1000001')?.phoneCell)
      .toBe('(703) 555-0002');
    expect(records.find((r) => r.membershipNumber === '1000009')?.phoneResidence)
      .toBe('+44 20 7946 0958');
  });

  it('leaves name case untouched', async () => {
    const { records } = await parseFixture();

    expect(records.find((r) => r.membershipNumber === '1000005')?.suffix).toBe('Iii');
  });

  it('reads the bad-address flag', async () => {
    const { records } = await parseFixture();

    expect(records.find((r) => r.membershipNumber === '1000004')?.badAddress).toBe(true);
    expect(records.find((r) => r.membershipNumber === '1000001')?.badAddress).toBe(false);
  });

  it('collects the secondary address when present', async () => {
    const { records } = await parseFixture();
    const luis = records.find((r) => r.membershipNumber === '1000006');

    expect(luis?.secondaryAddress).toMatchObject({ city: 'Naples', state: 'FL' });
  });

  it('errors a blank membership number rather than importing it', async () => {
    const { rowErrors } = await parseFixture();

    expect(rowErrors.some((e) => e.reason === 'Cannot identify the member')).toBe(true);
  });

  it('errors a malformed email', async () => {
    const { rowErrors } = await parseFixture();

    expect(rowErrors.some((e) => e.reason.startsWith('No usable email address'))).toBe(true);
  });

  it('keeps the emailless member as an error, not a silent drop', async () => {
    const { records, rowErrors } = await parseFixture();

    expect(records.some((r) => r.membershipNumber === '1000003')).toBe(false);
    expect(rowErrors.some((e) => e.sourceRow === 4)).toBe(true);
  });

  it('records the source row number for every error', async () => {
    const { rowErrors } = await parseFixture();

    for (const error of rowErrors) {
      expect(error.sourceRow).toBeGreaterThan(1);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kit/members test:unit roster-parser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

`packages/features/members/src/server/roster-parser.ts`:

```ts
import type { RosterRecord } from '../types/roster';
import { mapHeaders } from './column-map';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from './normalize';

export interface RowError {
  sourceRow: number;
  reason: string;
}

export interface ParseResult {
  records: RosterRecord[];
  missingHeaders: string[];
  rowErrors: RowError[];
}

/**
 * Deliberately permissive: this matches what Supabase auth will accept rather
 * than trying to be a full RFC validator. A row this rejects could never
 * become an account, so rejecting it here is the same answer, earlier.
 */
function isUsableEmail(value: string | null): value is string {
  return value !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseRoster(rows: string[][]): ParseResult {
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    return { records: [], missingHeaders: [...['Membership Number','First Name','Last Name','Primary Email']], rowErrors: [] };
  }

  const { index, missing } = mapHeaders(headerRow);

  // A missing required header is fatal for the whole file. Returning early
  // means no preview is generated and nothing is written.
  if (missing.length > 0) {
    return { records: [], missingHeaders: missing, rowErrors: [] };
  }

  const records: RosterRecord[] = [];
  const rowErrors: RowError[] = [];

  dataRows.forEach((row, offset) => {
    // +2: one for the header row, one to make it 1-based like Excel shows.
    const sourceRow = offset + 2;
    const at = (field: string): string | undefined =>
      index[field] === undefined ? undefined : row[index[field]!];

    const membershipNumber = (at('membershipNumber') ?? '').trim();

    if (membershipNumber === '') {
      rowErrors.push({ sourceRow, reason: 'Cannot identify the member' });
      return;
    }

    const primaryEmail = normalizeEmail(at('primaryEmail'));

    if (!isUsableEmail(primaryEmail)) {
      rowErrors.push({
        sourceRow,
        reason: `No usable email address for member ${membershipNumber} — create this account manually`,
      });
      return;
    }

    const secondaryCity = normalizeName(at('secondaryCity'));
    const secondaryAddress =
      secondaryCity === null
        ? null
        : {
            line1: normalizeName(at('secondaryAddressLine1')) ?? '',
            city: secondaryCity,
            state: normalizeState(at('secondaryState')) ?? '',
            postalCode: normalizeZip(at('secondaryPostalCode')) ?? '',
            country: normalizeName(at('secondaryCountry')) ?? '',
          };

    records.push({
      membershipNumber,
      prefix: normalizeName(at('prefix')),
      firstName: normalizeName(at('firstName')) ?? '',
      middleName: normalizeName(at('middleName')),
      lastName: normalizeName(at('lastName')) ?? '',
      suffix: normalizeName(at('suffix')),
      primaryEmail,
      emailSecondary: normalizeEmail(at('secondaryEmail')),
      addressLine1: normalizeName(at('addressLine1')),
      addressLine2: normalizeName(at('addressLine2')),
      city: normalizeName(at('city')),
      state: normalizeState(at('state')),
      postalCode: normalizeZip(at('postalCode')),
      country: normalizeName(at('country')),
      primaryType: normalizeName(at('primaryType')),
      phoneCell: normalizePhone(at('cellPhone')),
      phoneResidence: normalizePhone(at('residencePhone')),
      phoneBusiness: normalizePhone(at('businessPhone')),
      secondaryAddress,
      badAddress: (at('badAddress') ?? '').trim().toUpperCase() === 'X',
      sourceRow,
    });
  });

  return { records, missingHeaders: [], rowErrors };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kit/members test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members/src/server/roster-parser.ts packages/features/members/src/server/roster-parser.test.ts
git commit -m "feat(members): parse roster rows into normalized records"
```

---

### Task 6: The planner — the three safety rules

This is the task where the WordPress build's two post-release defects live. The tests below encode them directly.

**Files:**
- Create: `packages/features/members/src/server/roster-plan.ts`
- Test: `packages/features/members/src/server/roster-plan.test.ts`

**Interfaces:**
- Consumes: `RosterRecord` (Task 2), `parseRoster` (Task 5).
- Produces:
  ```ts
  type PlanAction = 'create' | 'update' | 'nochange' | 'skip';
  interface ExistingMember {
    membershipNumber: string;
    primaryEmail: string | null;
    firstName: string | null;
    lastName: string | null;
    filledFields: string[]; // field names already holding a value
  }
  interface PlanRow {
    membershipNumber: string;
    displayName: string;
    action: PlanAction;
    reason?: string;
    conflicts: { field: string; incoming: string; stored: string }[];
    record?: RosterRecord;
  }
  interface ImportPlan {
    rows: PlanRow[];
    counts: Record<PlanAction, number>;
    absentFromFile: string[];
  }
  function buildPlan(
    records: RosterRecord[],
    existing: ExistingMember[],
  ): ImportPlan;
  ```

- [ ] **Step 1: Write the failing tests**

`packages/features/members/src/server/roster-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { RosterRecord } from '../types/roster';
import { buildPlan, type ExistingMember } from './roster-plan';

function record(overrides: Partial<RosterRecord> = {}): RosterRecord {
  return {
    membershipNumber: '1000001',
    prefix: null, firstName: 'John', middleName: null, lastName: 'Smith',
    suffix: null, primaryEmail: 'john@example.com', emailSecondary: null,
    addressLine1: '1 Oak St', addressLine2: null, city: 'Ashburn',
    state: 'VA', postalCode: '20147', country: 'US', primaryType: 'Member',
    phoneCell: '(703) 555-0002', phoneResidence: null, phoneBusiness: null,
    secondaryAddress: null, badAddress: false, sourceRow: 2,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingMember> = {}): ExistingMember {
  return {
    membershipNumber: '1000001',
    primaryEmail: 'john@example.com',
    firstName: 'John',
    lastName: 'Smith',
    filledFields: [],
    ...overrides,
  };
}

describe('buildPlan', () => {
  it('classifies an unknown member as create', () => {
    const plan = buildPlan([record()], []);

    expect(plan.rows[0]?.action).toBe('create');
    expect(plan.counts.create).toBe(1);
  });

  it('classifies a known member with blanks to fill as update', () => {
    const plan = buildPlan([record()], [existing({ filledFields: ['city'] })]);

    expect(plan.rows[0]?.action).toBe('update');
  });

  it('is a no-op when every incoming field is already filled', () => {
    // This is the property that makes a monthly re-import safe.
    const plan = buildPlan(
      [record()],
      [existing({
        filledFields: [
          'addressLine1','city','state','postalCode','country',
          'primaryType','phoneCell',
        ],
      })],
    );

    expect(plan.rows[0]?.action).toBe('nochange');
    expect(plan.counts.create).toBe(0);
  });

  it('skips a membership number that appears twice in the file', () => {
    const plan = buildPlan([record(), record({ sourceRow: 3 })], []);

    expect(plan.rows[1]?.action).toBe('skip');
    expect(plan.rows[1]?.reason).toBe('Duplicate row in file');
  });

  it('skips an email that appears twice in the file', () => {
    const plan = buildPlan(
      [record(), record({ membershipNumber: '1000002', sourceRow: 3 })],
      [],
    );

    expect(plan.rows[1]?.action).toBe('skip');
    expect(plan.rows[1]?.reason).toBe('Duplicate email in file');
  });

  it('skips an email that belongs to a different member number', () => {
    const plan = buildPlan(
      [record({ membershipNumber: '1000002' })],
      [existing({ membershipNumber: '1000001', primaryEmail: 'john@example.com' })],
    );

    expect(plan.rows[0]?.action).toBe('skip');
    expect(plan.rows[0]?.reason).toBe(
      'That email already belongs to member 1000001',
    );
  });

  // --- The two rules the WordPress build got wrong ---

  it('reports a changed email as a conflict and never auto-applies it', () => {
    const plan = buildPlan(
      [record({ primaryEmail: 'new.address@example.com' })],
      [existing({ primaryEmail: 'old.address@example.com', filledFields: ['addressLine1'] })],
    );

    const row = plan.rows[0]!;

    expect(row.action).not.toBe('skip');
    expect(row.conflicts).toContainEqual({
      field: 'primaryEmail',
      incoming: 'new.address@example.com',
      stored: 'old.address@example.com',
    });
  });

  it('never proposes writing a field that already holds a different value', () => {
    // Fill-blanks-only: a member's own correction must survive the import.
    const plan = buildPlan(
      [record({ city: 'Sterling' })],
      [existing({ filledFields: ['city'] })],
    );

    const row = plan.rows[0]!;

    expect(row.conflicts.some((c) => c.field === 'city')).toBe(true);
    expect(row.action).not.toBe('create');
  });

  it('emits no dues, level or expiry field anywhere in the plan', () => {
    // An import must never change dues state. If a future edit adds a dues
    // field to RosterRecord, this test fails and forces the conversation.
    const plan = buildPlan([record()], []);
    const serialized = JSON.stringify(plan).toLowerCase();

    for (const forbidden of ['dues', 'level', 'expiry', 'expires', 'paid_through']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('lists stored members absent from the file without proposing any change', () => {
    const plan = buildPlan(
      [record({ membershipNumber: '1000001' })],
      [existing({ membershipNumber: '1000001' }), existing({ membershipNumber: '2000002' })],
    );

    expect(plan.absentFromFile).toEqual(['2000002']);
    expect(plan.rows.some((r) => r.membershipNumber === '2000002')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kit/members test:unit roster-plan`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the planner**

`packages/features/members/src/server/roster-plan.ts`:

```ts
import type { RosterRecord } from '../types/roster';

export type PlanAction = 'create' | 'update' | 'nochange' | 'skip';

export interface ExistingMember {
  membershipNumber: string;
  primaryEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Field names that already hold a value, so must not be overwritten. */
  filledFields: string[];
}

export interface PlanConflict {
  field: string;
  incoming: string;
  stored: string;
}

export interface PlanRow {
  membershipNumber: string;
  displayName: string;
  action: PlanAction;
  reason?: string;
  conflicts: PlanConflict[];
  record?: RosterRecord;
}

export interface ImportPlan {
  rows: PlanRow[];
  counts: Record<PlanAction, number>;
  absentFromFile: string[];
}

/** Contact fields an import may fill. Deliberately contains no dues field. */
const FILLABLE: (keyof RosterRecord)[] = [
  'prefix','middleName','suffix','addressLine1','addressLine2','city','state',
  'postalCode','country','primaryType','phoneCell','phoneResidence',
  'phoneBusiness','emailSecondary','secondaryAddress',
];

/** Fields whose change is always a conflict for a human, never an auto-write. */
const NEVER_AUTO_UPDATED: (keyof RosterRecord)[] = [
  'primaryEmail','firstName','lastName',
];

export function buildPlan(
  records: RosterRecord[],
  existing: ExistingMember[],
): ImportPlan {
  const byNumber = new Map(existing.map((m) => [m.membershipNumber, m]));
  const byEmail = new Map(
    existing.filter((m) => m.primaryEmail).map((m) => [m.primaryEmail!, m]),
  );

  const seenNumbers = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: PlanRow[] = [];

  for (const record of records) {
    const displayName = `${record.firstName} ${record.lastName}`.trim();
    const base = { membershipNumber: record.membershipNumber, displayName };

    if (seenNumbers.has(record.membershipNumber)) {
      rows.push({ ...base, action: 'skip', reason: 'Duplicate row in file', conflicts: [] });
      continue;
    }
    seenNumbers.add(record.membershipNumber);

    if (record.primaryEmail !== null) {
      if (seenEmails.has(record.primaryEmail)) {
        rows.push({ ...base, action: 'skip', reason: 'Duplicate email in file', conflicts: [] });
        continue;
      }
      seenEmails.add(record.primaryEmail);
    }

    const match = byNumber.get(record.membershipNumber);

    // An email belonging to a *different* member is a collision a human must
    // resolve: silently attaching it would merge two people.
    if (!match && record.primaryEmail) {
      const emailOwner = byEmail.get(record.primaryEmail);

      if (emailOwner && emailOwner.membershipNumber !== record.membershipNumber) {
        rows.push({
          ...base,
          action: 'skip',
          reason: `That email already belongs to member ${emailOwner.membershipNumber}`,
          conflicts: [],
        });
        continue;
      }
    }

    if (!match) {
      rows.push({ ...base, action: 'create', conflicts: [], record });
      continue;
    }

    const conflicts: PlanConflict[] = [];

    for (const field of NEVER_AUTO_UPDATED) {
      const incoming = record[field];
      const stored =
        field === 'primaryEmail' ? match.primaryEmail
        : field === 'firstName' ? match.firstName
        : match.lastName;

      if (typeof incoming === 'string' && stored && incoming !== stored) {
        conflicts.push({ field, incoming, stored });
      }
    }

    const filled = new Set(match.filledFields);
    let hasSomethingToFill = false;

    for (const field of FILLABLE) {
      const incoming = record[field];
      if (incoming === null || incoming === undefined || incoming === '') continue;

      if (filled.has(field)) {
        // Fill blanks only: something is already stored, so nothing is written.
        // Reported so the officer can reconcile it deliberately.
        conflicts.push({
          field,
          incoming: typeof incoming === 'string' ? incoming : JSON.stringify(incoming),
          stored: '(already set)',
        });
        continue;
      }

      hasSomethingToFill = true;
    }

    rows.push({
      ...base,
      action: hasSomethingToFill ? 'update' : 'nochange',
      conflicts,
      record,
    });
  }

  const inFile = new Set(records.map((r) => r.membershipNumber));
  const absentFromFile = existing
    .map((m) => m.membershipNumber)
    .filter((number) => !inFile.has(number));

  const counts: Record<PlanAction, number> = {
    create: 0, update: 0, nochange: 0, skip: 0,
  };
  for (const row of rows) counts[row.action]++;

  return { rows, counts, absentFromFile };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kit/members test:unit`
Expected: PASS, all 12 planner tests.

- [ ] **Step 5: Commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members/src/server/roster-plan.ts packages/features/members/src/server/roster-plan.test.ts
git commit -m "feat(members): plan imports with fill-blanks-only and no dues writes"
```

---

### Task 7: Services — read members, apply a chunk

**Files:**
- Create: `packages/features/members/src/server/members.service.ts`
- Create: `packages/features/members/src/server/roster-import.service.ts`

**Interfaces:**
- Consumes: `members_list`, `member_upsert_from_roster`, `members_absent_from` (Task 1); `ImportPlan`, `PlanRow` (Task 6).
- Produces:
  ```ts
  class MembersService {
    constructor(client: SupabaseClient<Database>);
    list(search: string | null, limit: number, offset: number): Promise<MemberListRow[]>;
    existingForPlanning(): Promise<ExistingMember[]>;
  }
  class RosterImportService {
    constructor(client: SupabaseClient<Database>);
    applyChunk(rows: PlanRow[], sourceFile: string): Promise<ChunkResult>;
  }
  type ChunkResult = { applied: number; failures: { membershipNumber: string; error: string }[] };
  ```

- [ ] **Step 1: Implement `members.service.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { ExistingMember } from './roster-plan';

export interface MemberListRow {
  id: string;
  membershipNumber: string;
  userId: string | null;
  fullName: string;
  primaryEmail: string | null;
  city: string | null;
  state: string | null;
  badAddress: boolean;
  rosterLastSeenAt: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  phone: string | null;
}

export class MembersService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Reads go through the `members_list` RPC rather than the table, because the
   * encrypted columns are only readable inside that security definer function
   * — the app never holds the key.
   */
  async list(search: string | null, limit = 50, offset = 0): Promise<MemberListRow[]> {
    const { data, error } = await this.client.rpc('members_list', {
      p_search: search,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      membershipNumber: row.membership_number,
      userId: row.user_id,
      fullName: row.full_name,
      primaryEmail: row.primary_email,
      city: row.city,
      state: row.state,
      badAddress: row.bad_address,
      rosterLastSeenAt: row.roster_last_seen_at,
      addressLine1: row.address_line1,
      postalCode: row.postal_code,
      phone: row.phone,
    }));
  }

  /**
   * The planner needs to know which fields already hold a value so it can
   * honour fill-blanks-only. Encrypted columns are reported as filled/empty
   * without being decrypted — `is not null` needs no key.
   */
  async existingForPlanning(): Promise<ExistingMember[]> {
    const { data, error } = await this.client
      .from('members')
      .select(
        'membership_number, primary_email, first_name, last_name, prefix, middle_name, suffix, city, state, country, primary_type, address_line1_enc, address_line2_enc, postal_code_enc, phone_cell_enc, phone_residence_enc, phone_business_enc, email_secondary_enc, secondary_address_enc',
      );

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => {
      const filledFields: string[] = [];
      const mark = (field: string, value: unknown) => {
        if (value !== null && value !== undefined && value !== '') filledFields.push(field);
      };

      mark('prefix', row.prefix);
      mark('middleName', row.middle_name);
      mark('suffix', row.suffix);
      mark('city', row.city);
      mark('state', row.state);
      mark('country', row.country);
      mark('primaryType', row.primary_type);
      mark('addressLine1', row.address_line1_enc);
      mark('addressLine2', row.address_line2_enc);
      mark('postalCode', row.postal_code_enc);
      mark('phoneCell', row.phone_cell_enc);
      mark('phoneResidence', row.phone_residence_enc);
      mark('phoneBusiness', row.phone_business_enc);
      mark('emailSecondary', row.email_secondary_enc);
      mark('secondaryAddress', row.secondary_address_enc);

      return {
        membershipNumber: row.membership_number,
        primaryEmail: row.primary_email,
        firstName: row.first_name,
        lastName: row.last_name,
        filledFields,
      };
    });
  }
}
```

- [ ] **Step 2: Implement `roster-import.service.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { PlanRow } from './roster-plan';

export interface ChunkResult {
  applied: number;
  failures: { membershipNumber: string; error: string }[];
}

/** Supabase auth rate-limits account creation; back off rather than hammer. */
const RETRY_DELAYS_MS = [250, 1_000, 3_000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RosterImportService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Applies one chunk. A row that fails is collected rather than thrown, so
   * one bad row cannot cost the rest of the chunk — and because the plan is
   * persisted, re-running processes what did not land and no-ops on what did.
   */
  async applyChunk(rows: PlanRow[], sourceFile: string): Promise<ChunkResult> {
    const failures: ChunkResult['failures'] = [];
    let applied = 0;

    for (const row of rows) {
      if (row.action === 'skip' || row.action === 'nochange' || !row.record) continue;

      try {
        const userId =
          row.action === 'create' && row.record.primaryEmail
            ? await this.ensureAuthUser(row.record.primaryEmail)
            : null;

        const { error } = await this.client.rpc('member_upsert_from_roster', {
          p: { ...this.toPayload(row), user_id: userId, source_file: sourceFile },
        });

        if (error) throw new Error(error.message);

        applied++;
      } catch (cause) {
        failures.push({
          membershipNumber: row.membershipNumber,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    return { applied, failures };
  }

  /**
   * `createUser` sends no email, unlike `inviteUserByEmail`. Accounts are
   * created silently on purpose: deciding to email hundreds of members is a
   * separate, explicit action.
   */
  private async ensureAuthUser(email: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await this.client.auth.admin.createUser({
        email,
        email_confirm: false,
      });

      if (!error) return data.user?.id ?? null;

      // Already registered: find and reuse rather than fail the row.
      if (/already (been )?registered|already exists/i.test(error.message)) {
        return null;
      }

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new Error(error.message);
      await sleep(delay);
    }
  }

  private toPayload(row: PlanRow) {
    const r = row.record!;
    return {
      membership_number: r.membershipNumber,
      prefix: r.prefix,
      first_name: r.firstName,
      middle_name: r.middleName,
      last_name: r.lastName,
      suffix: r.suffix,
      primary_email: r.primaryEmail,
      city: r.city,
      state: r.state,
      country: r.country,
      primary_type: r.primaryType,
      bad_address: r.badAddress,
      address_line1: r.addressLine1,
      address_line2: r.addressLine2,
      postal_code: r.postalCode,
      phone_cell: r.phoneCell,
      phone_residence: r.phoneResidence,
      phone_business: r.phoneBusiness,
      email_secondary: r.emailSecondary,
      secondary_address: r.secondaryAddress
        ? JSON.stringify(r.secondaryAddress)
        : null,
    };
  }
}
```

- [ ] **Step 3: Typecheck, lint, commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members/src/server/members.service.ts packages/features/members/src/server/roster-import.service.ts
git commit -m "feat(members): add member read and chunked import services"
```

---

### Task 8: Server actions

**Files:**
- Create: `packages/features/members/src/server/roster-actions.ts`
- Modify: `apps/web/next.config.mjs`

**Interfaces:**
- Consumes: everything from Tasks 5–7.
- Produces: `previewRosterAction(formData: FormData)` → `PreviewResult`; `applyRosterChunkAction({ importId, offset, size })` → `ApplyResult`. Both return errors as values.

- [ ] **Step 1: Raise the server action body limit**

In `apps/web/next.config.mjs`, inside the existing `config` object add:

```js
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
```

If an `experimental` key already exists, merge into it rather than adding a second.

- [ ] **Step 2: Implement the actions**

`packages/features/members/src/server/roster-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { MembersService } from './members.service';
import { buildPlan } from './roster-plan';
import { parseRoster } from './roster-parser';
import { readRoster, RosterReadError } from './roster-reader';
import { RosterImportService } from './roster-import.service';

/**
 * Next.js redacts thrown Server Action error messages in production builds, so
 * every expected failure here is RETURNED. A parse error the officer cannot
 * read is the same as no error message at all.
 */
export type PreviewResult =
  | { success: true; importId: string; plan: unknown }
  | { success: false; error: string };

export type ApplyResult =
  | { success: true; applied: number; failures: unknown[]; done: boolean }
  | { success: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5_000;
const CHUNK_SIZE = 25;

async function requireManage(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'members', 'manage')) return null;

  return client;
}

export const previewRosterAction = enhanceAction(
  async (formData: FormData, user): Promise<PreviewResult> => {
    const client = await requireManage(user.id);

    if (!client) {
      return { success: false, error: 'You do not have permission to import the roster.' };
    }

    const file = formData.get('file');

    if (!(file instanceof File)) {
      return { success: false, error: 'Choose a roster file to upload.' };
    }

    if (file.size > MAX_BYTES) {
      return { success: false, error: 'That file is larger than 5 MB.' };
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let rows: string[][];

    try {
      rows = await readRoster(buffer, file.name);
    } catch (cause) {
      return {
        success: false,
        error: cause instanceof RosterReadError ? cause.message : 'That file could not be read.',
      };
    }

    if (rows.length - 1 > MAX_ROWS) {
      return { success: false, error: `That file has more than ${MAX_ROWS} rows.` };
    }

    const parsed = parseRoster(rows);

    // A missing required header is fatal, and is reported before any preview
    // is generated and before anything is written.
    if (parsed.missingHeaders.length > 0) {
      return {
        success: false,
        error: `That export is missing required columns: ${parsed.missingHeaders.join(', ')}.`,
      };
    }

    const existing = await new MembersService(client).existingForPlanning();
    const plan = buildPlan(parsed.records, existing);

    const { data, error } = await client
      .from('roster_imports')
      .insert({
        uploaded_by: user.id,
        filename: file.name,
        status: 'previewed',
        plan: { ...plan, rowErrors: parsed.rowErrors } as never,
      })
      .select('id')
      .single();

    if (error) return { success: false, error: error.message };

    return { success: true, importId: data.id, plan: { ...plan, rowErrors: parsed.rowErrors } };
  },
  {},
);

export const applyRosterChunkAction = enhanceAction(
  async (
    input: { importId: string; offset: number },
    user,
  ): Promise<ApplyResult> => {
    // Re-checked on every chunk, never trusted from the upload.
    const client = await requireManage(user.id);

    if (!client) {
      return { success: false, error: 'You do not have permission to import the roster.' };
    }

    const { data: record, error: loadError } = await client
      .from('roster_imports')
      .select('id, filename, plan')
      .eq('id', input.importId)
      .single();

    if (loadError) return { success: false, error: loadError.message };

    const plan = record.plan as { rows: never[] };
    const chunk = plan.rows.slice(input.offset, input.offset + CHUNK_SIZE);
    const result = await new RosterImportService(client).applyChunk(chunk, record.filename);
    const done = input.offset + CHUNK_SIZE >= plan.rows.length;

    if (done) {
      await client
        .from('roster_imports')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', input.importId);

      revalidatePath('/home/members');
    }

    return { success: true, applied: result.applied, failures: result.failures, done };
  },
  {},
);
```

- [ ] **Step 3: Typecheck, lint, commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members/src/server/roster-actions.ts apps/web/next.config.mjs
git commit -m "feat(members): add roster preview and chunked apply actions"
```

---

### Task 9: The import UI

**Files:**
- Create: `packages/features/members/src/components/roster-import-form.tsx`
- Create: `packages/features/members/src/components/roster-import-preview.tsx`
- Create: `apps/web/app/home/members/import/page.tsx`

**Interfaces:**
- Consumes: `previewRosterAction`, `applyRosterChunkAction` (Task 8).

- [ ] **Step 1: Build the upload form**

`roster-import-form.tsx` is a client component. It renders a file input accepting `.xlsx,.csv`, a submit button with `data-test="roster-upload"`, and calls `previewRosterAction` inside `useTransition`. On `success: false` it shows `result.error` via `toast.error`. On success it hands the plan to the preview component. Use `@kit/ui/card`, `@kit/ui/button`, `@kit/ui/input`. Semantic colours only.

- [ ] **Step 2: Build the preview and apply loop**

`roster-import-preview.tsx` renders, from the returned plan:

- counts by action (create / update / nochange / skip)
- a table of every skip with its reason
- a table of every conflict (member, field, incoming, stored)
- the `rowErrors` list from the parser
- the `absentFromFile` list under the heading "On the roster but not in this file — no action taken"
- a confirm button with `data-test="roster-confirm"`

On confirm it loops `applyRosterChunkAction({ importId, offset })`, advancing `offset` by 25 until `done`, showing progress as `applied / total`. Failures accumulate into a list rendered when the loop ends.

- [ ] **Step 3: Add the route**

`apps/web/app/home/members/import/page.tsx`:

```tsx
import { PageBody } from '@kit/ui/page';

import { RosterImportForm } from '@kit/members/components/roster-import-form';
import { requirePermission } from '~/lib/server/require-permission';

/**
 * Per-user by construction: the guard below can redirect, so there is no shell
 * worth prerendering ahead of knowing who is asking. See app/home/layout.tsx.
 */
export const instant = false;

async function RosterImportPage() {
  await requirePermission('members', 'manage');

  return (
    <PageBody>
      <RosterImportForm />
    </PageBody>
  );
}

export default RosterImportPage;
```

- [ ] **Step 4: Verify in a browser**

Start the dev server, sign in as a user holding `members.manage`, upload the generated fixture, and confirm: the preview lists 2 skips for duplicates, 1 for the blank number, 1 for the malformed email, and 1 row error for the emailless member — and that **nothing is written until confirm is pressed** (check `select count(*) from members` before and after).

- [ ] **Step 5: Commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members/src/components apps/web/app/home/members
git commit -m "feat(members): add the roster import wizard"
```

---

### Task 10: The members list, and end-to-end coverage

**Files:**
- Create: `packages/features/members/src/components/members-list.tsx`
- Create: `apps/web/app/home/members/page.tsx`
- Create: `apps/e2e/tests/members/members.spec.ts`

- [ ] **Step 1: Build the list**

`members-list.tsx` renders columns Name, Member #, Email, Phone, City, Last seen, Account. A search input filters via `MembersService.list(search)`. Flags: a badge when `badAddress`, and a "no account" badge when `userId` is null. 50 per page. A CSV export button posts to a server action that re-checks `members.view` and returns the current filtered set.

- [ ] **Step 2: Add the route**

`apps/web/app/home/members/page.tsx` guards with `requirePermission('members', 'view')`, declares `export const instant = false` with the same comment as Task 9, and renders `<MembersList />` inside `<PageBody>`.

- [ ] **Step 3: Write the e2e spec**

`apps/e2e/tests/members/members.spec.ts` must cover:

1. A user **without** `members.view` visiting `/home/members` is redirected to `/home`.
2. A user without `members.manage` visiting `/home/members/import` is redirected.
3. An authorised user uploads the fixture, sees the preview, and **the members count in the database is unchanged** at that point.
4. After confirming, the expected members exist.
5. **Re-uploading the same file yields a plan whose `create` count is 0** — the idempotency property.

Read `apps/e2e/tests/rbac/rbac.spec.ts` first for conventions. Note this repo uses `data-test`, not Playwright's default `data-testid`.

- [ ] **Step 4: Run everything**

```bash
pnpm --filter @kit/members test:unit
pnpm --filter web test:unit
cd apps/web && supabase start
cd ../e2e && pnpm exec playwright test tests/members --reporter=line --workers=1
```

Docker, Supabase and Playwright commands need `dangerouslyDisableSandbox: true` — the sandbox blocks the Docker socket.

- [ ] **Step 5: Commit**

```bash
pnpm run typecheck && pnpm run lint
git add packages/features/members apps/web/app/home/members apps/e2e/tests/members
git commit -m "feat(members): add the members list and end-to-end coverage"
```

---

## Self-Review

**Spec coverage.** Problem/shape → Task 4's fixture reproduces every documented edge case. Encryption split → Task 1. RBAC `members` section → Task 1. Column mapping and normalization → Tasks 2–3. Matching, skips, conflicts and the three safety rules → Task 6, each with a named test. Import flow's seven steps → Tasks 7–9. Members list → Task 10. Idempotency → Task 6 (`nochange`) and Task 10 step 3.5. Testing section → Tasks 2–6 unit, Task 10 e2e. Auth rate limits → `RETRY_DELAYS_MS` in Task 7.

**Deliberate gap:** the spec's "decrypt only the rendered page, not the whole table" is satisfied by `members_list`'s `limit`/`offset`, but nothing asserts it. A reviewer should confirm the list never calls `list()` without a limit.

**Known risk carried from the spec:** the first real run of ~372 account creations may need `RETRY_DELAYS_MS` or `CHUNK_SIZE` tuned. This is expected, not a defect.

**Type consistency:** `ExistingMember.filledFields` uses the camelCase `RosterRecord` field names, and `buildPlan`'s `FILLABLE` list is drawn from the same names — `MembersService.existingForPlanning` must emit exactly those strings. Verified against Task 6's `FILLABLE` array.
