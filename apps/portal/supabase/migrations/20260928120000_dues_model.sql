-- Dues model, part 1: levels, member dues columns, the dues_periods ledger,
-- derived status, gated read functions, and the `finance` RBAC section.
-- Spec: docs/superpowers/specs/2026-09-28-dues-model-design.md

create extension if not exists btree_gist with schema extensions;

-- finance section: administrator gets view + manage; member gets nothing.
insert into public.role_permissions (role_id, section, can_view, can_manage)
select id, 'finance', true, true from public.roles where slug = 'administrator'
on conflict (role_id, section) do nothing;

create table public.dues_levels (
  slug          text primary key,
  name          text not null,
  amount_cents  integer not null check (amount_cents >= 0),
  self_service  boolean not null default false,
  sort_order    integer not null,
  active        boolean not null default true
);

insert into public.dues_levels (slug, name, amount_cents, self_service, sort_order) values
  ('regular_contrib', 'Regular (with voluntary contribution)', 5800, true,  1),
  ('regular',         'Regular',                               5000, true,  2),
  ('student',         'Student',                               2500, false, 3),
  ('public_service',  'Public Service',                        2000, false, 4),
  ('honorary',        'Honorary',                              1900, false, 5);

alter table public.dues_levels enable row level security;
create policy dues_levels_select on public.dues_levels for select to authenticated using (true);
grant select on public.dues_levels to authenticated;

alter table public.members
  add column dues_level  text not null default 'regular_contrib' references public.dues_levels(slug),
  add column accepted_on date,
  add column is_student  boolean not null default false;

create type public.dues_method as enum ('online', 'check', 'cash', 'waived', 'opening_balance');

create table public.dues_periods (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete restrict,
  level         text not null references public.dues_levels(slug),
  amount_cents  integer not null check (amount_cents >= 0),
  method        public.dues_method not null,
  check_number  text,
  received_on   date not null,
  period_start  date not null,
  period_end    date not null,
  payment_id    uuid unique references public.payments(id) on delete restrict,
  recorded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by     uuid references auth.users(id) on delete set null,
  void_reason   text,
  constraint dues_periods_length       check (period_end = period_start + 365),
  constraint dues_periods_check_number check (method <> 'check' or nullif(btrim(check_number), '') is not null),
  constraint dues_periods_zero_amount  check (method not in ('waived', 'opening_balance') or amount_cents = 0),
  constraint dues_periods_void_shape   check ((voided_at is null) = (void_reason is null)),
  constraint dues_periods_no_overlap
    exclude using gist (member_id with =, daterange(period_start, period_end) with &&)
    where (voided_at is null)
);

create index dues_periods_member_idx on public.dues_periods (member_id) where voided_at is null;

-- No direct access: every read and write goes through the functions below.
alter table public.dues_periods enable row level security;

create or replace function kit.dues_periods_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dues periods cannot be deleted; void them instead';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided dues period cannot change';
  end if;
  if (new.id, new.member_id, new.level, new.amount_cents, new.method, new.check_number,
      new.received_on, new.period_start, new.period_end, new.payment_id, new.recorded_by, new.created_at)
     is distinct from
     (old.id, old.member_id, old.level, old.amount_cents, old.method, old.check_number,
      old.received_on, old.period_start, old.period_end, old.payment_id, old.recorded_by, old.created_at)
     or new.voided_at is null then
    raise exception 'dues periods are immutable; only voiding is allowed';
  end if;
  return new;
end $$;

create trigger dues_periods_guard
  before update or delete on public.dues_periods
  for each row execute function kit.dues_periods_guard();

create or replace function kit.dues_paid_through(p_member uuid)
returns date language sql stable security definer set search_path = '' as $$
  select max(period_end) from public.dues_periods where member_id = p_member and voided_at is null;
$$;

create or replace function kit.dues_next_period_start(p_member uuid)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce(kit.dues_paid_through(p_member),
                  (select accepted_on from public.members where id = p_member));
$$;

create or replace function kit.dues_status(p_paid_through date, p_accepted_on date, p_today date default current_date)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_paid_through is null and p_accepted_on is null then 'no_record'
    when p_paid_through is null then 'due'
    when p_paid_through <= p_today then 'lapsed'
    when p_paid_through <= p_today + 90 then 'due_soon'
    else 'current'
  end;
$$;

revoke all on function kit.dues_paid_through(uuid) from public, anon, authenticated;
revoke all on function kit.dues_next_period_start(uuid) from public, anon, authenticated;
grant execute on function kit.dues_status(date, date, date) to authenticated;

create or replace function public.member_dues_summary(p_member_ids uuid[])
returns table (
  member_id uuid, dues_level text, level_name text, amount_cents integer,
  accepted_on date, is_student boolean, paid_through date, dues_status text
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.dues_level, l.name, l.amount_cents, m.accepted_on, m.is_student,
         kit.dues_paid_through(m.id),
         kit.dues_status(kit.dues_paid_through(m.id), m.accepted_on)
  from public.members m
  join public.dues_levels l on l.slug = m.dues_level
  where m.id = any(p_member_ids)
    and kit.has_permission('finance', 'view');
$$;

create or replace function public.member_dues_ledger(p_member_id uuid)
returns table (
  id uuid, level text, level_name text, amount_cents integer, method public.dues_method,
  check_number text, received_on date, period_start date, period_end date,
  recorded_by_email text, created_at timestamptz, voided_at timestamptz, void_reason text
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.level, l.name, p.amount_cents, p.method, p.check_number, p.received_on,
         p.period_start, p.period_end, u.email, p.created_at, p.voided_at, p.void_reason
  from public.dues_periods p
  join public.dues_levels l on l.slug = p.level
  left join auth.users u on u.id = p.recorded_by
  where p.member_id = p_member_id
    and kit.has_permission('finance', 'view')
  order by p.period_start desc, p.created_at desc;
$$;

create or replace function public.my_dues_summary()
returns table (
  member_id uuid, dues_level text, level_name text, amount_cents integer,
  accepted_on date, is_student boolean, paid_through date, dues_status text
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.dues_level, l.name, l.amount_cents, m.accepted_on, m.is_student,
         kit.dues_paid_through(m.id),
         kit.dues_status(kit.dues_paid_through(m.id), m.accepted_on)
  from public.members m
  join public.dues_levels l on l.slug = m.dues_level
  where m.user_id = (select auth.uid());
$$;

create or replace function public.my_dues_ledger()
returns table (
  id uuid, level_name text, amount_cents integer, method public.dues_method,
  received_on date, period_start date, period_end date, voided_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id, l.name, p.amount_cents, p.method, p.received_on, p.period_start, p.period_end, p.voided_at
  from public.dues_periods p
  join public.dues_levels l on l.slug = p.level
  join public.members m on m.id = p.member_id
  where m.user_id = (select auth.uid())
  order by p.period_start desc;
$$;

grant execute on function public.member_dues_summary(uuid[]) to authenticated;
grant execute on function public.member_dues_ledger(uuid)    to authenticated;
grant execute on function public.my_dues_summary()           to authenticated;
grant execute on function public.my_dues_ledger()            to authenticated;
