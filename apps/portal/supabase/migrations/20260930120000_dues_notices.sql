-- Dues notices: who is due which reminder, a once-only claim, tracking
-- events from Resend, and the reads behind the Dues notices page.

create type public.dues_notice_kind as enum ('before_30', 'due_date', 'after_30');

alter table public.members add column dues_notices_opt_out boolean not null default false;

create table public.dues_notices (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members (id) on delete restrict,
  kind            public.dues_notice_kind not null,
  cycle_date      date not null,
  email           text not null,
  mode            text not null check (mode in ('dry_run', 'live')),
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dry_run')),
  resend_email_id text unique,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (member_id, kind, cycle_date)
);

create table public.dues_notice_events (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null references public.dues_notices (id) on delete cascade,
  type        text not null check (type in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked')),
  occurred_at timestamptz not null,
  svix_id     text not null unique,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index dues_notice_events_notice_idx on public.dues_notice_events (notice_id);

create table public.dues_notice_runs (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  mode       text not null check (mode in ('off', 'dry_run', 'live')),
  candidates integer not null default 0,
  sent       integer not null default 0,
  skipped    integer not null default 0,
  failed     integer not null default 0,
  error      text
);

alter table public.dues_notices enable row level security;
alter table public.dues_notice_events enable row level security;
alter table public.dues_notice_runs enable row level security;
revoke all on public.dues_notices from anon, authenticated;
revoke all on public.dues_notice_events from anon, authenticated;
revoke all on public.dues_notice_runs from anon, authenticated;

create or replace function kit.dues_notice_due_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text, email text,
               kind public.dues_notice_kind, cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  with base as (
    select s.member_id, s.first_name, s.last_name, s.membership_number,
           nullif(btrim(m.primary_email), '') as email,
           s.level_name, s.amount_cents, s.dues_status,
           s.paid_through is null as first_dues,
           coalesce(s.paid_through, m.accepted_on) as c
      from kit.member_dues_snapshot(p_today) s
      join public.members m on m.id = s.member_id
     where s.dues_level <> 'honorary'
       and not m.dues_notices_opt_out
       and not (s.paid_through is null and m.accepted_on > p_today)
  ),
  kinds as (
    select b.*,
           case
             when p_today between b.c - 30 and b.c - 1 then 'before_30'::public.dues_notice_kind
             when p_today between b.c and b.c + 7 then 'due_date'::public.dues_notice_kind
             when p_today between b.c + 30 and b.c + 37 and b.dues_status in ('lapsed', 'due')
               then 'after_30'::public.dues_notice_kind
           end as kind
      from base b
     where b.c is not null
  )
  select k.member_id, k.first_name, k.last_name, k.membership_number, k.email,
         k.kind, k.c, k.first_dues, k.level_name, k.amount_cents
    from kinds k
   where k.kind is not null;
$$;

create or replace function kit.dues_notice_candidates_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text, email text,
               kind public.dues_notice_kind, cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select d.*
    from kit.dues_notice_due_at(p_today) d
   where d.email is not null
     and not exists (select 1 from public.dues_notices n
                      where n.member_id = d.member_id and n.kind = d.kind and n.cycle_date = d.cycle_date);
$$;

create or replace function kit.dues_notices_claim_at(p_mode text, p_today date)
returns table (notice_id uuid, member_id uuid, first_name text, email text, kind public.dues_notice_kind,
               cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_mode is null or p_mode not in ('dry_run', 'live') then
    raise exception 'unknown dues notice mode: %', coalesce(p_mode, '(none)');
  end if;

  return query
    with c as (
      select * from kit.dues_notice_candidates_at(p_today)
    ),
    ins as (
      insert into public.dues_notices (member_id, kind, cycle_date, email, mode, status, sent_at)
      select c.member_id, c.kind, c.cycle_date, c.email, p_mode,
             case when p_mode = 'dry_run' then 'dry_run' else 'pending' end,
             case when p_mode = 'dry_run' then now() end
        from c
      on conflict (member_id, kind, cycle_date) do nothing
      returning id, member_id, kind, cycle_date, email
    )
    select ins.id, ins.member_id, c.first_name, ins.email, ins.kind, ins.cycle_date,
           c.first_dues, c.level_name, c.amount_cents
      from ins
      join c on c.member_id = ins.member_id and c.kind = ins.kind and c.cycle_date = ins.cycle_date;
end $$;

create or replace function kit.dues_notice_tracking(p_notice_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when n.status in ('failed', 'dry_run', 'pending') then n.status
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'complained') then 'complained'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'bounced') then 'bounced'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'clicked') then 'clicked'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'opened') then 'opened'
           when exists (select 1 from public.dues_notice_events e where e.notice_id = n.id and e.type = 'delivered') then 'delivered'
           else 'sent'
         end
    from public.dues_notices n
   where n.id = p_notice_id;
$$;

revoke all on function kit.dues_notice_due_at(date) from public, anon, authenticated;
revoke all on function kit.dues_notice_candidates_at(date) from public, anon, authenticated;
revoke all on function kit.dues_notices_claim_at(text, date) from public, anon, authenticated;
revoke all on function kit.dues_notice_tracking(uuid) from public, anon, authenticated;

