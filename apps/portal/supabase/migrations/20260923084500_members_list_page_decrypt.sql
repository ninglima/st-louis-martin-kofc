-- Review round 3 fixes for the members list. 20260922221437_members_fixes.sql
-- is already applied, so members_list is restated here rather than edited.
--
-- Two changes, both to that one function.
--
-- B-1. DECRYPT A PAGE, NOT A TABLE.
--
-- The spec says the encryption split exists "so the members list can search
-- name / member number / email and filter by city ... without decrypting all
-- 372 rows per query", and that phone "is decrypted per rendered page (50
-- rows), not across the whole table". The previous body put the five
-- pgp_sym_decrypt calls in the SELECT list of a query that also carried the
-- ORDER BY, the LIMIT and the OFFSET. What Postgres does with that is a
-- PLANNER DECISION, not a property of the SQL: on PostgreSQL 17 it happens to
-- project the decrypts in a Result node above the Sort, so `limit 50 offset 0`
-- really does decrypt 50 rows -- but `limit 200 offset 4800` decrypts 5,000,
-- because OFFSET discards its rows ABOVE that projection. Measured on 5,028
-- rows: limit 50 offset 0 = 10 ms, limit 200 offset 0 = 41 ms, limit 200
-- offset 4800 = 1,007 ms. The CSV export walks the roster 200 at a time, so
-- its cost was quadratic in the size of the council.
--
-- The fix makes it structural instead of incidental. Filtering, ordering,
-- limiting and offsetting happen in an inner subquery over plaintext columns
-- only, carrying the ciphertext through untouched; the decryption happens in
-- the outer query, over the rows that survived. Postgres never pulls up a
-- subquery that carries LIMIT or OFFSET and never pushes a projection below
-- one, so "exactly p_limit rows are decrypted" stops depending on which plan
-- the planner liked today. (A plain CTE would NOT do this: since PostgreSQL 12
-- a non-recursive CTE referenced once is inlined, so it is no longer the
-- optimisation fence it used to be.)
--
-- The search predicate still touches plaintext columns only -- an encrypted
-- column cannot be searched without decrypting every row, which is the whole
-- reason the split exists.
--
-- B-3. THE TWO FILTERS THE SPEC ASKS FOR.
--
-- `p_city` and `p_has_account`, both plaintext, both inside the inner query so
-- they narrow the set BEFORE anything is decrypted. Null means "no filter", so
-- an existing three-argument call behaves exactly as it did.
--
-- The 200-row ceiling, the kit.has_permission('members','view') gate and the
-- returned column list are unchanged.

-- `create or replace` cannot add parameters: a function's identity is its
-- argument types, so the five-argument version would be a second overload and
-- every three-argument call would become ambiguous. The old signature is
-- dropped first, which also drops its grant -- re-issued at the bottom.
drop function if exists public.members_list(text, int, int);

create or replace function public.members_list(
    p_search      text    default null,
    p_limit       int     default 50,
    p_offset      int     default 0,
    p_city        text    default null,
    p_has_account boolean default null
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
  select page.id,
         page.membership_number,
         page.user_id,
         page.full_name,
         page.primary_email,
         page.city,
         page.state,
         page.bad_address,
         page.roster_last_seen_at,
         -- Only these rows reach here: at most p_limit of them, and never the
         -- p_offset rows the caller already paged past.
         nullif(extensions.pgp_sym_decrypt(page.address_line1_enc, kit.members_pii_key()), ''),
         nullif(extensions.pgp_sym_decrypt(page.postal_code_enc,   kit.members_pii_key()), ''),
         -- F2 (20260922221437): an encrypted empty string is not NULL, so
         -- without the nullif it would win this coalesce and hide a member's
         -- real residence number.
         coalesce(
           nullif(extensions.pgp_sym_decrypt(page.phone_cell_enc,      kit.members_pii_key()), ''),
           nullif(extensions.pgp_sym_decrypt(page.phone_residence_enc, kit.members_pii_key()), ''),
           nullif(extensions.pgp_sym_decrypt(page.phone_business_enc,  kit.members_pii_key()), '')
         )
  from (
    select m.id, m.membership_number, m.user_id,
           trim(concat_ws(' ', m.prefix, m.first_name, m.middle_name, m.last_name, m.suffix)) as full_name,
           m.primary_email, m.city, m.state, m.bad_address, m.roster_last_seen_at,
           m.last_name, m.first_name,
           m.address_line1_enc, m.postal_code_enc,
           m.phone_cell_enc, m.phone_residence_enc, m.phone_business_enc
    from public.members m
    where kit.has_permission('members', 'view')
      and (
        p_search is null or p_search = ''
        or m.membership_number ilike '%' || p_search || '%'
        or m.primary_email     ilike '%' || p_search || '%'
        or m.first_name        ilike '%' || p_search || '%'
        or m.last_name         ilike '%' || p_search || '%'
      )
      -- Exact rather than ilike: the values come from members_cities() below,
      -- which reads this same column, so there is nothing to fuzzy-match.
      and (p_city is null or p_city = '' or m.city = p_city)
      -- "Has a way to sign in". Null is the third state and means no filter;
      -- `= p_has_account` on a boolean expression keeps the two cases one rule.
      and (p_has_account is null or (m.user_id is not null) = p_has_account)
    order by m.last_name, m.first_name
    limit least(greatest(p_limit, 0), 200) offset greatest(p_offset, 0)
  ) page
  order by page.last_name, page.first_name
$$;

-- The options for the city filter. Plaintext, small, and read through the same
-- permission gate as the list itself -- a distinct list of the places the
-- council's members live is still roster data.
create or replace function public.members_cities()
returns table (city text)
language sql
security definer
set search_path = ''
stable
as $$
  select distinct m.city
  from public.members m
  where kit.has_permission('members', 'view')
    and m.city is not null
    and m.city <> ''
  order by 1
$$;

-- F1 (20260922221437): the project default revokes execute on public
-- functions, so an RPC nobody grants is an RPC nobody can call. service_role
-- is deliberately left off both: it holds the default execute grant but always
-- fails the auth.uid()-based gate inside, which is the behaviour we want.
grant execute on function public.members_list(text, int, int, text, boolean) to authenticated;
grant execute on function public.members_cities()                            to authenticated;
