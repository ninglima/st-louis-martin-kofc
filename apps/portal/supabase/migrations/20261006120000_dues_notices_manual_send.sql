-- Manual dues notice test send: finance.manage can claim live notices for
-- selected members (any timing kind, even outside the automatic window) and
-- list eligible members for the picker.

create or replace function kit.dues_notice_manual_base_at(p_today date)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  membership_number text,
  email text,
  cycle_date date,
  first_dues boolean,
  level_name text,
  amount_cents integer
)
language sql stable security definer set search_path = '' as $$
  select s.member_id, s.first_name, s.last_name, s.membership_number,
         nullif(btrim(m.primary_email, E' \t\r\n'), '') as email,
         coalesce(s.paid_through, m.accepted_on) as cycle_date,
         s.paid_through is null as first_dues,
         s.level_name, s.amount_cents
    from kit.member_dues_snapshot(p_today) s
    join public.members m on m.id = s.member_id
   where s.dues_level <> 'honorary'
     and not m.dues_notices_opt_out
     and not (s.paid_through is null and m.accepted_on > p_today)
     and coalesce(s.paid_through, m.accepted_on) is not null
     and nullif(btrim(m.primary_email, E' \t\r\n'), '') is not null;
$$;

revoke all on function kit.dues_notice_manual_base_at(date) from public, anon, authenticated;

create or replace function kit.dues_notices_manual_claim_at(
  p_kind text,
  p_member_ids uuid[],
  p_today date
)
returns table (
  notice_id uuid,
  member_id uuid,
  first_name text,
  email text,
  kind public.dues_notice_kind,
  cycle_date date,
  first_dues boolean,
  level_name text,
  amount_cents integer
)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_kind public.dues_notice_kind;
begin
  if p_kind is null or p_kind not in ('before_30', 'due_date', 'after_30') then
    raise exception 'unknown dues notice kind: %', coalesce(p_kind, '(none)');
  end if;
  v_kind := p_kind::public.dues_notice_kind;

  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    return;
  end if;

  return query
    with c as (
      select b.*
        from kit.dues_notice_manual_base_at(p_today) b
       where b.member_id = any(p_member_ids)
    ),
    ins as (
      insert into public.dues_notices (member_id, kind, cycle_date, email, mode, status, sent_at)
      select c.member_id, v_kind, c.cycle_date, c.email, 'live', 'pending', null
        from c
      on conflict (member_id, kind, cycle_date) where mode = 'live' do nothing
      returning id, member_id, kind, cycle_date, email
    )
    select ins.id, ins.member_id, c.first_name, ins.email, ins.kind, ins.cycle_date,
           c.first_dues, c.level_name, c.amount_cents
      from ins
      join c on c.member_id = ins.member_id and c.cycle_date = ins.cycle_date;
end $$;

revoke all on function kit.dues_notices_manual_claim_at(text, uuid[], date)
  from public, anon, authenticated;

create or replace function public.dues_notices_manual_claim(
  p_kind text,
  p_member_ids uuid[]
)
returns table (
  notice_id uuid,
  member_id uuid,
  first_name text,
  email text,
  kind public.dues_notice_kind,
  cycle_date date,
  first_dues boolean,
  level_name text,
  amount_cents integer
)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  return query
    select * from kit.dues_notices_manual_claim_at(
      p_kind, p_member_ids, kit.council_today()
    );
end $$;

revoke all on function public.dues_notices_manual_claim(text, uuid[])
  from public, anon;
grant execute on function public.dues_notices_manual_claim(text, uuid[])
  to authenticated;

create or replace function kit.dues_notices_manual_eligible_at(
  p_kind text,
  p_today date
)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  membership_number text,
  email text,
  cycle_date date,
  already_sent boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_kind public.dues_notice_kind;
begin
  if p_kind is null or p_kind not in ('before_30', 'due_date', 'after_30') then
    raise exception 'unknown dues notice kind: %', coalesce(p_kind, '(none)');
  end if;
  v_kind := p_kind::public.dues_notice_kind;

  return query
    select b.member_id, b.first_name, b.last_name, b.membership_number, b.email,
           b.cycle_date,
           exists (
             select 1 from public.dues_notices n
              where n.member_id = b.member_id
                and n.kind = v_kind
                and n.cycle_date = b.cycle_date
                and n.mode = 'live'
           ) as already_sent
      from kit.dues_notice_manual_base_at(p_today) b
     order by b.last_name, b.first_name, b.membership_number;
end $$;

revoke all on function kit.dues_notices_manual_eligible_at(text, date)
  from public, anon, authenticated;

create or replace function public.dues_notices_manual_eligible(p_kind text)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  membership_number text,
  email text,
  cycle_date date,
  already_sent boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kit.assert_finance_manage();
  return query
    select * from kit.dues_notices_manual_eligible_at(p_kind, kit.council_today());
end $$;

revoke all on function public.dues_notices_manual_eligible(text)
  from public, anon;
grant execute on function public.dues_notices_manual_eligible(text)
  to authenticated;
