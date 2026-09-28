-- Hosting costs: bills entered by hand by the Financial Secretary, one row per
-- bill with the period it covers ([period_start, period_end), end exclusive).
-- No direct table access; every read and write goes through the functions below.

-- Schema kit has no default USAGE grant to authenticated (only postgres, its
-- owner, can reference objects in it); every other kit function is only ever
-- called from inside a security definer function, which runs as the owner,
-- so this was never needed before. kit.council_today() is called directly by
-- authenticated (tests, and any client-side "what's today" use), so it needs
-- schema usage as well as the function-level execute grant below.
grant usage on schema kit to authenticated;

create or replace function kit.council_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Chicago')::date;
$$;
revoke all on function kit.council_today() from public, anon;
grant execute on function kit.council_today() to authenticated;

create or replace function kit.assert_finance_view()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('finance', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function kit.assert_finance_view() from public, anon, authenticated;

create table public.hosting_providers (
  slug       text primary key,
  name       text not null,
  sort_order integer not null,
  active     boolean not null default true
);

insert into public.hosting_providers (slug, name, sort_order) values
  ('supabase', 'Supabase', 1),
  ('cloudflare', 'Cloudflare', 2),
  ('google_cloud', 'Google Cloud', 3),
  ('domain', 'Domain', 4),
  ('other', 'Other', 5);

alter table public.hosting_providers enable row level security;
create policy hosting_providers_select on public.hosting_providers
  for select to authenticated using (true);

create table public.hosting_costs (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null references public.hosting_providers (slug),
  amount_cents integer not null check (amount_cents >= 0),
  paid_on      date not null,
  period_start date not null,
  period_end   date not null,
  note         text check (note is null or char_length(note) <= 500),
  created_by   uuid references auth.users (id) on delete restrict,
  updated_by   uuid references auth.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hosting_costs_period check (period_end > period_start),
  constraint hosting_costs_span   check (period_end - period_start <= 1096)
);

create index hosting_costs_provider_end_idx on public.hosting_costs (provider, period_end desc);

alter table public.hosting_costs enable row level security;
-- No policies on purpose: reads and writes go through security definer functions.

revoke all on public.hosting_costs     from anon, authenticated;
revoke all on public.hosting_providers from anon, authenticated;
grant select on public.hosting_providers to authenticated;

create or replace function kit.hosting_costs_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function kit.hosting_costs_touch() from public, anon, authenticated;

create trigger hosting_costs_touch
  before update on public.hosting_costs
  for each row execute function kit.hosting_costs_touch();

create or replace function kit.hosting_cost_validate(
  p_provider text, p_amount_cents integer, p_paid_on date,
  p_period_start date, p_period_end date, p_note text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_provider is null
     or not exists (select 1 from public.hosting_providers where slug = p_provider and active) then
    raise exception 'unknown hosting provider: %', coalesce(p_provider, '(none)');
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'the amount must be zero or more';
  end if;
  if p_paid_on is null or p_period_start is null or p_period_end is null then
    raise exception 'the paid date and the covered dates are required';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'the covered period must end after it starts';
  end if;
  if p_period_end - p_period_start > 1096 then
    raise exception 'a bill can cover at most 3 years';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'the note can be at most 500 characters';
  end if;
end $$;
revoke all on function kit.hosting_cost_validate(text, integer, date, date, date, text) from public, anon, authenticated;

-- The period after [p_start, p_end). A bill whose start and end fall on the same
-- day of the month (Oct 1 -> Nov 1, Oct 1 -> Oct 1 next year) repeats by whole
-- calendar months; anything else repeats by the same number of days.
create or replace function kit.hosting_next_period(p_start date, p_end date)
returns table (period_start date, period_end date)
language plpgsql immutable set search_path = '' as $$
declare
  v_months integer;
begin
  if extract(day from p_start) = extract(day from p_end) then
    v_months := (extract(year from p_end)::integer * 12 + extract(month from p_end)::integer)
              - (extract(year from p_start)::integer * 12 + extract(month from p_start)::integer);
    return query select p_end, (p_end + make_interval(months => v_months))::date;
  else
    return query select p_end, p_end + (p_end - p_start);
  end if;
end $$;
revoke all on function kit.hosting_next_period(date, date) from public, anon, authenticated;

create or replace function public.hosting_cost_upsert(
  p_provider text, p_amount_cents integer, p_paid_on date,
  p_period_start date, p_period_end date,
  p_note text default null, p_id uuid default null)
returns public.hosting_costs
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_row  public.hosting_costs;
begin
  perform kit.assert_finance_manage();
  perform kit.hosting_cost_validate(p_provider, p_amount_cents, p_paid_on, p_period_start, p_period_end, v_note);

  if p_id is null then
    insert into public.hosting_costs
      (provider, amount_cents, paid_on, period_start, period_end, note, created_by, updated_by)
    values
      (p_provider, p_amount_cents, p_paid_on, p_period_start, p_period_end, v_note, auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.hosting_costs
       set provider = p_provider, amount_cents = p_amount_cents, paid_on = p_paid_on,
           period_start = p_period_start, period_end = p_period_end, note = v_note,
           updated_by = auth.uid()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'hosting cost not found';
    end if;
  end if;

  return v_row;
end $$;

create or replace function public.hosting_cost_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  delete from public.hosting_costs where id = p_id;
  if not found then
    raise exception 'hosting cost not found';
  end if;
end $$;

create or replace function public.hosting_cost_repeat_last(p_provider text)
returns public.hosting_costs
language plpgsql security definer set search_path = '' as $$
declare
  v_last public.hosting_costs;
  v_next record;
  v_row  public.hosting_costs;
begin
  perform kit.assert_finance_manage();

  select * into v_last from public.hosting_costs
   where provider = p_provider
   order by period_end desc, created_at desc
   limit 1;
  if not found then
    raise exception 'no earlier bill for this provider';
  end if;

  select * into v_next from kit.hosting_next_period(v_last.period_start, v_last.period_end);

  insert into public.hosting_costs
    (provider, amount_cents, paid_on, period_start, period_end, note, created_by, updated_by)
  values
    (v_last.provider, v_last.amount_cents, kit.council_today(), v_next.period_start, v_next.period_end,
     v_last.note, auth.uid(), auth.uid())
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.hosting_costs_list(p_year integer)
returns table (
  id uuid, provider text, provider_name text, amount_cents integer, paid_on date,
  period_start date, period_end date, note text, recorded_by_email text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select c.id, c.provider, p.name, c.amount_cents, c.paid_on, c.period_start, c.period_end,
           c.note, u.email::text, c.updated_at
      from public.hosting_costs c
      join public.hosting_providers p on p.slug = c.provider
      left join auth.users u on u.id = coalesce(c.updated_by, c.created_by)
     where c.period_start < make_date(p_year + 1, 7, 1)
       and c.period_end   > make_date(p_year, 7, 1)
     order by c.period_start desc, c.paid_on desc, c.created_at desc;
end $$;

create or replace function public.hosting_cost_latest()
returns table (provider text, amount_cents integer, period_start date, period_end date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select distinct on (c.provider) c.provider, c.amount_cents, c.period_start, c.period_end
      from public.hosting_costs c
     order by c.provider, c.period_end desc, c.created_at desc;
end $$;

create or replace function public.hosting_cost_overlaps(
  p_provider text, p_period_start date, p_period_end date, p_exclude_id uuid default null)
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query
    select c.id from public.hosting_costs c
     where c.provider = p_provider
       and c.period_start < p_period_end
       and c.period_end > p_period_start
       and (p_exclude_id is null or c.id <> p_exclude_id);
end $$;

revoke all on function public.hosting_cost_upsert(text, integer, date, date, date, text, uuid) from public, anon;
revoke all on function public.hosting_cost_delete(uuid) from public, anon;
revoke all on function public.hosting_cost_repeat_last(text) from public, anon;
revoke all on function public.hosting_costs_list(integer) from public, anon;
revoke all on function public.hosting_cost_latest() from public, anon;
revoke all on function public.hosting_cost_overlaps(text, date, date, uuid) from public, anon;

grant execute on function public.hosting_cost_upsert(text, integer, date, date, date, text, uuid) to authenticated;
grant execute on function public.hosting_cost_delete(uuid) to authenticated;
grant execute on function public.hosting_cost_repeat_last(text) to authenticated;
grant execute on function public.hosting_costs_list(integer) to authenticated;
grant execute on function public.hosting_cost_latest() to authenticated;
grant execute on function public.hosting_cost_overlaps(text, date, date, uuid) to authenticated;
