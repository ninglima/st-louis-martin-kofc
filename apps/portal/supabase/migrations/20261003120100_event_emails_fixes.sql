-- Event emails fixes: a change committed while a confirmation is mid-send is no
-- longer lost (only pending/failed confirmations, which are re-rendered from
-- current data, absorb a change), and event_email_status is deterministic.

-- A confirmation that is pending or failed is rendered from current data when
-- (re)claimed, so it absorbs the change. A sending one has already read its data.
create or replace function kit.enqueue_event_change(p_signup_ids uuid[], p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_emails (kind, signup_id, member_id, sequence)
  select case when p_kind = 'update' and e.status = 'cancelled' then 'cancel' else p_kind end,
         s.id, s.member_id,
         coalesce((select max(x.sequence) from public.event_emails x where x.signup_id = s.id), 0) + 1
  from public.event_signups s
  join public.event_shifts sh on sh.id = s.shift_id
  join public.events e on e.id = sh.event_id
  where s.id = any (coalesce(p_signup_ids, '{}'))
    and not exists (select 1 from public.event_emails c
                     where c.signup_id = s.id and c.kind = 'confirmation' and c.status in ('pending', 'failed'))
  on conflict (signup_id) where status = 'pending' and kind in ('update', 'cancel')
  do update set kind = excluded.kind, updated_at = now();
end $$;

create or replace function public.event_email_status(p_event_id uuid)
returns table (signup_id uuid, kind text, tracking text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not kit.can_take_attendance(p_event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select distinct on (x.signup_id) x.signup_id, x.kind, kit.event_email_tracking(x.id), coalesce(x.sent_at, x.updated_at)
  from public.event_emails x
  join public.event_signups s on s.id = x.signup_id
  join public.event_shifts sh on sh.id = s.shift_id
  where sh.event_id = p_event_id
    and x.status not in ('dry_run', 'superseded', 'expired')
  order by x.signup_id, x.created_at desc, x.updated_at desc, x.id desc;
end $$;

revoke all on function kit.enqueue_event_change(uuid[], text) from public, anon, authenticated;
revoke all on function public.event_email_status(uuid)        from public, anon;
grant execute on function public.event_email_status(uuid)       to authenticated;
