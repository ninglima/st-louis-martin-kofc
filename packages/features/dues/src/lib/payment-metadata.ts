/**
 * The top-level key in `payments.metadata` that names the dues level a
 * payment buys. This is the contract between the TypeScript side and the
 * database:
 *
 * - `createPaymentAction` (`priceDues`) writes `{ [DUES_LEVEL_METADATA_KEY]:
 *   slug }` together with `amount = dues_levels.amount_cents`, in integer
 *   cents, and `payment_type = 'dues'`.
 * - The Postgres trigger function `kit.record_online_dues_period` reads
 *   `payments.metadata ->> 'dues_level'` and compares `payments.amount` to
 *   `dues_levels.amount_cents`. Its `comment on function` (migration
 *   `20260928130300_dues_payment_contract_comment`) points back here.
 *
 * Renaming this key means changing that trigger in a new migration, in the
 * same change. The contract is pinned by
 * `@kit/payments/src/server/dues-payment-contract.test.ts` and
 * `apps/portal/supabase/tests/dues_payment_contract.test.sql`.
 */
export const DUES_LEVEL_METADATA_KEY = 'dues_level';
