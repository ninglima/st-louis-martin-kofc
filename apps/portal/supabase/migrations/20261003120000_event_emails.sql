-- Volunteer events, piece 2: the event email outbox.
-- Spec: docs/superpowers/specs/2026-10-03-event-emails-design.md

alter table public.members add column event_reminders_opt_out boolean not null default false;

create table public.event_emails (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('confirmation', 'update', 'cancel', 'reminder')),
  signup_id       uuid not null references public.event_signups on delete cascade,
  member_id       uuid not null references public.members on delete cascade,
  sequence        integer not null default 0,
  reminder_for    timestamptz,
  mode            text check (mode in ('dry_run', 'live')),
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'dead', 'dry_run', 'superseded', 'expired', 'no_email')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz,
  claimed_at      timestamptz,
  email           text,
  resend_email_id text unique,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'reminder') = (reminder_for is not null)),
  check (kind <> 'reminder' or mode is not null)
);
create unique index event_emails_confirmation_uk on public.event_emails (signup_id) where kind = 'confirmation';
create unique index event_emails_pending_change_uk on public.event_emails (signup_id)
  where status = 'pending' and kind in ('update', 'cancel');
create unique index event_emails_reminder_uk on public.event_emails (signup_id, reminder_for, mode) where kind = 'reminder';
create index event_emails_queue_idx on public.event_emails (status, next_attempt_at);
create index event_emails_signup_idx on public.event_emails (signup_id, created_at desc);

create table public.event_email_events (
  id          uuid primary key default gen_random_uuid(),
  email_id    uuid not null references public.event_emails on delete cascade,
  type        text not null check (type in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'suppressed', 'failed', 'opened', 'clicked')),
  occurred_at timestamptz not null,
  svix_id     text not null unique,
  payload     jsonb not null
);
create index event_email_events_email_idx on public.event_email_events (email_id);

create table public.event_email_runs (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  mode       text not null check (mode in ('off', 'dry_run', 'live')),
  candidates integer not null default 0,
  sent       integer not null default 0,
  skipped    integer not null default 0,
  failed     integer not null default 0,
  error      text
);

alter table public.event_emails       enable row level security;
alter table public.event_email_events enable row level security;
alter table public.event_email_runs   enable row level security;
revoke all on public.event_emails, public.event_email_events, public.event_email_runs from anon, authenticated, service_role;
grant select, update on public.event_emails to service_role;
grant select, insert on public.event_email_events, public.event_email_runs to service_role;

create or replace function kit.event_emails_suppressed()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('kit.suppress_event_emails', true), '') = 'on'
$$;

-- One pending change row per sign-up; the latest change wins, and an update
-- queued for an event that is now cancelled is a cancel. Skips sign-ups whose
-- confirmation has not gone out yet: it is rendered from current data.
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
                     where c.signup_id = s.id and c.kind = 'confirmation' and c.status in ('pending', 'sending'))
  on conflict (signup_id) where status = 'pending' and kind in ('update', 'cancel')
  do update set kind = excluded.kind, updated_at = now();
end $$;

create or replace function kit.event_signups_email_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if kit.event_emails_suppressed() then return null; end if;
  if new.status = 'signed_up' and new.member_id = kit.my_member_id() then
    insert into public.event_emails (kind, signup_id, member_id, sequence)
    values ('confirmation', new.id, new.member_id, 0)
    on conflict do nothing;
  end if;
  return null;
end $$;

create or replace function kit.events_email_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_ids  uuid[];
begin
  if kit.event_emails_suppressed() then return null; end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'cancel';
  elsif new.status = 'scheduled'
        and (old.status is distinct from 'scheduled' or new.location is distinct from old.location) then
    v_kind := 'update';
  else
    return null;
  end if;
  select array_agg(s.id) into v_ids
  from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
  where sh.event_id = new.id and s.status = 'signed_up' and sh.starts_at > now();
  perform kit.enqueue_event_change(v_ids, v_kind);
  return null;
end $$;

