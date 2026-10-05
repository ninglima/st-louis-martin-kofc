-- Dues model, part 3: online dues payments become ledger periods (from every
-- path that marks a payment succeeded), and the one-off paid-through load.

create or replace function kit.record_online_dues_period(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pay         public.payments;
  v_member      public.members;
  v_lvl         public.dues_levels;
  v_start       date;
  v_received_on date;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found or v_pay.payment_type <> 'dues' then return; end if;

  select * into v_member from public.members where user_id = v_pay.user_id for update;
  if not found then
    raise warning 'dues payment % has no linked member; no period recorded', p_payment_id;
    return;
  end if;

  -- Fix round 1 (C1): never trust the client's level or amount. metadata may
  -- be missing, null, or not an object (garbage from a client we don't
  -- control); the level must be an active row the member is actually
  -- allowed to buy online; and the charged amount must match that level's
  -- price exactly. Any failure skips silently (warning only, no exception --
  -- the trigger around this must never fail the payment status write) and
  -- leaves the payment for the FS to reconcile by hand.
  if coalesce(jsonb_typeof(v_pay.metadata), '') <> 'object' then
    raise warning 'dues payment % has no usable metadata; no period recorded', p_payment_id;
    return;
  end if;

  select * into v_lvl from public.dues_levels
   where slug = v_pay.metadata ->> 'dues_level' and active;
  if not found then
    raise warning 'dues payment % names an unknown or inactive dues level; no period recorded', p_payment_id;
    return;
  end if;

  if not (v_lvl.self_service
          or v_lvl.slug = v_member.dues_level
          or (v_lvl.slug = 'student' and v_member.is_student)) then
    raise warning 'dues payment % chose a level not available to this member; no period recorded', p_payment_id;
    return;
  end if;

  if v_pay.amount <> v_lvl.amount_cents then
    raise warning 'dues payment % amount % does not match % price %; no period recorded',
      p_payment_id, v_pay.amount, v_lvl.slug, v_lvl.amount_cents;
    return;
  end if;

  -- Fix round 1 (M2): the council's local date, not the session/UTC date --
  -- an evening Central-time payment must not land on the next calendar day.
  v_received_on := (now() at time zone 'America/Chicago')::date;
  -- Fix round 1 (M3): fallback kept deliberately. A member with neither an
  -- active period nor accepted_on (e.g. the roster import hasn't run yet)
  -- still gets a period, starting the day the payment was received.
  v_start := coalesce(kit.dues_next_period_start(v_member.id), v_received_on);

  insert into public.dues_periods
    (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
  values
    (v_member.id, v_lvl.slug, v_lvl.amount_cents, 'online', v_received_on, v_start, v_start + 365, v_pay.id)
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
    -- Fix round 1 (M1): a payment already refunded (out of band, or by a
    -- race between webhook deliveries) must never spawn a period even if a
    -- later event marks it succeeded. Task 7 covers making 'refunded'
    -- actually reachable from the webhooks; this guard is cheap regardless.
    if new.status = 'succeeded' and old.status is distinct from 'refunded' then
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

drop trigger if exists payments_dues_sync on public.payments;
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

  -- Fix round 1 (M6): a non-array payload fails clearly instead of tripping
  -- an opaque "cannot extract elements from an object" error mid-loop.
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

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
    -- Fix round 1 (M4): the level must be active; unlike the online-purchase
    -- guard (C1), the FS-driven load does not restrict by self_service or
    -- is_student -- the FS may load any active level for any member.
    v_level := coalesce(nullif(r ->> 'dues_level', ''), v_member.dues_level);
    if not exists (select 1 from public.dues_levels where slug = v_level and active) then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'unknown dues level');
      continue;
    end if;

    -- Fix round 1 (I1): a malformed or missing paid_through must skip just
    -- that row, not abort rows already applied earlier in the batch.
    -- Fix round 2 (N1): a value that parses as a date is not necessarily a
    -- sane calendar date -- 'infinity'/'today'/'epoch' all cast cleanly and
    -- would otherwise pay a member up forever or silently float with the
    -- clock, and a date near the type's lower bound (e.g. a BC year) casts
    -- fine but then overflows at `v_through - 365` below, which sits
    -- outside this sub-block and would abort the whole batch. Requiring a
    -- plain YYYY-MM-DD shape before the cast rejects all of those up front;
    -- the range check after the cast also catches implausible-but-valid
    -- dates (e.g. centuries out) that the shape check alone would allow.
    if (r ->> 'paid_through') !~ '^\d{4}-\d{2}-\d{2}$' then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'invalid date');
      continue;
    end if;
    begin
      v_through := (r ->> 'paid_through')::date;
    exception when others then
      v_through := null;
    end;
    if v_through is null or v_through not between date '2000-01-01' and current_date + 3650 then
      v_skipped := v_skipped || jsonb_build_object('membership_number', r ->> 'membership_number', 'reason', 'invalid date');
      continue;
    end if;

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
