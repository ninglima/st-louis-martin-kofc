-- Monthly council worksheet. Membership is the roster as of p_today.
-- Dues received are the chosen calendar month only.

create or replace function kit.finance_monthly_worksheet_at(p_month date, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_online bigint;
  v_check  bigint;
  v_cash   bigint;
  v_counts jsonb;
  v_roster integer;
begin
  if p_month is null
     or p_month <> date_trunc('month', p_month)::date
     or p_month < date '2000-01-01'
     or p_month > date_trunc('month', p_today)::date then
    raise exception 'invalid worksheet month: %', p_month using errcode = 'P0001';
  end if;

  select coalesce(sum(dp.amount_cents) filter (where dp.method = 'online'), 0),
         coalesce(sum(dp.amount_cents) filter (where dp.method = 'check'), 0),
         coalesce(sum(dp.amount_cents) filter (where dp.method = 'cash'), 0)
    into v_online, v_check, v_cash
    from public.dues_periods dp
   where dp.voided_at is null
     and dp.received_on >= p_month
     and dp.received_on < (p_month + interval '1 month')::date;

  select jsonb_object_agg(
           k.status,
           coalesce((select count(*)::int
                       from kit.member_dues_snapshot(p_today) s
                      where s.dues_status = k.status), 0))
    into v_counts
    from unnest(array['current', 'due_soon', 'due', 'lapsed', 'no_record']) as k(status);

  v_roster :=
      coalesce((v_counts ->> 'current')::int, 0)
    + coalesce((v_counts ->> 'due_soon')::int, 0)
    + coalesce((v_counts ->> 'due')::int, 0)
    + coalesce((v_counts ->> 'lapsed')::int, 0)
    + coalesce((v_counts ->> 'no_record')::int, 0);

  return jsonb_build_object(
    'month', p_month,
    'asOf', p_today,
    'roster', v_roster,
    'statusCounts', v_counts,
    'receivedCents', v_online + v_check + v_cash,
    'onlineCents', v_online,
    'checkCents', v_check,
    'cashCents', v_cash);
end $$;

revoke all on function kit.finance_monthly_worksheet_at(date, date) from public, anon, authenticated;

create or replace function public.finance_monthly_worksheet(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kit.assert_finance_dashboard();
  return kit.finance_monthly_worksheet_at(p_month, kit.council_today());
end $$;

revoke all on function public.finance_monthly_worksheet(date) from public, anon;
grant execute on function public.finance_monthly_worksheet(date) to authenticated;
