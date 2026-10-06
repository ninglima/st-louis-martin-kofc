-- Finance dashboard is its own grant. finance.view still opens dues notices,
-- hosting costs, and ledgers. A role can hold either one without the other.
-- Roles that already have finance.view keep the dashboard they see today.

insert into public.role_permissions (role_id, section, can_view, can_manage)
select role_id, 'dashboard_finance', true, false
  from public.role_permissions
 where section = 'finance'
   and can_view
on conflict (role_id, section) do nothing;

create or replace function kit.assert_finance_dashboard()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (
    kit.has_permission('finance', 'view')
    or kit.has_permission('dashboard_finance', 'view')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function kit.assert_finance_dashboard() from public, anon, authenticated;

create or replace function public.finance_dashboard(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  perform kit.assert_fraternal_year(p_year);
  return kit.finance_dashboard_at(p_year, kit.council_today());
end $$;

create or replace function public.finance_net_by_year()
returns table (year integer, dues_cents bigint, hosting_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  return query select * from kit.finance_net_by_year_at(kit.council_today());
end $$;

create or replace function public.finance_follow_up()
returns table (
  member_id uuid, first_name text, last_name text, membership_number text,
  dues_status text, paid_through date, level_name text, amount_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  return query select * from kit.finance_follow_up_at(kit.council_today());
end $$;

create or replace function public.finance_payments_to_check()
returns table (
  payment_id uuid, created_at timestamptz, member_id uuid, member_name text,
  dues_level text, amount_cents integer, provider text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_dashboard();
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

create or replace function public.finance_collection_progress(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  perform kit.assert_fraternal_year(p_year);
  return kit.collection_progress_at(p_year, kit.council_today());
end $$;

create or replace function public.finance_renewals_forecast()
returns table (month date, members integer, cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  return query select * from kit.renewals_forecast_at(kit.council_today());
end $$;

create or replace function public.finance_forecast_members(p_month date)
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               paid_through date, level_name text, amount_cents integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := kit.council_today();
  v_first date := date_trunc('month', v_today)::date;
begin
  perform kit.assert_finance_dashboard();
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
  perform kit.assert_finance_dashboard();
  return query select * from kit.lapse_aging_at(kit.council_today());
end $$;

create or replace function public.finance_lapsed_members()
returns table (member_id uuid, first_name text, last_name text, membership_number text,
               days_unpaid integer, bucket text, level_name text, amount_cents integer, last_paid_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  return query select * from kit.lapsed_members_at(kit.council_today());
end $$;

create or replace function public.finance_retention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_dashboard();
  return kit.retention_at(kit.council_today());
end $$;

create or replace function public.dues_last_notices(p_member_ids uuid[])
returns table (member_id uuid, kind text, sent_at timestamptz, tracking text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_dashboard();
  return query
    select distinct on (n.member_id) n.member_id, n.kind::text, coalesce(n.sent_at, n.created_at), kit.dues_notice_tracking(n.id)
      from public.dues_notices n
     where n.member_id = any(p_member_ids)
     order by n.member_id, n.created_at desc;
end $$;
