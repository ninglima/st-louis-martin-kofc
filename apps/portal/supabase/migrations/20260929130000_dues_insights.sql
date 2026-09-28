-- Dues insights: collection progress, coming due, lapse aging and retention.
-- Grace period: a renewal is kept when the next period's received_on is at
-- most period_end + 90 (periods are anchored at the previous end, so
-- period_start cannot tell a late payment from an on-time one). A window is
-- closed once period_end + 90 < today, for every fraternal year. Honorary
-- members are left out of counts and rates; they stay in dollars, coming
-- due and aging.
--
-- Fix round 1: last payment date only counts real money (online, check,
-- cash), not a waiver or an opening-balance import row (I1/R3). An
-- opening-balance row whose grace window had already closed before it was
-- loaded is excluded from retention entirely -- the load date is not a
-- real renewal event (I2/R4). A member accepted in the future is not yet
-- lapsed or due (M1).

create or replace function kit.collection_progress_at(p_year integer, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with bounds as (
    select make_date(p_year, 7, 1) as ys, make_date(p_year + 1, 7, 1) as ye
  ),
  ended as (
    select distinct on (p.member_id) p.member_id, p.period_end
      from public.dues_periods p
      join public.members m on m.id = p.member_id
      cross join bounds b
     where p.voided_at is null
       and m.dues_level <> 'honorary'
       and p.period_end >= b.ys and p.period_end < b.ye
     order by p.member_id, p.period_end desc
  ),
  first_due as (
    select m.id as member_id,
           exists (select 1 from public.dues_periods q where q.member_id = m.id and q.voided_at is null) as paid
      from public.members m cross join bounds b
     where m.dues_level <> 'honorary'
       and m.accepted_on is not null
       and m.id not in (select member_id from ended)
       and (
         (m.accepted_on >= b.ys and m.accepted_on < b.ye)
         or (m.accepted_on < b.ys
             and not exists (select 1 from public.dues_periods q where q.member_id = m.id and q.voided_at is null))
       )
  ),
  expected as (
    select e.member_id,
           exists (select 1 from public.dues_periods q
                    where q.member_id = e.member_id and q.voided_at is null and q.period_start >= e.period_end) as renewed
      from ended e
    union all
    select f.member_id, f.paid from first_due f
  ),
  months as (
    -- the running total is computed here: a window call cannot sit inside jsonb_agg
    select d.month,
           d.online_cents + d.check_cents + d.cash_cents as cents,
           sum(d.online_cents + d.check_cents + d.cash_cents) over (order by d.month) as cumulative
      from kit.dues_monthly(p_year) d
  )
  select jsonb_build_object(
    'expected', (select count(*) from expected),
    'renewed', (select count(*) from expected where renewed),
    'expectedCents', (select coalesce(sum(l.amount_cents), 0)
                        from expected x
                        join public.members m on m.id = x.member_id
                        join public.dues_levels l on l.slug = m.dues_level),
    'collectedCents', kit.dues_collected(p_year),
    'byMonth', (
      select jsonb_agg(jsonb_build_object(
               'month', mo.month,
               'cents', mo.cents,
               'cumulativeCents', case when mo.month > p_today then null else mo.cumulative end)
             order by mo.month)
        from months mo)
  );
$$;

create or replace function kit.renewals_forecast_rows_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer, month date)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number, s.paid_through,
         s.level_name, s.amount_cents, date_trunc('month', s.paid_through)::date
    from kit.member_dues_snapshot(p_today) s
   where s.paid_through > p_today
     and s.paid_through < (date_trunc('month', p_today) + interval '12 months')::date;
$$;

create or replace function kit.renewals_forecast_at(p_today date)
returns table (month date, members integer, cents bigint)
language sql stable security definer set search_path = '' as $$
  select m.month,
         count(r.member_id)::integer,
         coalesce(sum(r.amount_cents), 0)::bigint
    from (select (date_trunc('month', p_today) + make_interval(months => i))::date as month
            from generate_series(0, 11) as i) m
    left join kit.renewals_forecast_rows_at(p_today) r on r.month = m.month
   group by m.month
   order by m.month;
