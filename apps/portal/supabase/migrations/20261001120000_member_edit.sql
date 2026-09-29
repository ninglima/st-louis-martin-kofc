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
