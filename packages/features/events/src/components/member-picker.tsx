'use client';

import { useEffect, useState } from 'react';

import { Input } from '@kit/ui/input';

import { searchMembersAction } from '../server/events-actions';
import type { MemberOption } from '../types';

/** Search box listing up to 20 members; `eventId` null means "choosing a lead" (events.manage). */
export function MemberPicker({
  eventId,
  onPick,
  placeholder = 'Search members by name or number',
  dataTest,
}: {
  eventId: string | null;
  onPick: (member: MemberOption) => void;
  placeholder?: string;
  dataTest?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberOption[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const result = await searchMembersAction({ eventId, query });
      setResults(result.success ? (result.data ?? []) : []);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, eventId]);

  return (
    <div className="relative flex flex-col gap-1">
      <Input
        value={query}
        placeholder={placeholder}
        data-test={dataTest}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 ? (
        <ul
          className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow"
          role="listbox"
        >
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="hover:bg-muted w-full px-3 py-2 text-left text-sm"
                onClick={() => {
                  onPick(m);
                  setQuery('');
                  setResults([]);
                }}
              >
                {m.fullName}{' '}
                <span className="text-muted-foreground">
                  #{m.membershipNumber}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
