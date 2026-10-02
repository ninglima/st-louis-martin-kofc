-- A dues payment is judged against its level as it was when the payment was
-- CREATED, not as it is when it succeeds. Bank payments stay processing for
-- days; without this, a price change or a retirement in that window would
-- leave the member's money received but no dues period recorded.

-- The level's row as of p_at: the `before` of its earliest change after p_at,
-- else the current row. Fields are all null when the level is unknown.
create or replace function kit.dues_level_as_of(p_slug text, p_at timestamptz)
returns public.dues_levels language plpgsql stable security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_level  public.dues_levels;
begin
  select c.before into v_before
    from public.dues_level_changes c
   where c.level = p_slug and c.changed_at > p_at and c.before is not null
   order by c.changed_at, c.id
   limit 1;

  if v_before is not null then
    return jsonb_populate_record(null::public.dues_levels, v_before);
  end if;

  select * into v_level from public.dues_levels where slug = p_slug;
  return v_level;
end $$;
revoke all on function kit.dues_level_as_of(text, timestamptz) from public, anon, authenticated;

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

  -- Never trust the client's level or amount (fix round 1, C1), now judged
  -- as of the payment's creation (20261004120100).
  if coalesce(jsonb_typeof(v_pay.metadata), '') <> 'object' then
    raise warning 'dues payment % has no usable metadata; no period recorded', p_payment_id;
    return;
  end if;

  v_lvl := kit.dues_level_as_of(v_pay.metadata ->> 'dues_level', v_pay.created_at);
  if v_lvl.slug is null or not v_lvl.active then
    raise warning 'dues payment % names an unknown or inactive dues level; no period recorded', p_payment_id;
    return;
  end if;

  if not (v_lvl.self_service
          or v_lvl.slug = v_member.dues_level
          or (v_lvl.slug = 'student' and v_member.is_student)
          or exists (select 1 from public.dues_level_changes c
                      where c.level = v_lvl.slug and c.action = 'retire'
                        and c.changed_at > v_pay.created_at
                        and v_member.id = any (c.moved_member_ids))) then
    raise warning 'dues payment % chose a level not available to this member; no period recorded', p_payment_id;
    return;
  end if;

  if v_pay.amount <> v_lvl.amount_cents then
    raise warning 'dues payment % amount % does not match % price %; no period recorded',
      p_payment_id, v_pay.amount, v_lvl.slug, v_lvl.amount_cents;
    return;
  end if;

  v_received_on := (now() at time zone 'America/Chicago')::date;
  v_start := coalesce(kit.dues_next_period_start(v_member.id), v_received_on);

  insert into public.dues_periods
    (member_id, level, amount_cents, method, received_on, period_start, period_end, payment_id)
  values
    (v_member.id, v_lvl.slug, v_lvl.amount_cents, 'online', v_received_on, v_start, v_start + 365, v_pay.id)
  on conflict (payment_id) do nothing;
end $$;
revoke all on function kit.record_online_dues_period(uuid) from public, anon, authenticated;
