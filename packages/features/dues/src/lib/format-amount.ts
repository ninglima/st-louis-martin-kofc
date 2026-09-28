/** `5800` -> `"$58.00"`. Shared by every place a dues amount reaches the
 * screen, so a level's price reads the same in the record-payment form, the
 * dues card's header and its ledger table. */
export function formatAmountCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
