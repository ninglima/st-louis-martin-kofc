-- Dues model, part 2: the FS write functions. All security definer, all gated
-- on finance.manage, all computing period_start and amount themselves.

create or replace function kit.assert_finance_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not kit.has_permission('finance', 'manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function kit.assert_finance_manage() from public, anon, authenticated;

create or replace function public.record_dues_payment(
  p_member_id uuid, p_level text, p_method public.dues_method,
  p_received_on date, p_check_number text default null)
returns public.dues_periods
language plpgsql security definer set search_path = '' as $$
declare
  v_level  public.dues_levels;
  v_start  date;
  v_row    public.dues_periods;
begin
  perform kit.assert_finance_manage();

  if p_method is null or p_method not in ('check', 'cash', 'waived') then
    raise exception 'the FS records only check, cash or waived dues';
  end if;

  if p_received_on is null or p_received_on > current_date then
    raise exception 'received date is required and cannot be in the future';
  end if;

  select * into v_level from public.dues_levels where slug = p_level and active;
  if not found then
    raise exception 'unknown dues level: %', p_level;
  end if;

  -- Serialise writers for this member so a double submission chains.
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    raise exception 'unknown member';
  end if;

  v_start := kit.dues_next_period_start(p_member_id);
  if v_start is null then
    raise exception 'set the member''s acceptance date before recording dues';
  end if;

  insert into public.dues_periods
    (member_id, level, amount_cents, method, check_number, received_on, period_start, period_end, recorded_by)
  values
    (p_member_id, p_level,
     case when p_method = 'waived' then 0 else v_level.amount_cents end,
     p_method,
     case when p_method = 'check' then nullif(btrim(p_check_number), '') end,
     p_received_on, v_start, v_start + 365, (select auth.uid()))
  returning * into v_row;

  update public.members set dues_level = p_level where id = p_member_id and dues_level <> p_level;

  return v_row;
end $$;

create or replace function public.void_dues_period(p_period_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'a reason is required to void a dues period';
  end if;
  update public.dues_periods
     set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
   where id = p_period_id and voided_at is null;
  if not found then
    raise exception 'dues period not found or already voided';
  end if;
end $$;

create or replace function public.set_member_accepted_on(p_member_id uuid, p_accepted_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();

  -- Lock the member row before checking for active periods, so a concurrent
  -- record_dues_payment either finishes and commits first (and this call
  -- then correctly sees its period) or blocks behind this transaction.
  -- Checking the periods before taking the lock let a racing insert land
  -- after the check passed, breaking the "locked once paid" rule.
  perform 1 from public.members where id = p_member_id for update;
  if not found then
    raise exception 'unknown member';
  end if;

  if exists (select 1 from public.dues_periods where member_id = p_member_id and voided_at is null) then
    raise exception 'the acceptance date cannot change once dues are recorded; void them first';
  end if;
  update public.members set accepted_on = p_accepted_on where id = p_member_id;
end $$;

create or replace function public.set_member_dues_level(p_member_id uuid, p_level text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  if not exists (select 1 from public.dues_levels where slug = p_level and active) then
    raise exception 'unknown dues level: %', p_level;
  end if;
  update public.members set dues_level = p_level where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

create or replace function public.set_member_student(p_member_id uuid, p_is_student boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  update public.members set is_student = p_is_student where id = p_member_id;
  if not found then raise exception 'unknown member'; end if;
end $$;

grant execute on function public.record_dues_payment(uuid, text, public.dues_method, date, text) to authenticated;
grant execute on function public.void_dues_period(uuid, text)          to authenticated;
grant execute on function public.set_member_accepted_on(uuid, date)    to authenticated;
grant execute on function public.set_member_dues_level(uuid, text)     to authenticated;
grant execute on function public.set_member_student(uuid, boolean)     to authenticated;
