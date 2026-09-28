'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@kit/ui/chart';

import { moneyTooltipFormatter } from './finance-charts';
import {
  toAgingChartData,
  toForecastChartData,
  toLapsesByMonthData,
  toRetentionRateData,
  toRunningTotalData,
} from '../lib/insights-data';
import type {
  AgingBucket,
  CollectionProgress,
  ForecastMonth,
  Retention,
} from '../types';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function dollarsFormatter(value: unknown) {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(value)
    : String(value);
}

const RUNNING_TOTAL_CONFIG: ChartConfig = {
  collected: { label: 'Collected', color: CHART_COLORS[0] },
  expected: { label: 'Expected', color: CHART_COLORS[1] },
};

export function RunningTotalChart({
  rows,
  expectedCents,
}: {
  rows: CollectionProgress['byMonth'];
  expectedCents: number;
}) {
  const data = toRunningTotalData(rows, expectedCents);

  return (
    <Card data-test="collection-running-total">
      <CardHeader>
        <CardTitle>Collected so far vs. expected</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No dues recorded this year.
          </p>
        ) : (
          <ChartContainer
            config={RUNNING_TOTAL_CONFIG}
            className="aspect-auto h-64 w-full"
          >
            <LineChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={moneyTooltipFormatter(RUNNING_TOTAL_CONFIG)}
                  />
                }
              />
              <Line
                dataKey="collected"
                type="monotone"
                stroke="var(--color-collected)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                dataKey="expected"
                type="monotone"
                stroke="var(--color-expected)"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const FORECAST_CONFIG: ChartConfig = {
  members: { label: 'Members', color: CHART_COLORS[0] },
};

function forecastTooltipFormatter(
  value: unknown,
  _name: unknown,
  _item: unknown,
  _index: number,
  payload: unknown,
) {
  const dollars =
    payload && typeof payload === 'object' && 'dollars' in payload
      ? (payload as { dollars: unknown }).dollars
      : undefined;

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Members</span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {String(value)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Amount</span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {dollarsFormatter(dollars)}
        </span>
      </div>
    </div>
  );
}

export function ForecastChart({
  rows,
  selected,
}: {
  rows: ForecastMonth[];
  selected: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const data = toForecastChartData(rows);
  const isEmpty = data.every((d) => d.members === 0);

  function goToMonth(month: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', 'collection');
    next.set('month', month);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <Card data-test="collection-forecast">
      <CardHeader>
        <CardTitle>Coming due (next 12 months)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isEmpty ? (
          <p className="text-muted-foreground text-sm">
            No renewals due in the next 12 months.
          </p>
        ) : (
          <>
            <ChartContainer
              config={FORECAST_CONFIG}
              className="aspect-auto h-64 w-full"
            >
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent formatter={forecastTooltipFormatter} />
                  }
                />
                <Bar
                  dataKey="members"
                  fill="var(--color-members)"
                  cursor="pointer"
                  onClick={(entry: { payload?: { key?: string } }) => {
                    const key = entry?.payload?.key;
                    if (key) goToMonth(key);
                  }}
                />
              </BarChart>
            </ChartContainer>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Show members for month
              </span>
              <select
                aria-label="Show members for month"
                className="border-input bg-background rounded-md border px-2 py-1 text-sm"
                value={selected ?? ''}
                onChange={(e) => {
                  if (e.target.value) goToMonth(e.target.value);
                }}
              >
                <option value="">Select a month</option>
                {data.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.month}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const AGING_CONFIG: ChartConfig = {
  members: { label: 'Members', color: CHART_COLORS[0] },
};

function agingTooltipFormatter(
  value: unknown,
  _name: unknown,
  _item: unknown,
  _index: number,
  payload: unknown,
) {
  const dollars =
    payload && typeof payload === 'object' && 'dollars' in payload
      ? (payload as { dollars: unknown }).dollars
      : undefined;

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Members</span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {String(value)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Owed</span>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {dollarsFormatter(dollars)}
        </span>
      </div>
    </div>
  );
}

export function AgingChart({ buckets }: { buckets: AgingBucket[] }) {
  const data = toAgingChartData(buckets);

  return (
    <Card data-test="lapses-aging-chart">
      <CardHeader>
        <CardTitle>Lapsed members by days unpaid</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={AGING_CONFIG}
          className="aspect-auto h-64 w-full"
        >
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="bucket"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={agingTooltipFormatter} />
              }
            />
            <Bar dataKey="members" fill="var(--color-members)" />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const RETENTION_RATE_CONFIG: ChartConfig = {
  rate: { label: 'Renewal rate', color: CHART_COLORS[0] },
};

function retentionTooltipFormatter(
  value: unknown,
  _name: unknown,
  _item: unknown,
  _index: number,
  payload: unknown,
) {
  const renewed =
    payload && typeof payload === 'object' && 'renewed' in payload
      ? (payload as { renewed: unknown }).renewed
      : '—';
  const eligible =
    payload && typeof payload === 'object' && 'eligible' in payload
      ? (payload as { eligible: unknown }).eligible
      : '—';

  return (
    <div className="flex w-full items-center justify-between gap-2">
      <span className="text-muted-foreground">Renewed of eligible</span>
      <span className="text-foreground font-mono font-medium tabular-nums">
        {String(renewed)} of {String(eligible)}
        {typeof value === 'number' ? ` (${value}%)` : ''}
      </span>
    </div>
  );
}

export function RetentionRateChart({ years }: { years: Retention['years'] }) {
  const data = toRetentionRateData(years);

  return (
    <Card data-test="retention-rate-chart">
      <CardHeader>
        <CardTitle>Renewal rate (renewed within 90 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={RETENTION_RATE_CONFIG}
          className="aspect-auto h-64 w-full"
        >
          <LineChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value: number) => `${value}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={retentionTooltipFormatter} />
              }
            />
            <Line
              dataKey="rate"
              type="monotone"
              stroke="var(--color-rate)"
              strokeWidth={2}
              connectNulls={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const LAPSES_BY_MONTH_CONFIG: ChartConfig = {
  lapses: { label: 'Lapses', color: CHART_COLORS[0] },
};

export function LapsesByMonthChart({
  rows,
}: {
  rows: Retention['lapsesByMonth'];
}) {
  const data = toLapsesByMonthData(rows);
  const isEmpty = data.every((d) => d.lapses === 0);

  return (
    <Card data-test="retention-lapses-chart">
      <CardHeader>
        <CardTitle>New lapses per month</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-muted-foreground text-sm">
            No lapses in the last five years.
          </p>
        ) : (
          <ChartContainer
            config={LAPSES_BY_MONTH_CONFIG}
            className="aspect-auto h-64 w-full"
          >
            <BarChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="lapses" fill="var(--color-lapses)" />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
