-- Extend the signup trigger function to assign the default role.
--
-- kit.new_user_created_setup() runs on every auth.users INSERT via the
-- on_auth_user_created trigger. It currently only creates the matching
-- public.accounts row. That part is preserved byte-for-byte below.
--
-- New: after creating the account, look up the role marked
-- public.roles.is_default and assign it via public.user_roles. Per the
-- design spec, having no default role configured (is_default cleared on
-- every role) is a legitimate state meaning signups intentionally get no
-- role until an admin assigns one -- so a missing default must never block
-- signup. The role-assignment step is additionally wrapped in its own
-- BEGIN/EXCEPTION block (an implicit subtransaction) so that ANY failure
-- there -- a race, a constraint violation, an unexpected schema state --
-- is swallowed and logged rather than propagating and aborting the whole
-- INSERT into auth.users. This is the most dangerous function in the
-- system: if it raises, every registration in the application fails, so
-- the new step must degrade to "no role assigned" (the same visible
-- outcome as the no-default-role case) rather than ever blocking account
-- creation.
create or replace function kit.new_user_created_setup() returns trigger
    language plpgsql
    security definer
    set
        search_path = '' as
$$
declare
    user_name          text;
    picture_url        text;
    v_default_role_id  uuid;
begin
    if new.raw_user_meta_data ->> 'name' is not null then
        user_name := new.raw_user_meta_data ->> 'name';

    end if;

    if user_name is null and new.email is not null then
        user_name := split_part(new.email, '@', 1);

    end if;

    if user_name is null then
        user_name := '';

    end if;

    if new.raw_user_meta_data ->> 'avatar_url' is not null then
        picture_url := new.raw_user_meta_data ->> 'avatar_url';
    else
        picture_url := null;
    end if;

    insert into public.accounts(id,
                                name,
                                picture_url,
                                email)
    values (new.id,
            user_name,
            picture_url,
            new.email);

    -- Assign the default role, if one is configured. Isolated in its own
    -- sub-transaction so any failure here (including "no default role
    -- exists", which is a valid configuration) can never block signup.
    begin
        select id
        into v_default_role_id
        from public.roles
        where is_default
        limit 1;

        if v_default_role_id is not null then
            insert into public.user_roles (user_id, role_id)
            values (new.id, v_default_role_id)
            on conflict (user_id) do nothing;
        end if;
    exception
        when others then
            raise warning
                'kit.new_user_created_setup: default role assignment skipped for user % due to %: %',
                new.id, sqlstate, sqlerrm;
    end;

    return new;

end;

$$;
