-- Event emails hardening: a newer change always carries the current state, so
-- older failed or in-flight changes are superseded; stuck `sending` rows expire
-- like pending ones; reminders never go out on the day itself or after an
-- opt-out.

create or replace function kit.enqueue_event_change(p_signup_ids uuid[], p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Same eligibility as the insert below: a signup whose unsent confirmation
  -- absorbs the change gets no new row, so its earlier rows stay as they are.
  update public.event_emails x set status = 'superseded', updated_at = now()
  where x.signup_id = any (coalesce(p_signup_ids, '{}'))
    and x.kind in ('update', 'cancel') and x.status in ('failed', 'sending')
    and not exists (select 1 from public.event_emails c
                     where c.signup_id = x.signup_id and c.kind = 'confirmation' and c.status in ('pending', 'failed'));

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

  -- Expire: pending/failed rows, and `sending` rows stuck for 10 minutes.
  update public.event_emails x set status = 'expired', updated_at = p_now
  from public.event_signups s join public.event_shifts sh on sh.id = s.shift_id
  where x.signup_id = s.id
    and (x.status in ('pending', 'failed')
         or (x.status = 'sending' and x.claimed_at < p_now - interval '10 minutes'))
    and ((x.kind <> 'cancel' and sh.starts_at <= p_now)
         or x.created_at < p_now - interval '72 hours'
         or (x.kind = 'reminder'
             and (x.reminder_for at time zone 'America/Chicago')::date <= (p_now at time zone 'America/Chicago')::date));

  -- A newer update/cancel carries the current state: older ones are obsolete.
  update public.event_emails x set status = 'superseded', updated_at = p_now
  where x.kind in ('update', 'cancel') and x.status in ('pending', 'failed', 'sending')
    and exists (select 1 from public.event_emails n
                 where n.signup_id = x.signup_id and n.kind in ('update', 'cancel') and n.sequence > x.sequence);

  for r in
    select x.id, x.kind, x.sequence, x.signup_id, s.status as signup_status, s.member_id,
           m.first_name, nullif(btrim(m.primary_email), '') as email, m.event_reminders_opt_out as opted_out,
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
    if (r.kind <> 'cancel' and r.signup_status <> 'signed_up')
       or (r.kind = 'cancel' and r.event_status = 'scheduled')
       or (r.kind = 'reminder' and r.opted_out) then
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

revoke all on function kit.enqueue_event_change(uuid[], text)                from public, anon, authenticated;
revoke all on function kit.event_emails_claim_at(text, integer, timestamptz) from public, anon, authenticated;
