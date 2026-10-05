-- Dues status uses the council's local date (America/Chicago), not the
-- database date (UTC). Final review M1.
--
-- The database runs in UTC, so `current_date` turns over at 6-7 pm Central.
-- Between then and midnight, a member whose (exclusive) paid-through is
-- tomorrow in Chicago already read as "lapsed", and the 90-day "due soon"
-- edge moved a day early the same way. The online trigger, the CSV load and
-- the forms already use the Chicago date. This brings the status in line.
--
-- Same signatures (create or replace), so grants and generated types are
-- unchanged:
-- - `kit.dues_status`: the DEFAULT of `p_today` becomes the Chicago date,
--   for any caller that leaves it out.
-- - `member_dues_summary` / `my_dues_summary`: pass the Chicago date
--   explicitly rather than relying on that default.

create or replace function kit.dues_status(
  p_paid_through date,
  p_accepted_on date,
  p_today date default (now() at time zone 'America/Chicago')::date
)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_paid_through is null and p_accepted_on is null then 'no_record'
    when p_paid_through is null then 'due'
    when p_paid_through <= p_today then 'lapsed'
    when p_paid_through <= p_today + 90 then 'due_soon'
    else 'current'
  end;
$$;

create or replace function public.member_dues_summary(p_member_ids uuid[])
returns table (
  member_id uuid, dues_level text, level_name text, amount_cents integer,
  accepted_on date, is_student boolean, paid_through date, dues_status text
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.dues_level, l.name, l.amount_cents, m.accepted_on, m.is_student,
         kit.dues_paid_through(m.id),
         kit.dues_status(kit.dues_paid_through(m.id), m.accepted_on,
                         (now() at time zone 'America/Chicago')::date)
  from public.members m
  join public.dues_levels l on l.slug = m.dues_level
  where m.id = any(p_member_ids)
    and kit.has_permission('finance', 'view');
$$;

create or replace function public.my_dues_summary()
returns table (
  member_id uuid, dues_level text, level_name text, amount_cents integer,
  accepted_on date, is_student boolean, paid_through date, dues_status text
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.dues_level, l.name, l.amount_cents, m.accepted_on, m.is_student,
         kit.dues_paid_through(m.id),
         kit.dues_status(kit.dues_paid_through(m.id), m.accepted_on,
                         (now() at time zone 'America/Chicago')::date)
  from public.members m
  join public.dues_levels l on l.slug = m.dues_level
  where m.user_id = (select auth.uid());
$$;
