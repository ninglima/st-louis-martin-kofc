-- Count users who can still manage users, excluding banned accounts.
create or replace function kit.count_active_user_admins()
returns integer
language sql
security definer
set search_path = ''
stable
as $$
    select count(*)::integer
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join auth.users u on u.id = ur.user_id
    where rp.section = 'users'
      and rp.can_manage
      and (u.banned_until is null or u.banned_until < now());
$$;

-- System roles cannot be deleted or re-slugged.
create or replace function kit.protect_system_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        if old.is_system then
            raise exception 'System roles cannot be deleted';
        end if;
        return old;
    end if;

    if old.is_system and new.slug <> old.slug then
        raise exception 'System role slug cannot be changed';
    end if;

    return new;
end;
$$;

create trigger protect_system_roles
    before update or delete on public.roles
    for each row execute function kit.protect_system_roles();

-- Any change that would leave zero active users.manage holders is rejected.
create or replace function kit.prevent_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if kit.count_active_user_admins() = 0 then
        raise exception 'This change would leave no active administrator';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

-- AFTER triggers: the count must be evaluated post-change.
create constraint trigger prevent_admin_lockout_user_roles
    after update or delete on public.user_roles
    deferrable initially immediate
    for each row execute function kit.prevent_admin_lockout();

create constraint trigger prevent_admin_lockout_permissions
    after update or delete on public.role_permissions
    deferrable initially immediate
    for each row execute function kit.prevent_admin_lockout();
