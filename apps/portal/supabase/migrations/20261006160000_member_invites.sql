-- Link a roster row to a login, and report whether those logins have
-- confirmed their email. The members table grants no UPDATE to the app
-- roles, so the link goes through a security definer function. Sign-in
-- status reads auth.users, which the signed-in role cannot see directly.

create or replace function public.member_link_sign_in(
  p_member_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not kit.has_permission('users', 'manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'unknown sign-in' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.members where id = p_member_id) then
    raise exception 'unknown member' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.members
    where user_id = p_user_id
      and id <> p_member_id
  ) then
    raise exception 'sign-in already belongs to another member'
      using errcode = 'P0001';
  end if;

  update public.members
     set user_id = p_user_id,
         updated_at = now()
   where id = p_member_id;
end $$;

revoke all on function public.member_link_sign_in(uuid, uuid) from public, anon;
grant execute on function public.member_link_sign_in(uuid, uuid) to authenticated;

create or replace function public.member_sign_in_status(p_user_ids uuid[])
returns table (user_id uuid, confirmed boolean)
language sql
security definer
set search_path = ''
stable
as $$
  select u.id, u.email_confirmed_at is not null
  from auth.users u
  where kit.has_permission('members', 'view')
    and u.id = any (coalesce(p_user_ids, array[]::uuid[]))
$$;

revoke all on function public.member_sign_in_status(uuid[]) from public, anon;
grant execute on function public.member_sign_in_status(uuid[]) to authenticated;