$$;

create or replace function kit.forecast_members_at(p_month date, p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select r.member_id, r.first_name, r.last_name, r.membership_number, r.paid_through, r.level_name, r.amount_cents
    from kit.renewals_forecast_rows_at(p_today) r
   where r.month = p_month
   order by r.paid_through, r.last_name, r.first_name;
$$;

create or replace function kit.lapsed_members_at(p_today date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               days_unpaid integer, bucket text, level_name text, amount_cents integer, last_paid_on date)
language sql stable security definer set search_path = '' as $$
  with base as (
    select s.*, m.accepted_on,
           case when s.paid_through is not null then p_today - s.paid_through + 1
                else p_today - m.accepted_on + 1 end as days
      from kit.member_dues_snapshot(p_today) s
      join public.members m on m.id = s.member_id
     where s.dues_status in ('lapsed', 'due')
       -- a member accepted in the future is not lapsed or due yet (M1)
       and (s.paid_through is not null or m.accepted_on <= p_today)
  )
  select b.member_id, b.first_name, b.last_name, b.membership_number, b.days,
         case when b.days <= 30 then '1-30' when b.days <= 90 then '31-90'
              when b.days <= 180 then '91-180' else '181+' end,
         b.level_name, b.amount_cents,
         -- last payment: real money only, not a waiver or an opening-balance
         -- import row (I1/R3)
         (select max(q.received_on) from public.dues_periods q
           where q.member_id = b.member_id and q.voided_at is null
             and q.method in ('online', 'check', 'cash'))
    from base b
   order by b.days desc, b.last_name, b.first_name;
$$;

create or replace function kit.lapse_aging_at(p_today date)
returns table (bucket text, members integer, cents bigint)
language sql stable security definer set search_path = '' as $$
  select k.bucket,
         count(l.member_id)::integer,
         coalesce(sum(l.amount_cents), 0)::bigint
    from (values (1, '1-30'), (2, '31-90'), (3, '91-180'), (4, '181+')) as k(ord, bucket)
    left join kit.lapsed_members_at(p_today) l on l.bucket = k.bucket
   group by k.ord, k.bucket
   order by k.ord;
$$;

create or replace function kit.retention_at(p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cur as (select kit.fraternal_year_of(p_today) as y),
  periods as (
    -- every active, non-honorary period, and whether it was renewed in time.
    -- An opening-balance row whose grace window had already closed before it
    -- was loaded is excluded here, from both eligibility and lapses: the
    -- load date is not a real renewal event (I2/R4).
    select p.member_id, p.period_end,
           exists (select 1 from public.dues_periods q
                    where q.member_id = p.member_id and q.voided_at is null
                      and q.period_start >= p.period_end
                      and q.received_on <= p.period_end + 90) as kept
      from public.dues_periods p
      join public.members m on m.id = p.member_id
     where p.voided_at is null
       and m.dues_level <> 'honorary'
       and not (p.method = 'opening_balance' and p.period_end + 90 < p.received_on)
  ),
  latest_per_year as (
    -- the latest period per member per fraternal year, picked before the
    -- closed-window filter, so a still-open later window -- not an earlier
    -- closed one -- decides whether the member counts for that year (M3)
    select distinct on (pe.member_id, kit.fraternal_year_of(pe.period_end))
           kit.fraternal_year_of(pe.period_end) as year, pe.period_end, pe.kept
      from periods pe
     order by pe.member_id, kit.fraternal_year_of(pe.period_end), pe.period_end desc
  ),
  closed_per_year as (
    select * from latest_per_year where period_end + 90 < p_today
  )
  select jsonb_build_object(
    'years', (
      select jsonb_agg(jsonb_build_object(
               'year', g.y,
               'eligible', (select count(*) from closed_per_year l where l.year = g.y),
               'renewed', (select count(*) from closed_per_year l where l.year = g.y and l.kept))
             order by g.y)
        from cur c cross join lateral generate_series(c.y - 4, c.y) as g(y)),
    'lapsesByMonth', (
      select jsonb_agg(jsonb_build_object(
               'month', mo.month,
               'lapses', (select count(*) from periods pe
                           where not pe.kept
                             and pe.period_end + 90 < p_today
                             and date_trunc('month', pe.period_end + 90)::date = mo.month))
             order by mo.month)
        from cur c
        cross join lateral (
          select gs::date as month
            from generate_series(make_date(c.y - 4, 7, 1), date_trunc('month', p_today)::date, interval '1 month') gs
        ) mo)
  );
$$;

-- Follow-up now lists only due members and those due within 30 days;
-- lapsed members moved to the Lapses tab. Same signature.
create or replace function kit.finance_follow_up_at(p_today date)
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number,
         s.dues_status, s.paid_through, s.level_name, s.amount_cents
    from kit.member_dues_snapshot(p_today) s
   where s.dues_status = 'due'
      or (s.dues_status = 'due_soon' and s.paid_through <= p_today + 30)
   order by case s.dues_status when 'due' then 0 else 1 end,
            s.paid_through nulls last, s.last_name, s.first_name;
$$;

revoke all on function kit.collection_progress_at(integer, date) from public, anon, authenticated;
revoke all on function kit.renewals_forecast_rows_at(date) from public, anon, authenticated;
revoke all on function kit.renewals_forecast_at(date) from public, anon, authenticated;
revoke all on function kit.forecast_members_at(date, date) from public, anon, authenticated;
revoke all on function kit.lapsed_members_at(date) from public, anon, authenticated;
revoke all on function kit.lapse_aging_at(date) from public, anon, authenticated;
revoke all on function kit.retention_at(date) from public, anon, authenticated;
revoke all on function kit.finance_follow_up_at(date) from public, anon, authenticated;

create or replace function public.finance_collection_progress(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  perform kit.assert_fraternal_year(p_year);
  return kit.collection_progress_at(p_year, kit.council_today());
end $$;

create or replace function public.finance_renewals_forecast()
returns table (month date, members integer, cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.renewals_forecast_at(kit.council_today());
end $$;

create or replace function public.finance_forecast_members(p_month date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  -- read once (M6): a call made exactly at midnight in Chicago could
  -- otherwise validate against one month window and query against the next.
  v_today date := kit.council_today();
  v_first date := date_trunc('month', v_today)::date;
begin
  perform kit.assert_finance_view();
  if p_month is null or p_month <> date_trunc('month', p_month)::date
     or p_month < v_first or p_month > (v_first + interval '11 months')::date then
    raise exception 'unknown forecast month: %', coalesce(p_month::text, '(none)');
  end if;
  return query select * from kit.forecast_members_at(p_month, v_today);
end $$;

create or replace function public.finance_lapse_aging()
returns table (bucket text, members integer, cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.lapse_aging_at(kit.council_today());
end $$;

create or replace function public.finance_lapsed_members()
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               days_unpaid integer, bucket text, level_name text, amount_cents integer, last_paid_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return query select * from kit.lapsed_members_at(kit.council_today());
end $$;

create or replace function public.finance_retention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_view();
  return kit.retention_at(kit.council_today());
end $$;

revoke all on function public.finance_collection_progress(integer) from public, anon;
revoke all on function public.finance_renewals_forecast() from public, anon;
revoke all on function public.finance_forecast_members(date) from public, anon;
revoke all on function public.finance_lapse_aging() from public, anon;
revoke all on function public.finance_lapsed_members() from public, anon;
revoke all on function public.finance_retention() from public, anon;
grant execute on function public.finance_collection_progress(integer) to authenticated;
grant execute on function public.finance_renewals_forecast() to authenticated;
grant execute on function public.finance_forecast_members(date) to authenticated;
grant execute on function public.finance_lapse_aging() to authenticated;
grant execute on function public.finance_lapsed_members() to authenticated;
grant execute on function public.finance_retention() to authenticated;
