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
