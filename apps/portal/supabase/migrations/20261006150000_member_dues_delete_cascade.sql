-- Deleting a member removes that member's dues periods and dues notices.
-- A direct delete of a dues period stays forbidden. Cascade deletes run
-- from an AFTER trigger, after the member row is already gone, which is
-- how the guard tells the two apart.

alter table public.dues_periods
  drop constraint if exists dues_periods_member_id_fkey;

alter table public.dues_periods
  add constraint dues_periods_member_id_fkey
    foreign key (member_id) references public.members (id) on delete cascade;

alter table public.dues_notices
  drop constraint if exists dues_notices_member_id_fkey;

alter table public.dues_notices
  add constraint dues_notices_member_id_fkey
    foreign key (member_id) references public.members (id) on delete cascade;

create or replace function kit.dues_periods_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.members where id = old.member_id) then
      return old;
    end if;
    raise exception 'dues periods cannot be deleted; void them instead';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided dues period cannot change';
  end if;
  if (new.id, new.member_id, new.level, new.amount_cents, new.method, new.check_number,
      new.received_on, new.period_start, new.period_end, new.payment_id, new.recorded_by, new.created_at)
     is distinct from
     (old.id, old.member_id, old.level, old.amount_cents, old.method, old.check_number,
      old.received_on, old.period_start, old.period_end, old.payment_id, old.recorded_by, old.created_at)
     or new.voided_at is null then
    raise exception 'dues periods are immutable; only voiding is allowed';
  end if;
  return new;
end $$;
