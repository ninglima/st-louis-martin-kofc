'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import { exportMembersAction } from '../server/members-actions';
import type { MemberListRow } from '../server/members.service';

/**
 * Long enough that typing "Smith" is one request rather than five, short
 * enough that the list feels like it is following along.
 */
const DEBOUNCE_MS = 300;

/**
 * The table primitive sets `whitespace-nowrap` on every cell, which would push
 * the right-hand columns off a narrow screen rather than wrapping. The long,
 * free-text columns are allowed to wrap; the short ones keep their single line.
 */
const WRAP = 'whitespace-normal break-words';

function formatLastSeen(value: string | null) {
  if (value === null) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}

function cityLine(member: MemberListRow) {
  const parts = [member.city, member.state].filter(
    (part): part is string => part !== null && part !== '',
  );

  return parts.length === 0 ? '—' : parts.join(', ');
}

/** The three states of the account filter, as they read in the address bar. */
export type AccountFilter = 'all' | 'yes' | 'no';

const ACCOUNT_LABELS: Record<AccountFilter, string> = {
  all: 'Any account status',
  yes: 'Has a sign-in',
  no: 'No account',
};

/**
 * The sentinel the city Select uses for "no filter".
 *
 * A Select item cannot carry the empty string as its value -- Base UI reads
 * that as "nothing is selected" and the trigger falls back to its placeholder
 * while the URL still says otherwise. So the two states are kept apart
 * explicitly, and translated at the edge where the href is built.
 */
const ANY_CITY = '__any__';

