-- Members can no longer insert payments rows directly.
--
-- `20260922141812_restrict_payment_inserts` narrowed the member insert to a
-- `pending` row with no `provider_payment_id`, but it still let
-- `POST /rest/v1/payments` create a row with ANY amount. The row could then
-- be charged through `confirmSquarePaymentAction`, bypassing the $0.50 floor
-- `createPaymentAction` enforces (a card-testing vector).
--
-- No app path needs the grant. `PaymentService.createPayment`, the only
-- writer of `payments` and `payment_items`, runs on the service-role admin
-- client (`createPaymentAction`). `service_role` keeps its grants and
-- bypasses RLS, so this does not affect it.
--
-- Additive: an older portal build writes through the same service-role path.

drop policy if exists payments_insert on public.payments;
drop policy if exists payment_items_insert on public.payment_items;

revoke insert on public.payments      from anon, authenticated;
revoke insert on public.payment_items from anon, authenticated;
