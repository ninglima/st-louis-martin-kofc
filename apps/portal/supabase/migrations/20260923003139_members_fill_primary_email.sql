-- The planner now plans an `update` that fills a BLANK stored email, but the
-- conflict path below had no `primary_email` assignment at all, so that fill
-- could never land: the row was re-planned as `update` every single month and
-- the member never acquired an address. Same shape as the bad-address defect --
-- a decision the planner makes that the writer silently drops on the floor.
--
-- `coalesce` writes only over NULL, so rule 3 is preserved exactly: a member
-- who HAS an address still never has it changed by an import, and a changed
-- address is still surfaced as a conflict for a human. Only the blank case
-- moves, and only in one direction. `primary_email` is nullable and carries no
-- unique constraint or index (verified against the live schema), so this can
-- neither overwrite a stored address nor raise on a collision -- the planner's
-- `owned-by-another-member` check is what keeps two members off one address.
--
-- 20260922221437_members_fixes.sql is already applied, so the function is
-- restated here rather than edited in place. Everything else below is verbatim
-- from that migration.
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
    -- first/last name are NOT updated here. A change to either is surfaced as
    -- a conflict for a human, never auto-applied.
    --
    -- primary_email is fill-blanks-only like the rest: NEVER overwritten, but
    -- filled when the council holds nothing. Without this line a member with
    -- no stored address could never be given one by an import, and the row
    -- re-planned as `update` every month without ever converging.
    primary_email       = coalesce(m.primary_email, excluded.primary_email),
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

-- `create or replace function` preserves the existing ACL, but the grant is
-- restated so the function's callability does not depend on that detail.
grant execute on function public.member_upsert_from_roster(jsonb) to authenticated;
