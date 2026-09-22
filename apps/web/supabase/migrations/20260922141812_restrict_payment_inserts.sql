/*
 * -------------------------------------------------------
 * Restrict member-originated payment inserts
 * -------------------------------------------------------
 * The previous `payments_insert` policy only constrained `user_id`, so any
 * authenticated member could `POST /rest/v1/payments` directly (bypassing
 * `PaymentService.createPayment` entirely) and insert a row with, e.g.,
 * `status: 'succeeded'` and an arbitrary `provider_payment_id`, forging a
 * paid dues record with no charge ever occurring.
 *
 * `service_role` (used by the server actions in
 * `packages/features/payments/src/server/server-actions.ts` and the
 * webhook handler at `apps/web/app/api/webhooks/square/route.ts`) has
 * `BYPASSRLS` set on the Postgres role, so it is not evaluated against
 * `to authenticated` policies at all -- this change does not affect it.
 */

drop policy if exists payments_insert on public.payments;

create policy payments_insert on public.payments
    for insert to authenticated
    with check (
        user_id = (select auth.uid())
        -- A member-originated insert can only ever create the same
        -- pending placeholder row `PaymentService.createPayment` creates
        -- before a charge exists. A non-`pending` status, or a non-null
        -- `provider_payment_id`, can only legitimately come from the
        -- service-role path (server actions confirming/recording a real
        -- charge, or the webhook handler) -- never from a direct client
        -- insert.
        and status = 'pending'
        and provider_payment_id is null
    );
