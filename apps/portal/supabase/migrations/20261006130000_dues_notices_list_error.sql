-- Surface send failures on the dues notices page: list returns the notice
-- error so officers can see why a send failed without webhook events.
-- CREATE OR REPLACE cannot change OUT columns, so drop first.

drop function if exists public.dues_notices_list(text, text, integer);

create function public.dues_notices_list(
  p_kind text default null,
  p_tracking text default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  member_id uuid,
  first_name text,
  last_name text,
  membership_number text,
  email text,
  kind text,
  cycle_date date,
  status text,
  tracking text,
  error text,
  sent_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kit.assert_finance_view();
  return query
    select * from (
      select n.id, n.member_id, m.first_name, m.last_name, m.membership_number, n.email,
             n.kind::text, n.cycle_date, n.status, kit.dues_notice_tracking(n.id) as tracking,
             n.error, n.sent_at, n.created_at
        from public.dues_notices n
        join public.members m on m.id = n.member_id
       where (p_kind is null or n.kind::text = p_kind)
    ) t
    where (p_tracking is null or t.tracking = p_tracking)
    order by t.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

revoke all on function public.dues_notices_list(text, text, integer) from public, anon;
grant execute on function public.dues_notices_list(text, text, integer) to authenticated;
