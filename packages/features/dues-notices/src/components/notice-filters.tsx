'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { KIND_LABELS, TRACKING_LABELS } from '../tracking';
import type { NoticeKind, Tracking } from '../types';

const KINDS = Object.keys(KIND_LABELS) as NoticeKind[];
const TRACKINGS = Object.keys(TRACKING_LABELS) as Tracking[];

/**
 * `?kind=` / `?tracking=` filters for the Dues notices table, mirroring the
 * forecast-month native `<select>` in `insights-charts.tsx` (`ForecastChart`):
 * a plain `<select>`, not the Base UI `Select`, navigating through the URL
 * rather than local state.
 */
export function NoticeFilters({
  kind,
  tracking,
}: {
  kind: NoticeKind | null;
  tracking: Tracking | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());

    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }

    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <label htmlFor="notice-kind-select" className="text-muted-foreground">
          Kind
        </label>
        <select
          id="notice-kind-select"
          className="border-input bg-background rounded-md border px-2 py-1 text-sm"
          value={kind ?? ''}
          onChange={(e) => setParam('kind', e.target.value)}
        >
          <option value="">All kinds</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label
          htmlFor="notice-tracking-select"
          className="text-muted-foreground"
        >
          Tracking
        </label>
        <select
          id="notice-tracking-select"
          className="border-input bg-background rounded-md border px-2 py-1 text-sm"
          value={tracking ?? ''}
          onChange={(e) => setParam('tracking', e.target.value)}
        >
          <option value="">All tracking</option>
          {TRACKINGS.map((t) => (
            <option key={t} value={t}>
              {TRACKING_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
