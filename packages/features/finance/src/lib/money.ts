const PLAIN = /^\d{1,7}(\.\d{1,2})?$/;
const GROUPED = /^\d{1,3}(,\d{3}){1,2}(\.\d{1,2})?$/;

/** The largest amount either pattern is allowed to produce: $9,999,999.99,
 * comfortably inside the `integer` column/RPC argument the cents value
 * eventually reaches. */
const MAX_CENTS = 999_999_999;

/** "$1,200.50" -> 120050. No floating point: whole and fractional parts are
 * read as integers. Returns null for anything that is not a plain dollar
 * amount, or one over $9,999,999.99 (MAX_CENTS), for either pattern. */
export function parseDollarsToCents(input: string): number | null {
  const raw = input.trim().replace(/^\$/, '');

  if (!PLAIN.test(raw) && !GROUPED.test(raw)) {
    return null;
  }

  const [whole, fraction = ''] = raw.replace(/,/g, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return cents <= MAX_CENTS ? cents : null;
}

/** 2550 -> "25.50", for pre-filling an amount input. */
export function centsToDollarsInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');

  return `${whole}.${fraction}`;
}
