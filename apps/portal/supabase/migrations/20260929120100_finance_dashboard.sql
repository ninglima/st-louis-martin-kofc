-- Financial dashboard: every figure is computed here. Each kit.*_at(p_today)
-- function holds the logic with an explicit "today" so tests can pin dates;
-- the public wrappers check finance.view and pass kit.council_today().

create or replace function kit.fraternal_year_of(p_date date)
returns integer language sql immutable set search_path = '' as $$
  select extract(year from p_date)::integer
         - case when extract(month from p_date) < 7 then 1 else 0 end;
$$;
revoke all on function kit.fraternal_year_of(date) from public, anon;
grant execute on function kit.fraternal_year_of(date) to authenticated;

create or replace function kit.assert_fraternal_year(p_year integer)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_year is null or p_year < 2000
     or p_year > kit.fraternal_year_of(kit.council_today()) + 1 then
    raise exception 'unknown fraternal year: %', coalesce(p_year::text, '(none)');
  end if;
end $$;

-- Unrounded cents of every bill that falls inside [p_from, p_to), per provider.
create or replace function kit.hosting_spread(p_from date, p_to date)
returns table (provider text, cents numeric)
language sql stable security definer set search_path = '' as $$
  select c.provider,
         sum(c.amount_cents::numeric
             * (least(c.period_end, p_to) - greatest(c.period_start, p_from))
             / (c.period_end - c.period_start))
    from public.hosting_costs c
   where p_to > p_from
     and c.period_start < p_to
     and c.period_end > p_from
   group by c.provider;
$$;

create or replace function kit.hosting_monthly(p_year integer)
returns table (month date, provider text, cents integer)
language sql stable security definer set search_path = '' as $$
  select m.month, s.provider, round(s.cents)::integer
    from (select (make_date(p_year, 7, 1) + make_interval(months => i))::date as month
            from generate_series(0, 11) as i) m
    cross join lateral kit.hosting_spread(m.month, (m.month + interval '1 month')::date) s
   order by m.month, s.provider;
$$;

-- Bills entered for the year, plus each provider's latest bill carried forward
-- at its daily rate to the year's end, when that bill ended within the last
-- 13 months and before the year ends.
create or replace function kit.hosting_projection_at(p_year integer, p_today date)
returns table (provider text, cents numeric)
language sql stable security definer set search_path = '' as $$
  with bounds as (
    select make_date(p_year, 7, 1) as y_start, make_date(p_year + 1, 7, 1) as y_end
  ),
  entered as (
    select s.provider, s.cents
      from bounds b cross join lateral kit.hosting_spread(b.y_start, b.y_end) s
  ),
  latest as (
    select distinct on (c.provider) c.provider, c.amount_cents, c.period_start, c.period_end
      from public.hosting_costs c
     order by c.provider, c.period_end desc, c.created_at desc
  ),
  extra as (
    select l.provider,
           l.amount_cents::numeric / (l.period_end - l.period_start)
             * (b.y_end - greatest(l.period_end, b.y_start)) as cents
      from latest l cross join bounds b
     where l.period_end > (p_today - interval '13 months')::date
       and l.period_end < b.y_end
  )
  select t.provider, sum(t.cents)
    from (select * from entered union all select * from extra) t
   group by t.provider;
$$;

create or replace function kit.dues_collected(p_year integer)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount_cents), 0)::bigint
    from public.dues_periods p
   where p.voided_at is null
     and p.received_on >= make_date(p_year, 7, 1)
     and p.received_on <  make_date(p_year + 1, 7, 1);
$$;

create or replace function kit.dues_monthly(p_year integer)
returns table (month date, online_cents bigint, check_cents bigint, cash_cents bigint)
language sql stable security definer set search_path = '' as $$
  select m.month,
         coalesce(sum(p.amount_cents) filter (where p.method = 'online'), 0)::bigint,
         coalesce(sum(p.amount_cents) filter (where p.method = 'check'), 0)::bigint,
         coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0)::bigint
    from (select (make_date(p_year, 7, 1) + make_interval(months => i))::date as month
            from generate_series(0, 11) as i) m
    left join public.dues_periods p
      on p.voided_at is null
     and p.received_on >= m.month
     and p.received_on <  (m.month + interval '1 month')::date
   group by m.month
   order by m.month;
$$;

create or replace function kit.member_dues_snapshot(p_today date)
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_level text, level_name text, amount_cents integer, paid_through date, dues_status text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.first_name, m.last_name, m.membership_number, m.dues_level, l.name, l.amount_cents,
         pt.paid_through, kit.dues_status(pt.paid_through, m.accepted_on, p_today)
    from public.members m
    join public.dues_levels l on l.slug = m.dues_level
    cross join lateral (select kit.dues_paid_through(m.id) as paid_through) pt;
$$;