export function MembersList({
  members,
  search,
  city,
  account,
  cities,
  page,
  pageSize,
  hasMore,
}: {
  members: MemberListRow[];
  /** The committed term, straight off the URL — never the keystroke in flight. */
  search: string;
  /** The committed city, or '' for every city. */
  city: string;
  account: AccountFilter;
  /** Every city on the roster, not just the ones on this page. */
  cities: string[];
  /** 1-based, as it reads in the address bar. */
  page: number;
  pageSize: number;
  hasMore: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [term, setTerm] = useState(search);
  const [navigating, startNavigation] = useTransition();
  const [exporting, startExport] = useTransition();

  /**
   * The last term this component asked the server for. It is what keeps the
   * two effects below from fighting: a change the user typed differs from it
   * (so it is debounced and committed), whereas a change that arrived from the
   * address bar — the back button — does not, so it resets the input instead
   * of being pushed straight back out again.
   */
  const committed = useRef(search);

  useEffect(() => {
    if (committed.current === search) return;

    committed.current = search;
    setTerm(search);
  }, [search]);

  useEffect(() => {
    if (term === committed.current) return;

    const timer = setTimeout(() => {
      committed.current = term;

      // Back to page 1: page 4 of "Smith" is almost never a page that exists,
      // and an empty page reads as "no such member".
      startNavigation(() => {
        router.replace(hrefFor(pathname, { search: term, city, account }, 1), {
          scroll: false,
        });
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, city, account, router, pathname]);

  // Both filters commit immediately -- there is no half-typed state to wait
  // for, and a debounce on a Select only makes the screen feel broken. Page 1
  // for the same reason the search does it.
  const navigateTo = (next: Partial<Criteria>) => {
    startNavigation(() => {
      router.replace(
        hrefFor(pathname, { search: term, city, account, ...next }, 1),
        { scroll: false },
      );
    });
  };

  const onExport = () => {
    startExport(async () => {
      const result = await exportMembersAction({
        // The set on screen, filters and all: an officer who narrowed the list
        // to one city and pressed Export means that city.
        search: search || null,
        city: city || null,
        hasAccount: account === 'all' ? null : account === 'yes',
      });

      if (!result.success) {
        toast.error(result.error);

        return;
      }

      download(result.filename, result.csv);

      if (result.truncated) {
        toast.warning(
          'That export hit its row limit, so the file is incomplete. Narrow the search and try again.',
        );
      } else {
        toast.success(`Downloaded ${result.filename}.`);
      }
    });
  };

  const first = members.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = (page - 1) * pageSize + members.length;

  return (
    <div className="flex w-full flex-col gap-y-4" data-test="members-list">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="members-search">Search the roster</Label>

            <Input
              id="members-search"
              data-test="members-search"
              className="w-72"
              placeholder="Name, member number or email"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="members-city">City</Label>

            {/*
              Controlled with `value`, never `defaultValue`: the URL is the
              truth here, and a default-only control drifts away from it the
              moment the officer presses the back button.
            */}
            <Select
              value={city === '' ? ANY_CITY : city}
              onValueChange={(next) =>
                navigateTo({ city: next === ANY_CITY ? '' : String(next) })
              }
            >
              <SelectTrigger
                id="members-city"
                data-test="members-city"
                className="w-48"
              >
                {/*
                  With no child, `SelectValue` renders the raw value -- the
                  trigger would read `__any__`. The sentinel is an
                  implementation detail of this control and must not reach the
                  officer.
                */}
                <SelectValue>
                  {(value: string | null) =>
                    value === null || value === ANY_CITY ? 'Every city' : value
                  }
                </SelectValue>
              </SelectTrigger>

              <SelectContent>
                <SelectItem value={ANY_CITY}>Every city</SelectItem>

                {cities.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="members-account">Account</Label>

            <Select
              value={account}
              onValueChange={(next) =>
                navigateTo({ account: next as AccountFilter })
              }
            >
              <SelectTrigger
                id="members-account"
                data-test="members-account"
                className="w-48"
              >
                {/* Likewise: the trigger must say "Has a sign-in", not "yes". */}
                <SelectValue>
                  {(value: string | null) =>
                    ACCOUNT_LABELS[(value as AccountFilter | null) ?? 'all']
                  }
                </SelectValue>
              </SelectTrigger>

              <SelectContent>
                {(Object.keys(ACCOUNT_LABELS) as AccountFilter[]).map(
                  (option) => (
                    <SelectItem key={option} value={option}>
                      {ACCOUNT_LABELS[option]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          variant="outline"
          data-test="members-export"
          disabled={exporting}
          onClick={onExport}
        >
          {exporting ? 'Preparing…' : 'Export CSV'}
        </Button>
      </div>

      <div
        className={cn(
          'rounded-lg border transition-opacity',
          navigating && 'opacity-60',
        )}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Member #</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Account</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            <If condition={members.length === 0}>
              <TableRow data-test="members-empty">
                <TableCell colSpan={8} className="text-muted-foreground">
                  {search === ''
                    ? 'No members yet. Import the roster to add them.'
                    : `No member matches “${search}”.`}
                </TableCell>
              </TableRow>
            </If>

            {members.map((member) => (
              <TableRow
                key={member.id}
                data-test={`member-row-${member.membershipNumber}`}
              >
                <TableCell className={WRAP}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{member.fullName}</span>

                    <If condition={member.badAddress}>
                      <Badge
                        variant="outline"
                        className={badgeExtras.warning}
                        data-test="member-bad-address"
                      >
                        Bad address
                      </Badge>
                    </If>
                  </div>
                </TableCell>

                <TableCell>{member.membershipNumber}</TableCell>

                {/*
                  A marker, not a dash. "This record cannot receive mail" is a
                  fact an officer has to act on -- it is why a member never got
                  the newsletter and why the import could not give them a way
                  to sign in -- and a dash in a column of addresses reads as
                  "not loaded yet". Distinct from the account badge two columns
                  along: a member can hold an account and have no address on
                  file, and can have a perfectly good address and no account.
                */}
                <TableCell className={WRAP}>
                  <If
                    condition={member.primaryEmail}
                    fallback={
                      <Badge
                        variant="outline"
                        className={badgeExtras.warning}
                        data-test="member-no-email"
                      >
                        No email
                      </Badge>
                    }
                  >
                    {(email) => <span>{email}</span>}
                  </If>
                </TableCell>

                <TableCell data-test="member-phone">
                  {member.phone ?? '—'}
                </TableCell>

                <TableCell className={WRAP} data-test="member-address">
                  <If condition={member.addressLine1} fallback={<span>—</span>}>
                    {(line) => <span>{line}</span>}
                  </If>

                  <If condition={member.postalCode}>
                    {(postalCode) => (
                      <span className="text-muted-foreground block text-xs">
                        {postalCode}
                      </span>
                    )}
                  </If>
                </TableCell>

                <TableCell className={WRAP}>{cityLine(member)}</TableCell>

                <TableCell>{formatLastSeen(member.rosterLastSeenAt)}</TableCell>

                <TableCell>
                  <If
                    condition={member.userId === null}
                    fallback={
                      <Badge
                        variant="outline"
                        className={badgeExtras.success}
                        data-test="member-has-account"
                      >
                        Has sign-in
                      </Badge>
                    }
                  >
                    <Badge variant="outline" data-test="member-no-account">
                      No account
                    </Badge>
                  </If>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm" data-test="members-range">
          {members.length === 0
            ? 'Showing no members'
            : `Showing ${first}–${last}`}
        </p>

        <div className="flex items-center gap-2">
          {/*
            Links, not click handlers: an officer deep in a 372-member roster
            can bookmark or share the page they are on, and the back button
            walks the pages it actually visited. `render` rather than
            `asChild` -- this project is Base UI.
          */}
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            data-test="members-prev"
            nativeButton={false}
            render={
              <Link
                href={hrefFor(
                  pathname,
                  { search, city, account },
                  Math.max(page - 1, 1),
                )}
              />
            }
          >
            Previous
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            data-test="members-next"
            nativeButton={false}
            render={
              <Link
                href={hrefFor(pathname, { search, city, account }, page + 1)}
              />
            }
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Everything the officer has narrowed the roster to, as the URL carries it. */
export interface Criteria {
  search: string;
  city: string;
  account: AccountFilter;
}

/**
 * Every parameter is omitted at its default, so the plain roster is
 * `/home/members` rather than `/home/members?q=&city=&account=all&page=1`.
 *
 * Exported because it is the whole of the agreement between the four controls
 * on this screen and the four values `page.tsx` reads back out of
 * `searchParams`: a filter that cannot survive a page link or a back button is
 * a filter that lies about what is on screen.
 */
export function hrefFor(pathname: string, criteria: Criteria, page: number) {
  const params = new URLSearchParams();

  if (criteria.search !== '') params.set('q', criteria.search);
  if (criteria.city !== '') params.set('city', criteria.city);
  if (criteria.account !== 'all') params.set('account', criteria.account);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();

  return query === '' ? pathname : `${pathname}?${query}`;
}

/**
 * The CSV arrives as a string from the action rather than as a download
 * response, because a Server Action cannot set `Content-Disposition`. Handing
 * the browser a blob URL is what turns it into a file the officer can open.
 */
function download(filename: string, csv: string) {
  // The BOM is what makes Excel read a UTF-8 CSV as UTF-8 rather than as the
  // system codepage, which is the difference between "Ortiz" and "OrtÃ­z".
  const blob = new Blob([`﻿${csv}`], {
    type: 'text/csv;charset=utf-8',
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}
