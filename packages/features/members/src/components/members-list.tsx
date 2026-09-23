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

export function MembersList({
  members,
  search,
  page,
  pageSize,
  hasMore,
}: {
  members: MemberListRow[];
  /** The committed term, straight off the URL — never the keystroke in flight. */
  search: string;
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
        router.replace(hrefFor(pathname, term, 1), { scroll: false });
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, router, pathname]);

  const onExport = () => {
    startExport(async () => {
      const result = await exportMembersAction({ search: search || null });

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

                <TableCell className={WRAP}>
                  {member.primaryEmail ?? '—'}
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
              <Link href={hrefFor(pathname, search, Math.max(page - 1, 1))} />
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
            render={<Link href={hrefFor(pathname, search, page + 1)} />}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Both parameters are omitted at their defaults, so the plain roster is
 * `/home/members` rather than `/home/members?q=&page=1`.
 */
function hrefFor(pathname: string, search: string, page: number) {
  const params = new URLSearchParams();

  if (search !== '') params.set('q', search);
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
