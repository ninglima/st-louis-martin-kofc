-- user_roles.assigned_by has no ON DELETE action (default NO ACTION).
-- Hard-deleting any user who ever assigned a role to someone else fails with
-- an opaque FK violation -- including from the Supabase dashboard, which
-- hard-deletes auth.users rows directly. assigned_by is purely an audit
-- trail (who performed the assignment), not a referential requirement for
-- user_roles to make sense, so losing that attribution on delete is
-- acceptable; blocking the delete outright is not.
alter table public.user_roles
    drop constraint user_roles_assigned_by_fkey,
    add constraint user_roles_assigned_by_fkey
        foreign key (assigned_by) references auth.users (id)
        on delete set null;
