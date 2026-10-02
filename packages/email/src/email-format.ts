/**
 * A conservative format check (one `@`, a dot in the domain, no whitespace
 * or list separators). Resend's batch endpoint rejects the whole request when
 * any one address is invalid, so a single bad roster value (`john@gmail`,
 * `a@b.com; c@d.com`) would otherwise fail every email in its batch.
 */
const EMAIL_FORMAT = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>.]+$/;

export function isPlausibleEmail(email: string): boolean {
  return EMAIL_FORMAT.test(email);
}