create or replace function kit.event_shifts_email_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if kit.event_emails_suppressed() then return null; end if;
  if (select status from public.events where id = new.event_id) <> 'scheduled' then return null; end if;
  select array_agg(s.id) into v_ids
  from public.event_signups s
  where s.shift_id = new.id and s.status = 'signed_up' and new.starts_at > now();
  perform kit.enqueue_event_change(v_ids, 'update');
  return null;
end $$;

create trigger event_signups_email after insert on public.event_signups
  for each row execute function kit.event_signups_email_trg();
create trigger events_email after update of status, location on public.events
  for each row when (old.status is distinct from new.status or old.location is distinct from new.location)
  execute function kit.events_email_trg();
create trigger event_shifts_email after update of starts_at, ends_at on public.event_shifts
  for each row when (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
  execute function kit.event_shifts_email_trg();

create or replace function kit.event_emails_claim_at(p_mode text, p_limit integer, p_now timestamptz)
returns table (email_id uuid, kind text, sequence integer, mode text, signup_id uuid, event_id uuid,
               first_name text, email text, title text, location text, description text, event_status text,
               shift_starts_at timestamptz, shift_ends_at timestamptz, shift_label text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r record;
begin
  if p_mode is null or p_mode not in ('dry_run', 'live') then
    raise exception 'unknown mode';
  end if;

  update public.event_emails x set status = 'expired', updated_at = p_now
  from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
  where x.signup_id = s.id and x.status in ('pending', 'failed')
    and ((x.kind <> 'cancel' and sh.starts_at <= p_now) or x.created_at < p_now - interval '72 hours');

  for r in
    select x.id, x.kind, x.sequence, x.signup_id, s.status as signup_status, s.member_id,
           m.first_name, nullif(btrim(m.primary_email), '') as email,
           e.id as event_id, e.title, e.location, e.description, e.status::text as event_status,
           sh.starts_at, sh.ends_at, sh.label
    from public.event_emails x
    join public.event_signups s on s.id = x.signup_id
    join public.event_shifts sh on sh.id = s.shift_id
    join public.events e on e.id = sh.event_id
    join public.members m on m.id = s.member_id
    where (x.status = 'pending' and (x.kind <> 'reminder' or x.mode = p_mode))
       or (x.status = 'failed' and x.mode = p_mode and x.attempts < 3 and x.next_attempt_at <= p_now)
       or (x.status = 'sending' and x.mode = p_mode and x.claimed_at < p_now - interval '10 minutes')
    order by x.created_at
    limit greatest(coalesce(p_limit, 50), 0)
    for update of x skip locked
  loop
    if r.kind <> 'cancel' and r.signup_status <> 'signed_up' then
      update public.event_emails set status = 'superseded', updated_at = p_now where id = r.id;
      continue;
    end if;
    if r.email is null then
      update public.event_emails set status = 'no_email', updated_at = p_now where id = r.id;
      continue;
    end if;
    if p_mode = 'dry_run' then
      update public.event_emails
         set status = 'dry_run', mode = 'dry_run', email = r.email, claimed_at = p_now, sent_at = p_now, updated_at = p_now
       where id = r.id;
    else
      update public.event_emails
         set status = 'sending', mode = 'live', email = r.email, claimed_at = p_now,
             attempts = attempts + 1, updated_at = p_now
       where id = r.id;
    end if;
    email_id := r.id; kind := r.kind; sequence := r.sequence; mode := p_mode; signup_id := r.signup_id;
    event_id := r.event_id; first_name := r.first_name; email := r.email; title := r.title;
    location := r.location; description := r.description; event_status := r.event_status;
    shift_starts_at := r.starts_at; shift_ends_at := r.ends_at; shift_label := r.label;
    return next;
  end loop;
end $$;

create or replace function public.event_emails_claim(p_mode text, p_limit integer default 50)
returns table (email_id uuid, kind text, sequence integer, mode text, signup_id uuid, event_id uuid,
               first_name text, email text, title text, location text, description text, event_status text,
               shift_starts_at timestamptz, shift_ends_at timestamptz, shift_label text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query select * from kit.event_emails_claim_at(p_mode, p_limit, now());
end $$;

create or replace function kit.event_reminders_enqueue_at(p_mode text, p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if p_mode is null or p_mode not in ('dry_run', 'live') then
    raise exception 'unknown mode';
  end if;
  if kit.event_emails_suppressed() then return 0; end if;
  insert into public.event_emails (kind, signup_id, member_id, sequence, reminder_for, mode)
  select 'reminder', s.id, s.member_id, 0, sh.starts_at, p_mode
  from public.event_signups s
  join public.event_shifts sh on sh.id = s.shift_id
  join public.events e on e.id = sh.event_id
  join public.members m on m.id = s.member_id
  where s.status = 'signed_up' and e.status = 'scheduled'
    and (sh.starts_at at time zone 'America/Chicago')::date = p_today + 1
    and not m.event_reminders_opt_out
    and nullif(btrim(m.primary_email), '') is not null
  on conflict (signup_id, reminder_for, mode) where kind = 'reminder' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.event_reminders_enqueue(p_mode text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
begin
  return kit.event_reminders_enqueue_at(p_mode, kit.council_today());
end $$;

-- Same precedence as kit.dues_notice_tracking.
create or replace function kit.event_email_tracking(p_email_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'complained') then 'complained'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'bounced') then 'bounced'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'suppressed') then 'suppressed'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'clicked') then 'clicked'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'opened') then 'opened'
           when exists (select 1 from public.event_email_events v where v.email_id = x.id and v.type = 'delivered') then 'delivered'
           when x.status in ('failed', 'dead') then 'failed'
           when x.status in ('pending', 'sending') then 'pending'
           when x.status = 'no_email' then 'no_email'
           else 'sent'
         end
    from public.event_emails x
   where x.id = p_email_id
$$;

create or replace function public.event_email_status(p_event_id uuid)
returns table (signup_id uuid, kind text, tracking text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not kit.can_take_attendance(p_event_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select distinct on (x.signup_id) x.signup_id, x.kind, kit.event_email_tracking(x.id), coalesce(x.sent_at, x.created_at)
  from public.event_emails x
  join public.event_signups s on s.id = x.signup_id
  join public.event_shifts sh on sh.id = s.shift_id
  where sh.event_id = p_event_id
    and x.status not in ('dry_run', 'superseded', 'expired')
  order by x.signup_id, x.created_at desc;
end $$;

create or replace function public.my_event_reminders()
returns boolean language sql stable security definer set search_path = '' as $$
  select case when m.id is null then null else not m.event_reminders_opt_out end
  from (select kit.my_member_id() as id) me
  left join public.members m on m.id = me.id
$$;

create or replace function public.set_my_event_reminders(p_opt_out boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := kit.my_member_id();
begin
  if v_me is null then
    raise exception 'Your sign-in is not linked to a council member record.';
  end if;
  update public.members set event_reminders_opt_out = coalesce(p_opt_out, false) where id = v_me;
end $$;

revoke all on function kit.event_emails_suppressed()                         from public, anon, authenticated;
revoke all on function kit.enqueue_event_change(uuid[], text)                from public, anon, authenticated;
revoke all on function kit.event_signups_email_trg()                         from public, anon, authenticated;
revoke all on function kit.events_email_trg()                                from public, anon, authenticated;
revoke all on function kit.event_shifts_email_trg()                          from public, anon, authenticated;
revoke all on function kit.event_emails_claim_at(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function kit.event_reminders_enqueue_at(text, date)            from public, anon, authenticated;
revoke all on function kit.event_email_tracking(uuid)                        from public, anon, authenticated;

revoke all on function public.event_emails_claim(text, integer)  from public, anon, authenticated;
revoke all on function public.event_reminders_enqueue(text)      from public, anon, authenticated;
grant execute on function public.event_emails_claim(text, integer) to service_role;
grant execute on function public.event_reminders_enqueue(text)     to service_role;

revoke all on function public.event_email_status(uuid)         from public, anon;
revoke all on function public.my_event_reminders()             from public, anon;
revoke all on function public.set_my_event_reminders(boolean)  from public, anon;
grant execute on function public.event_email_status(uuid)        to authenticated;
grant execute on function public.my_event_reminders()            to authenticated;
grant execute on function public.set_my_event_reminders(boolean) to authenticated;
