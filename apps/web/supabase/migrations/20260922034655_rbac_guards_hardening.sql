-- Finding 1: flipping is_system to false on a system role must be rejected,
-- not just deleting or re-slugging it. Without this, an attacker can
-- UPDATE ... SET is_system = false (slug unchanged, so the old check passes)
-- then DELETE the now-unprotected row.
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

    if old.is_system and not new.is_system then
        raise exception 'System roles cannot be modified';
    end if;

    if old.is_system and new.slug <> old.slug then
        raise exception 'System role slug cannot be changed';
    end if;

    return new;
end;
$$;

-- Finding 2: banning the last active admin silently drops the active-admin
-- count to zero because kit.count_active_user_admins() excludes banned
-- users, but nothing previously fired on auth.users to check that.
create or replace function kit.prevent_admin_ban_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if kit.count_active_user_admins() = 0 then
        raise exception 'This change would leave no active administrator';
    end if;
    return new;
end;
$$;

create trigger prevent_admin_ban_lockout
    after update of banned_until on auth.users
    for each row execute function kit.prevent_admin_ban_lockout();

-- Finding 3: the lockout guards on user_roles/role_permissions were
-- "initially immediate", so a single transaction that removes the old
-- admin's row and adds a new admin's row in two statements fails on the
-- transient per-statement zero, even though it nets to one admin. Defer
-- the check to COMMIT.
drop trigger if exists prevent_admin_lockout_user_roles on public.user_roles;
drop trigger if exists prevent_admin_lockout_permissions on public.role_permissions;

create constraint trigger prevent_admin_lockout_user_roles
    after update or delete on public.user_roles
    deferrable initially deferred
    for each row execute function kit.prevent_admin_lockout();

create constraint trigger prevent_admin_lockout_permissions
    after update or delete on public.role_permissions
    deferrable initially deferred
    for each row execute function kit.prevent_admin_lockout();
