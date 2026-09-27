-- Review round 1 fixes for 20260922215412_members.sql. That migration is
-- already applied, so it is corrected here rather than edited in place.

-- F3: the extract carries the literal `X` for "Fraternal - Bad Address", and a
-- payload that omits the column must leave the stored flag alone. NULL means
-- "the payload said nothing"; the caller decides what that implies.
create or replace function kit.roster_bad_address(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when p_value is null then null
           when btrim(p_value) = '' then null
           when upper(btrim(p_value)) in ('X', 'Y', 'YES', 'T', 'TRUE', '1') then true
           else false
         end
$$;

revoke all on function kit.roster_bad_address(text) from public, anon, authenticated;

-- Reads. F2: an encrypted empty string is not NULL, so it would win the phone
-- coalesce and hide a member's real residence number. F8: p_limit is capped so
-- one call cannot decrypt the whole table.
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
         nullif(extensions.pgp_sym_decrypt(m.address_line1_enc, kit.members_pii_key()), ''),
         nullif(extensions.pgp_sym_decrypt(m.postal_code_enc,   kit.members_pii_key()), ''),
         coalesce(
           nullif(extensions.pgp_sym_decrypt(m.phone_cell_enc,      kit.members_pii_key()), ''),
           nullif(extensions.pgp_sym_decrypt(m.phone_residence_enc, kit.members_pii_key()), ''),
           nullif(extensions.pgp_sym_decrypt(m.phone_business_enc,  kit.members_pii_key()), '')
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
  limit least(greatest(p_limit, 0), 200) offset greatest(p_offset, 0)
$$;

-- Writes. Still deliberately has no parameter for any dues, level, expiry or
-- paid-through field: an import cannot change dues state even by mistake.
-- F2: every incoming value is normalized with nullif(..., '') before it is
-- stored or encrypted. pgp_sym_encrypt('') returns a non-NULL ciphertext, so
-- an empty cell would otherwise occupy the column forever and fill-blanks-only
-- could never fill it again.
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
    nullif(p->>'membership_number', ''), nullif(p->>'user_id', '')::uuid,
    nullif(p->>'prefix', ''), nullif(p->>'first_name', ''),
    nullif(p->>'middle_name', ''), nullif(p->>'last_name', ''),
    nullif(p->>'suffix', ''), nullif(p->>'primary_email', ''),
    nullif(p->>'city', ''), nullif(p->>'state', ''), nullif(p->>'country', ''),
    nullif(p->>'primary_type', ''),
    coalesce(kit.roster_bad_address(p->>'bad_address'), false),
    extensions.pgp_sym_encrypt(nullif(p->>'address_line1', ''),     v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'address_line2', ''),     v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'postal_code', ''),       v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'phone_cell', ''),        v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'phone_residence', ''),   v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'phone_business', ''),    v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'email_secondary', ''),   v_key),
    extensions.pgp_sym_encrypt(nullif(p->>'secondary_address', ''), v_key),
    now(), nullif(p->>'source_file', '')
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
    --
    -- bad_address is the one field Supreme owns outright, so a stated value
    -- wins. F3: a payload that says nothing leaves the stored flag alone
    -- instead of silently clearing it.
    bad_address         = case
                            when kit.roster_bad_address(p->>'bad_address') is null
                              then m.bad_address
                            else excluded.bad_address
                          end,
    roster_last_seen_at = now(),
    roster_source_file  = excluded.roster_source_file,
    updated_at          = now()
  returning m.id into v_id;

  return v_id;
end $$;

