-- Dues model, part 3: online dues payments become ledger periods (from every
-- path that marks a payment succeeded), and the one-off paid-through load.

create or replace function kit.record_online_dues_period(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pay    public.payments;
  v_member public.members;
  v_level  text;
  v_start  date;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found or v_pay.payment_type <> 'dues' then return; end if;

  select * into v_member from public.members where user_id = v_pay.user_id for update;
  if not found then
    raise warning 'dues payment % has no linked member; no period recorded', p_payment_id;
    return;
  end if;

  v_level := coalesce(v_pay.metadata ->> 'dues_level', v_member.dues_level);
  if not exists (select 1 from public.dues_levels where slug = v_level) then
    v_level := v_member.dues_level;
  end if;

  v_start := coalesce(kit.dues_next_period_start(v_member.id), v_pay.created_at::date);

  insert into public.dues_periods
    (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
  values
    (v_member.id, v_level, v_pay.amount, 'online', v_pay.updated_at::date, v_start, v_start + 365, v_pay.id)
  on conflict (payment_id) do nothing;
end $$;
revoke all on function kit.record_online_dues_period(uuid) from public, anon, authenticated;

create or replace function kit.payments_dues_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_type <> 'dues' or new.status is not distinct from old.status then
    return new;
  end if;
  begin
    if new.status = 'succeeded' then
      perform kit.record_online_dues_period(new.id);
    elsif new.status = 'refunded' then
      update public.dues_periods
         set voided_at = now(), void_reason = 'payment refunded'
       where payment_id = new.id and voided_at is null;
    end if;
  exception when others then
    -- Never fail the payment status write (webhooks retry on error, and a
    -- stuck status is worse than a missing period the FS can record).
    raise warning 'dues sync failed for payment %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function kit.payments_dues_sync() from public, anon, authenticated;

create trigger payments_dues_sync
  after update of status on public.payments
  for each row execute function kit.payments_dues_sync();

create or replace function public.dues_opening_balances_apply(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r         jsonb;
  v_member  public.members;
  v_through date;
  v_level   text;
  v_applied int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform kit.assert_finance_manage();

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into v_member from public.members
     where membership_number = r ->> 'membership_number' for update;
    if not found then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'unknown membership number');
      continue;
    end if;
    if exists (select 1 from public.dues_periods where member_id = v_member.id and voided_at is null) then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'already has dues recorded');
      continue;
    end if;
    v_level := coalesce(nullif(r ->> 'dues_level', ''), v_member.dues_level);
    if not exists (select 1 from public.dues_levels where slug = v_level) then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'unknown dues level');
      continue;
    end if;
    v_through := (r ->> 'paid_through')::date;

    insert into public.dues_periods
      (member_id, level, amount_cents, method, received_on, period_start, period_end, recorded_by)
    values
      (v_member.id, v_level, 0, 'opening_balance', current_date, v_through - 365, v_through, (select auth.uid()));
    update public.members set dues_level = v_level where id = v_member.id and dues_level <> v_level;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end $$;

grant execute on function public.dues_opening_balances_apply(jsonb) to authenticated;