create or replace function kit.finance_dashboard_at(p_year integer, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start   date    := make_date(p_year, 7, 1);
  v_end     date    := make_date(p_year + 1, 7, 1);
  v_current boolean := kit.fraternal_year_of(p_today) = p_year;
  v_result  jsonb;
begin
  with snap as (
    select * from kit.member_dues_snapshot(p_today)
  ),
  counts as (
    select s.dues_status, count(*)::integer as n from snap s group by s.dues_status
  )
  select jsonb_build_object(
    'year', p_year,
    'yearStart', v_start,
    'yearEnd', v_end,
    'isCurrentYear', v_current,
    'today', p_today,
    'duesCollectedCents', kit.dues_collected(p_year),
    'outstandingCents',
      (select coalesce(sum(s.amount_cents), 0)::bigint from snap s where s.dues_status in ('due', 'lapsed')),
    'collection', (
      select jsonb_build_object(
        'numerator',   count(*) filter (where s.dues_status in ('current', 'due_soon')),
        'denominator', count(*) filter (where s.dues_status in ('current', 'due_soon', 'due', 'lapsed')))
        from snap s where s.dues_level <> 'honorary'),
    'statusCounts', (
      select jsonb_object_agg(k.status, coalesce((select c.n from counts c where c.dues_status = k.status), 0))
        from unnest(array['current', 'due_soon', 'due', 'lapsed', 'no_record']) as k(status)),
    'hostingToDateCents',
      (select coalesce(round(sum(h.cents)), 0)::bigint
         from kit.hosting_spread(v_start, least(p_today + 1, v_end)) h),
    'hostingProjectionCents',
      case when v_current then
        (select coalesce(round(sum(h.cents)), 0)::bigint from kit.hosting_projection_at(p_year, p_today) h)
      end,
    'duesByMonth', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', d.month, 'onlineCents', d.online_cents,
               'checkCents', d.check_cents, 'cashCents', d.cash_cents) order by d.month), '[]'::jsonb)
        from kit.dues_monthly(p_year) d),
    'hostingByMonth', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', h.month, 'provider', h.provider, 'cents', h.cents) order by h.month, h.provider), '[]'::jsonb)
        from kit.hosting_monthly(p_year) h)
  ) into v_result;

  return v_result;
end $$;

create or replace function kit.finance_net_by_year_at(p_today date)
returns table (year integer, dues_cents bigint, hosting_cents bigint)
language sql stable security definer set search_path = '' as $$
  with first_year as (
    select least(
      (select min(kit.fraternal_year_of(p.received_on)) from public.dues_periods p
        where p.voided_at is null and p.amount_cents > 0),
      (select min(kit.fraternal_year_of(c.period_start)) from public.hosting_costs c),
      kit.fraternal_year_of(p_today)) as y
  )
  select g.y,
         kit.dues_collected(g.y),
         coalesce((select round(sum(s.cents))::bigint
                     from kit.hosting_spread(make_date(g.y, 7, 1), make_date(g.y + 1, 7, 1)) s), 0)
    from first_year f
    cross join lateral generate_series(f.y, kit.fraternal_year_of(p_today)) as g(y)
   order by g.y;
$$;

create or replace function kit.finance_follow_up_at(p_today date)
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number,
         s.dues_status, s.paid_through, s.level_name, s.amount_cents
    from kit.member_dues_snapshot(p_today) s
   where s.dues_status in ('lapsed', 'due')
      or (s.dues_status = 'due_soon' and s.paid_through <= p_today + 30)
   order by case s.dues_status when 'lapsed' then 0 when 'due' then 1 else 2 end,
            s.paid_through nulls last, s.last_name, s.first_name;
$$;

revoke all on function kit.assert_fraternal_year(integer) from public, anon, authenticated;
revoke all on function kit.hosting_spread(date, date) from public, anon, authenticated;
revoke all on function kit.hosting_monthly(integer) from public, anon, authenticated;
revoke all on function kit.hosting_projection_at(integer, date) from public, anon, authenticated;
revoke all on function kit.dues_collected(integer) from public, anon, authenticated;
revoke all on function kit.dues_monthly(integer) from public, anon, authenticated;
revoke all on function kit.member_dues_snapshot(date) from public, anon, authenticated;
revoke all on function kit.finance_dashboard_at(integer, date) from public, anon, authenticated;
revoke all on function kit.finance_net_by_year_at(date) from public, anon, authenticated;
revoke all on function kit.finance_follow_up_at(date) from public, anon, authenticated;

create or replace function public.finance_dashboard(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  perform kit.assert_fraternal_year(p_year);
  return kit.finance_dashboard_at(p_year, kit.council_today());
end $$;

create or replace function public.finance_net_by_year()
returns table (year integer, dues_cents bigint, hosting_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.finance_net_by_year_at(kit.council_today());
end $$;

create or replace function public.finance_follow_up()
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.finance_follow_up_at(kit.council_today());
end $$;

create or replace function public.finance_payments_to_check()
returns table (
  payment_id uuid, created_at timestamptz, member_id uuid, member_name text,
  dues_level text, amount_cents integer, provider text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select p.id, p.created_at, m.id,
           case when m.id is null then null else m.first_name || ' ' || m.last_name end,
           p.metadata ->> 'dues_level', p.amount, p.provider
      from public.payments p
      left join public.members m on m.user_id = p.user_id
     where p.payment_type = 'dues'
       and p.status = 'succeeded'
       and not exists (select 1 from public.dues_periods d where d.payment_id = p.id)
     order by p.created_at desc;
end $$;

revoke all on function public.finance_dashboard(integer) from public, anon;
revoke all on function public.finance_net_by_year() from public, anon;
revoke all on function public.finance_follow_up() from public, anon;
revoke all on function public.finance_payments_to_check() from public, anon;
grant execute on function public.finance_dashboard(integer) to authenticated;
grant execute on function public.finance_net_by_year() to authenticated;
grant execute on function public.finance_follow_up() to authenticated;
grant execute on function public.finance_payments_to_check() to authenticated;
