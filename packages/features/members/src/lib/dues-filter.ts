import type { DuesStatus } from '@kit/dues/types';

/**
 * The five states `dues_status` can carry, plus the unset one for the
 * Select in `members-list.tsx`.
 *
 * Deliberately kept out of `members-list.tsx`: that component starts with
 * `'use client'`, and Next's RSC bundler treats *every* export of a client
 * module as a client reference -- including a plain, side-effect-free
 * function like `parseDuesFilter` used to be. `apps/portal/app/home/
 * members/page.tsx` is a Server Component that calls `parseDuesFilter`
 * directly while building the page's props, and calling a client reference
 * from server code throws ("Attempted to call parseDuesFilter() from the
 * server but parseDuesFilter is on the client. It's not possible to invoke
 * a client function from the server..."), taking `/home/members` down for
 * every caller with `finance.view` (the only ones who ever reach the
 * `parseDuesFilter` call). Living in a plain module instead, this is
 * importable from both the client component and the server page.
 */
export type DuesFilter = DuesStatus | 'all';

const DUES_FILTER_VALUES: DuesStatus[] = [
  'current',
  'due_soon',
  'due',
  'lapsed',
  'no_record',
];

/**
 * Validates an incoming `?dues=` value against the five real statuses,
 * falling back to `'all'` for anything else -- a typo'd or stale link must
 * read as "no filter", not as a crash or a silently narrowed roster.
 */
export function parseDuesFilter(value: string): DuesFilter {
  return (DUES_FILTER_VALUES as string[]).includes(value)
    ? (value as DuesStatus)
    : 'all';
}
