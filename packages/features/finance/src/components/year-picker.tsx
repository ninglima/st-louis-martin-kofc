'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { fraternalYearLabel } from '../lib/fraternal-year';

export function YearPicker({
  year,
  options,
}: {
  year: number;
  options: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Select
      value={String(year)}
      onValueChange={(value) => {
        if (value === null) return;

        const next = new URLSearchParams(params.toString());
        next.set('year', value);
        router.replace(`${pathname}?${next.toString()}`);
      }}
    >
      <SelectTrigger
        className="w-40"
        data-test="year-picker"
        aria-label="Fraternal year"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {fraternalYearLabel(y)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
