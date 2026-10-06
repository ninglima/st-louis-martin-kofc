-- Manual test sends must be repeatable: officers need to re-send the same
-- timing to the same member while debugging allowlist/Resend. The daily job
-- still uses once-only live claims; only the manual path replaces.

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

  -- Delete before insert (not the same WITH): modifying CTEs share one
  -- snapshot and cannot see each other's row changes, so a delete+insert
  -- in one statement would still hit the live unique index.
  delete from public.dues_notices n
   using kit.dues_notice_manual_base_at(p_today) c
   where n.member_id = c.member_id
     and c.member_id = any(p_member_ids)
     and n.kind = v_kind
     and n.cycle_date = c.cycle_date
     and n.mode = 'live';

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
      returning id, member_id, kind, cycle_date, email
    )
    select ins.id, ins.member_id, c.first_name, ins.email, ins.kind, ins.cycle_date,
           c.first_dues, c.level_name, c.amount_cents
      from ins
      join c on c.member_id = ins.member_id and c.cycle_date = ins.cycle_date;
end $$;

revoke all on function kit.dues_notices_manual_claim_at(text, uuid[], date)
  from public, anon, authenticated;
