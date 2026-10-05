-- Roles
create table if not exists public.roles (
    id          uuid primary key default extensions.uuid_generate_v4(),
    slug        text unique not null,
    name        text not null,
    description text,
    is_system   boolean not null default false,
    is_default  boolean not null default false,
    created_at  timestamp with time zone default now(),
    updated_at  timestamp with time zone default now()
);

comment on table public.roles is 'Assignable roles; is_system roles are protected from deletion';

-- At most one default role
create unique index roles_single_default_idx
    on public.roles (is_default) where is_default;

create table if not exists public.role_permissions (
    role_id    uuid not null references public.roles on delete cascade,
    section    text not null,
    can_view   boolean not null default false,
    can_manage boolean not null default false,
    primary key (role_id, section)
);

create table if not exists public.user_roles (
    user_id     uuid primary key references auth.users on delete cascade,
    role_id     uuid not null references public.roles on delete restrict,
    assigned_at timestamp with time zone default now(),
    assigned_by uuid references auth.users
);

alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;

-- Permission oracle. security definer so it can read the tables above
-- without their own RLS policies recursing.
create or replace function kit.has_permission(p_section text, p_verb text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
    select exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        where ur.user_id = (select auth.uid())
          and rp.section = p_section
          and case p_verb
                when 'manage' then rp.can_manage
                when 'view'   then rp.can_view or rp.can_manage
                else false
              end
    );
$$;

grant execute on function kit.has_permission(text, text) to authenticated, service_role;

-- RLS: anyone signed in may read roles (needed to render their own nav);
-- only users.manage may write.
create policy roles_select on public.roles
    for select to authenticated using (true);

create policy roles_write on public.roles
    for all to authenticated
    using (kit.has_permission('roles', 'manage'))
    with check (kit.has_permission('roles', 'manage'));

create policy role_permissions_select on public.role_permissions
    for select to authenticated using (true);

create policy role_permissions_write on public.role_permissions
    for all to authenticated
    using (kit.has_permission('roles', 'manage'))
    with check (kit.has_permission('roles', 'manage'));

-- Users see their own assignment; users.view sees all.
create policy user_roles_select on public.user_roles
    for select to authenticated
    using (user_id = (select auth.uid()) or kit.has_permission('users', 'view'));

create policy user_roles_write on public.user_roles
    for all to authenticated
    using (kit.has_permission('users', 'manage'))
    with check (kit.has_permission('users', 'manage'));

revoke all on public.roles, public.role_permissions, public.user_roles
    from authenticated, service_role;
grant select on public.roles, public.role_permissions, public.user_roles to authenticated;
grant insert, update, delete on public.roles, public.role_permissions, public.user_roles to authenticated;
grant all on public.roles, public.role_permissions, public.user_roles to service_role;

create index user_roles_role_id_idx        on public.user_roles (role_id);
create index role_permissions_role_id_idx  on public.role_permissions (role_id);

-- Seed system roles
insert into public.roles (slug, name, description, is_system, is_default)
values
    ('administrator', 'Administrator', 'Full access to every section', true, false),
    ('member',        'Member',        'Standard council member',      true, true)
on conflict (slug) do nothing;

-- Administrator: view + manage on everything
insert into public.role_permissions (role_id, section, can_view, can_manage)
select r.id, s.section, true, true
from public.roles r
cross join (values ('home'), ('payments'), ('checkout'),
                   ('payment_settings'), ('users'), ('roles')) as s(section)
where r.slug = 'administrator'
on conflict (role_id, section) do nothing;

-- Member: view-only on the member-facing sections
insert into public.role_permissions (role_id, section, can_view, can_manage)
select r.id, s.section, true, false
from public.roles r
cross join (values ('home'), ('payments'), ('checkout')) as s(section)
where r.slug = 'member'
on conflict (role_id, section) do nothing;

-- Backfill: every existing admin becomes an Administrator
insert into public.user_roles (user_id, role_id)
select au.user_id, r.id
from public.admin_users au
cross join public.roles r
where r.slug = 'administrator'
on conflict (user_id) do nothing;
