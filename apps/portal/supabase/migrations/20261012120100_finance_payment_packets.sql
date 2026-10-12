create table public.finance_payment_packets (
  id             uuid primary key default extensions.uuid_generate_v4(),
  label          text not null,
  supreme_cents  integer,
  state_cents    integer,
  note           text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default clock_timestamp(),
  updated_at     timestamptz not null default clock_timestamp(),
  constraint finance_payment_packets_label_len
    check (char_length(btrim(label)) between 1 and 120),
  constraint finance_payment_packets_note_len
    check (note is null or char_length(note) <= 500),
  constraint finance_payment_packets_supreme_nonneg
    check (supreme_cents is null or supreme_cents >= 0),
  constraint finance_payment_packets_state_nonneg
    check (state_cents is null or state_cents >= 0),
  constraint finance_payment_packets_has_total
    check (supreme_cents is not null or state_cents is not null)
);

alter table public.finance_payment_packets enable row level security;
revoke all on public.finance_payment_packets from anon, authenticated;

create or replace function public.finance_payment_packet_save(
  p_id uuid,
  p_label text,
  p_supreme_cents integer,
  p_state_cents integer,
  p_note text
) returns public.finance_payment_packets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.finance_payment_packets;
  v_label text := btrim(coalesce(p_label, ''));
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform kit.assert_finance_dashboard();

  if v_label = '' then
    raise exception 'payment packet label is required' using errcode = 'P0001';
  end if;
  if char_length(v_label) > 120 then
    raise exception 'payment packet label is too long' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'payment packet note is too long' using errcode = 'P0001';
  end if;
  if p_supreme_cents is null and p_state_cents is null then
    raise exception 'payment packet needs a total' using errcode = 'P0001';
  end if;
  if coalesce(p_supreme_cents, 0) < 0 or coalesce(p_state_cents, 0) < 0 then
    raise exception 'payment packet total is negative' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.finance_payment_packets
      (label, supreme_cents, state_cents, note, created_by, created_at, updated_at)
    values
      (v_label, p_supreme_cents, p_state_cents, v_note, auth.uid(),
       clock_timestamp(), clock_timestamp())
    returning * into v_row;
  else
    update public.finance_payment_packets
       set label = v_label,
           supreme_cents = p_supreme_cents,
           state_cents = p_state_cents,
           note = v_note,
           updated_at = clock_timestamp()
     where id = p_id
     returning * into v_row;
    if not found then
      raise exception 'payment packet not found' using errcode = 'P0001';
    end if;
  end if;

  return v_row;
end $$;

create or replace function public.finance_payment_packet_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kit.assert_finance_dashboard();
  delete from public.finance_payment_packets where id = p_id;
  if not found then
    raise exception 'payment packet not found' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.finance_payment_packets()
returns setof public.finance_payment_packets
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kit.assert_finance_dashboard();
  return query
    select * from public.finance_payment_packets
     order by created_at desc, id desc;
end $$;

revoke all on function public.finance_payment_packet_save(uuid, text, integer, integer, text) from public, anon;
revoke all on function public.finance_payment_packet_delete(uuid) from public, anon;
revoke all on function public.finance_payment_packets() from public, anon;
grant execute on function public.finance_payment_packet_save(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.finance_payment_packet_delete(uuid) to authenticated;
grant execute on function public.finance_payment_packets() to authenticated;
