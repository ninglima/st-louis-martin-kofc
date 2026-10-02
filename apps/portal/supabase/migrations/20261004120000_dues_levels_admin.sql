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

  -- Serialize with other level changes: the "a self-service level remains"
  -- check below must see the committed result of any concurrent retire/edit.
  perform 1 from public.dues_levels where active and self_service for update;

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
  v_before  public.dues_levels;
  v_after   public.dues_levels;
  v_moved   uuid[];
  v_default text;
  v_target  text;
begin
  perform kit.assert_finance_manage();

  -- Lock the active self-service rows first (same order as save_dues_level),
  -- so two concurrent retires cannot both pass the "one remains" check.
  perform 1 from public.dues_levels where active and self_service for update;

  select * into v_before from public.dues_levels where slug = p_slug for update;
  if not found or not v_before.active then
    raise exception 'That level is not active';
  end if;

  -- The level new members start on is the column default of members.dues_level.
  select substring(pg_get_expr(d.adbin, d.adrelid) from '^''(.*)''::text$') into v_default
    from pg_catalog.pg_attrdef d
    join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.members'::regclass and a.attname = 'dues_level';
  if v_default = p_slug then
    raise exception 'This is the level new members start on, so it cannot be retired';
  end if;

  if p_move_to is not null and p_move_to <> p_slug then
    -- Hold the target so it cannot be retired while members move onto it.
    select slug into v_target from public.dues_levels
     where slug = p_move_to and active for share;
    if v_target is null then
      raise exception 'Members can only be moved to an active level';
    end if;
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