-- F6b: the plan held every member's PII as plaintext jsonb, so a stolen dump
-- gave up the whole roster in the clear -- exactly what the *_enc columns on
-- public.members exist to prevent. Both payloads now carry the same encryption
-- as the member columns and are reachable only through the accessors below.
alter table public.roster_imports add column if not exists plan_enc    bytea;
alter table public.roster_imports add column if not exists results_enc bytea;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roster_imports'
      and column_name = 'plan'
  ) then
    update public.roster_imports
       set plan_enc = extensions.pgp_sym_encrypt(plan::text, kit.members_pii_key())
     where plan is not null and plan_enc is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roster_imports'
      and column_name = 'results'
  ) then
    update public.roster_imports
       set results_enc = extensions.pgp_sym_encrypt(results::text, kit.members_pii_key())
     where results is not null and results_enc is null;
  end if;
end $$;

alter table public.roster_imports drop column if exists plan;
alter table public.roster_imports drop column if exists results;

comment on column public.roster_imports.plan_enc is
  'pgcrypto-encrypted import plan. Read it with roster_import_load_plan(), never by selecting this column. Nullable because the row is created first and the plan saved into it.';

comment on column public.roster_imports.results_enc is
  'pgcrypto-encrypted per-row results. Read it with roster_import_load_results().';

create or replace function public.roster_import_save_plan(p_import uuid, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not kit.has_permission('members', 'manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.roster_imports
     set plan_enc = extensions.pgp_sym_encrypt(p_plan::text, kit.members_pii_key())
   where id = p_import;

  if not found then
    raise exception 'roster_import_not_found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.roster_import_save_results(p_import uuid, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not kit.has_permission('members', 'manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.roster_imports
     set results_enc = extensions.pgp_sym_encrypt(p_results::text, kit.members_pii_key())
   where id = p_import;

  if not found then
    raise exception 'roster_import_not_found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.roster_import_load_plan(p_import uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select extensions.pgp_sym_decrypt(ri.plan_enc, kit.members_pii_key())::jsonb
  from public.roster_imports ri
  where ri.id = p_import
    and ri.plan_enc is not null
    and kit.has_permission('members', 'manage')
$$;

create or replace function public.roster_import_load_results(p_import uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select extensions.pgp_sym_decrypt(ri.results_enc, kit.members_pii_key())::jsonb
  from public.roster_imports ri
  where ri.id = p_import
    and ri.results_enc is not null
    and kit.has_permission('members', 'manage')
$$;

-- F1: the project default (20241219010757_schema.sql) revokes execute on
-- public functions, so neither RPC was callable by `authenticated` -- the only
-- role that can satisfy the auth.uid()-based gate inside them. service_role is
-- deliberately left off: it holds the default execute grant but always fails
-- the internal check, which is the behaviour we want.
grant execute on function public.members_list(text, int, int)            to authenticated;
grant execute on function public.member_upsert_from_roster(jsonb)        to authenticated;
grant execute on function public.roster_import_save_plan(uuid, jsonb)    to authenticated;
grant execute on function public.roster_import_save_results(uuid, jsonb) to authenticated;
grant execute on function public.roster_import_load_plan(uuid)           to authenticated;
grant execute on function public.roster_import_load_results(uuid)        to authenticated;

-- F6a: Supabase's default ACL for schema public leaves anon and authenticated
-- holding full DML on both tables. RLS makes that inert today, but one future
-- `grant usage on schema public to anon` would make it live. Same shape as
-- 20260922033217_rbac.sql. public.members gets no write grant at all: the only
-- write path is member_upsert_from_roster, which runs as the owner.
revoke all on public.members, public.roster_imports from anon, authenticated, service_role;
grant select on public.members to authenticated, service_role;
grant select, insert, update, delete on public.roster_imports to authenticated;
grant all on public.roster_imports to service_role;

-- F5: the Administrator seed in 20260922033217_rbac.sql is an explicit section
-- list that predates this section, so no role held members.view or
-- members.manage and the feature was invisible to everyone. The `member` role
-- is deliberately not granted: a member-visible directory is a separate
-- consent decision.
insert into public.role_permissions (role_id, section, can_view, can_manage)
select r.id, 'members', true, true
from public.roles r
where r.slug = 'administrator'
on conflict (role_id, section) do nothing;
