/*
 * -------------------------------------------------------
 * Payments Schema
 * Admin users, payment configuration, payment records
 * -------------------------------------------------------
 */

-- Admin users table
create table if not exists public.admin_users (
    user_id uuid not null references auth.users on delete cascade,
    created_at timestamp with time zone default now(),
    primary key (user_id)
);

comment on table public.admin_users is 'Registry of admin users who can manage payment settings';

alter table public.admin_users enable row level security;

-- Helper function to check admin status
create or replace function kit.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
    select exists (
        select 1 from public.admin_users
        where user_id = (select auth.uid())
    );
$$;

grant execute on function kit.is_admin() to authenticated, service_role;

-- Admin users RLS: only admins can see admin list
create policy admin_users_select on public.admin_users
    for select to authenticated
    using (kit.is_admin());

-- Only service_role can insert/update/delete admin_users (via migrations or admin scripts)
revoke all on public.admin_users from authenticated, service_role;
grant select on public.admin_users to authenticated, service_role;
grant insert, update, delete on public.admin_users to service_role;

-- Payment config table (singleton)
create table if not exists public.payment_config (
    id int generated always as identity primary key,
    active_provider text not null default 'square' check (active_provider in ('stripe', 'square')),
    stripe_publishable_key text,
    stripe_secret_key text,
    stripe_webhook_secret text,
    square_application_id text,
    square_access_token text,
    square_location_id text,
    square_webhook_signature_key text,
    environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
    updated_at timestamp with time zone default now(),
    updated_by uuid references auth.users,
    constraint single_row check (id = 1)
);

comment on table public.payment_config is 'Singleton payment provider configuration';

alter table public.payment_config enable row level security;

-- Seed the singleton row
insert into public.payment_config (active_provider, environment)
values ('square', 'sandbox')
on conflict do nothing;

-- Payment config RLS: admin-only
create policy payment_config_select on public.payment_config
    for select to authenticated
    using (kit.is_admin());

create policy payment_config_update on public.payment_config
    for update to authenticated
    using (kit.is_admin())
    with check (kit.is_admin());

revoke all on public.payment_config from authenticated, service_role;
grant select, update on public.payment_config to authenticated;
grant all on public.payment_config to service_role;

-- Payment type enum
create type public.payment_type as enum ('dues', 'donation', 'event_fee');

-- Payment status enum
create type public.payment_status as enum ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled');

-- Payments table
create table if not exists public.payments (
    id uuid not null default extensions.uuid_generate_v4() primary key,
    user_id uuid not null references auth.users on delete cascade,
    provider text not null check (provider in ('stripe', 'square')),
    provider_payment_id text,
    amount integer not null check (amount > 0),
    currency text not null default 'usd',
    status public.payment_status not null default 'pending',
    payment_type public.payment_type not null,
    description text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

comment on table public.payments is 'Payment transaction records';

alter table public.payments enable row level security;

-- Users read own payments, admins read all
create policy payments_select_own on public.payments
    for select to authenticated
    using (
        user_id = (select auth.uid()) or kit.is_admin()
    );

-- Authenticated users can insert payments
create policy payments_insert on public.payments
    for insert to authenticated
    with check (user_id = (select auth.uid()));

-- Only service_role can update (webhooks)
revoke all on public.payments from authenticated, service_role;
grant select, insert on public.payments to authenticated;
grant all on public.payments to service_role;

-- Payment items table
create table if not exists public.payment_items (
    id uuid not null default extensions.uuid_generate_v4() primary key,
    payment_id uuid not null references public.payments on delete cascade,
    item_type text not null,
    description text not null,
    amount integer not null check (amount > 0),
    created_at timestamp with time zone default now()
);

comment on table public.payment_items is 'Line items for each payment';

alter table public.payment_items enable row level security;

-- Mirror parent payment visibility
create policy payment_items_select on public.payment_items
    for select to authenticated
    using (
        exists (
            select 1 from public.payments p
            where p.id = payment_id
            and (p.user_id = (select auth.uid()) or kit.is_admin())
        )
    );

create policy payment_items_insert on public.payment_items
    for insert to authenticated
    with check (
        exists (
            select 1 from public.payments p
            where p.id = payment_id
            and p.user_id = (select auth.uid())
        )
    );

revoke all on public.payment_items from authenticated, service_role;
grant select, insert on public.payment_items to authenticated;
grant all on public.payment_items to service_role;

-- Index for common queries
create index payments_user_id_idx on public.payments (user_id);
create index payments_status_idx on public.payments (status);
create index payments_created_at_idx on public.payments (created_at desc);
create index payment_items_payment_id_idx on public.payment_items (payment_id);