-- The job's claim: service role only (the job authenticates with its own secret).
create or replace function public.dues_notices_claim(p_mode text)
returns table (notice_id uuid, member_id uuid, first_name text, email text, kind public.dues_notice_kind,
               cycle_date date, first_dues boolean, level_name text, amount_cents integer)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query select * from kit.dues_notices_claim_at(p_mode, kit.council_today());
end $$;
revoke all on function public.dues_notices_claim(text) from public, anon, authenticated;
grant execute on function public.dues_notices_claim(text) to service_role;

create or replace function public.dues_notices_list(p_kind text default null, p_tracking text default null, p_limit integer default 200)
returns table (id uuid, member_id uuid, first_name text, last_name text, membership_number text, email text,
               kind text, cycle_date date, status text, tracking text, sent_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select * from (
      select n.id, n.member_id, m.first_name, m.last_name, m.membership_number, n.email,
             n.kind::text, n.cycle_date, n.status, kit.dues_notice_tracking(n.id) as tracking, n.sent_at, n.created_at
        from public.dues_notices n
        join public.members m on m.id = n.member_id
       where (p_kind is null or n.kind::text = p_kind)
    ) t
    where (p_tracking is null or t.tracking = p_tracking)
    order by t.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

create or replace function public.dues_notice_events_for(p_notice_id uuid)
returns table (type text, occurred_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query select e.type, e.occurred_at from public.dues_notice_events e
                where e.notice_id = p_notice_id order by e.occurred_at, e.created_at;
end $$;

create or replace function public.dues_notices_last_run()
returns table (ran_at timestamptz, mode text, candidates integer, sent integer, skipped integer, failed integer, error text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query select r.ran_at, r.mode, r.candidates, r.sent, r.skipped, r.failed, r.error
                 from public.dues_notice_runs r order by r.ran_at desc limit 1;
end $$;

create or replace function kit.dues_notices_unreachable_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text, reason text, detail text)
language sql stable security definer set search_path = '' as $$
  select d.member_id, d.first_name, d.last_name, d.membership_number, 'no_email', d.kind::text
    from kit.dues_notice_due_at(p_today) d
   where d.email is null
  union all
  select m.id, m.first_name, m.last_name, m.membership_number, t.tracking, t.email
    from (select distinct on (n.member_id) n.member_id, n.email, kit.dues_notice_tracking(n.id) as tracking
            from public.dues_notices n
           order by n.member_id, n.created_at desc) t
    join public.members m on m.id = t.member_id
   where t.tracking in ('bounced', 'complained');
$$;
revoke all on function kit.dues_notices_unreachable_at(date) from public, anon, authenticated;

create or replace function public.dues_notices_unreachable()
returns table (member_id uuid, first_name text, last_name text, membership_number text, reason text, detail text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.dues_notices_unreachable_at(kit.council_today());
end $$;

create or replace function public.dues_last_notices(p_member_ids uuid[])
returns table (member_id uuid, kind text, sent_at timestamptz, tracking text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select distinct on (n.member_id) n.member_id, n.kind::text, coalesce(n.sent_at, n.created_at), kit.dues_notice_tracking(n.id)
      from public.dues_notices n
     where n.member_id = any(p_member_ids)
     order by n.member_id, n.created_at desc;
end $$;

create or replace function public.member_dues_notices(p_member_id uuid)
returns table (id uuid, kind text, cycle_date date, sent_at timestamptz, tracking text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select n.id, n.kind::text, n.cycle_date, coalesce(n.sent_at, n.created_at), kit.dues_notice_tracking(n.id)
      from public.dues_notices n where n.member_id = p_member_id order by n.created_at desc;
end $$;

create or replace function public.member_dues_notices_opt_out(p_member_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return (select m.dues_notices_opt_out from public.members m where m.id = p_member_id);
end $$;

create or replace function public.set_member_dues_notices(p_member_id uuid, p_opt_out boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  update public.members set dues_notices_opt_out = coalesce(p_opt_out, false) where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

revoke all on function public.dues_notices_list(text, text, integer) from public, anon;
revoke all on function public.dues_notice_events_for(uuid) from public, anon;
revoke all on function public.dues_notices_last_run() from public, anon;
revoke all on function public.dues_notices_unreachable() from public, anon;
revoke all on function public.dues_last_notices(uuid[]) from public, anon;
revoke all on function public.member_dues_notices(uuid) from public, anon;
revoke all on function public.member_dues_notices_opt_out(uuid) from public, anon;
revoke all on function public.set_member_dues_notices(uuid, boolean) from public, anon;
grant execute on function public.dues_notices_list(text, text, integer) to authenticated;
grant execute on function public.dues_notice_events_for(uuid) to authenticated;
grant execute on function public.dues_notices_last_run() to authenticated;
grant execute on function public.dues_notices_unreachable() to authenticated;
grant execute on function public.dues_last_notices(uuid[]) to authenticated;
grant execute on function public.member_dues_notices(uuid) to authenticated;
grant execute on function public.member_dues_notices_opt_out(uuid) to authenticated;
grant execute on function public.set_member_dues_notices(uuid, boolean) to authenticated;
