-- payment_config: gated by payment_settings.manage
drop policy if exists payment_config_select on public.payment_config;
drop policy if exists payment_config_update on public.payment_config;

create policy payment_config_select on public.payment_config
    for select to authenticated
    using (kit.has_permission('payment_settings', 'manage'));

create policy payment_config_update on public.payment_config
    for update to authenticated
    using (kit.has_permission('payment_settings', 'manage'))
    with check (kit.has_permission('payment_settings', 'manage'));

-- payments: own rows always; all rows with payments.manage
drop policy if exists payments_select_own on public.payments;

create policy payments_select_own on public.payments
    for select to authenticated
    using (
        user_id = (select auth.uid())
        or kit.has_permission('payments', 'manage')
    );

-- payment_items mirrors parent payment visibility
drop policy if exists payment_items_select on public.payment_items;

create policy payment_items_select on public.payment_items
    for select to authenticated
    using (
        exists (
            select 1 from public.payments p
            where p.id = payment_id
              and (
                p.user_id = (select auth.uid())
                or kit.has_permission('payments', 'manage')
              )
        )
    );

-- Remove the legacy system. Backfill already happened in the first migration.
-- Table dropped before function: admin_users_select policy depends on
-- kit.is_admin(), and dropping the table removes that policy along with it.
drop table if exists public.admin_users;
drop function if exists kit.is_admin();
