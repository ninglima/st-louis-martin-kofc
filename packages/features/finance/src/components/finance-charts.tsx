'use client';

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';

import { LABEL_BY_STATUS } from '@kit/dues/components/dues-status-badge';
import type { DuesStatus } from '@kit/dues/types';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@kit/ui/chart';

import {
  toDuesChartData,
  toHostingChartData,
  toNetChartData,
  toStatusChartData,
} from '../lib/chart-data';
import type { FinanceDashboard, HostingProvider, NetYear } from '../types';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

/** Assigns `--chart-1` through `--chart-5` to a set of keys, cycling if
 * there are more than five (e.g. hosting providers). */
function configFor(keys: { key: string; label: string }[]): ChartConfig {
  return Object.fromEntries(
    keys.map(({ key, label }, i) => [
      key,
      { label, color: CHART_COLORS[i % CHART_COLORS.length] },
    ]),
  );
}

function dollarsFormatter(value: unknown) {
  return typeof value === 'number'
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(value)
    : String(value);
}

/**
 * `ChartTooltipContent`'s `formatter` prop, when set, replaces its whole
 * per-series row (swatch, label, value) rather than just the value -- so
 * this rebuilds that row using the chart's own `ChartConfig` labels, with
 * the value rendered in dollars instead of `toLocaleString()`.
 */
function moneyTooltipFormatter(config: ChartConfig) {
  return (
    value: unknown,
    name: unknown,
    item: { color?: string; payload?: { fill?: string } },
  ) => {
    const key = String(name);
    const label = config[key]?.label ?? key;
    const color = item.color ?? item.payload?.fill;

    return (
      <div className="flex w-full flex-1 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: color }}
          />
          <span className="text-muted-foreground">{label}</span>
        </div>
        <span className="text-foreground font-mono font-medium tabular-nums">
          {dollarsFormatter(value)}
        </span>
      </div>
    );
  };
}

const DUES_CONFIG = configFor([
  { key: 'online', label: 'Online' },
  { key: 'check', label: 'Check' },
  { key: 'cash', label: 'Cash' },
]);

const NET_CONFIG = configFor([
  { key: 'dues', label: 'Dues' },
  { key: 'hosting', label: 'Hosting' },
  { key: 'net', label: 'Net' },
]);

export function DuesByMonthChart({
  rows,
}: {
  rows: FinanceDashboard['duesByMonth'];
}) {
  const data = toDuesChartData(rows);
  const isEmpty = data.every(
    (row) => row.online === 0 && row.check === 0 && row.cash === 0,
  );

  return (
    <Card data-test="finance-chart-dues">
      <CardHeader>
        <CardTitle>Dues collected by month</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-muted-foreground text-sm">
            No dues recorded this year.
          </p>
        ) : (
          <ChartContainer
            config={DUES_CONFIG}
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
                  <ChartTooltipContent
                    formatter={moneyTooltipFormatter(DUES_CONFIG)}
                  />
                }
              />
              <Bar dataKey="online" stackId="a" fill="var(--color-online)" />
              <Bar dataKey="check" stackId="a" fill="var(--color-check)" />
              <Bar dataKey="cash" stackId="a" fill="var(--color-cash)" />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function StatusChart({
  counts,
}: {
  counts: FinanceDashboard['statusCounts'];
}) {
  const data = toStatusChartData(counts);
  const config: ChartConfig = {
    members: { label: 'Members', color: CHART_COLORS[0] },
  };

  return (
    <Card data-test="finance-chart-status">
      <CardHeader>
        <CardTitle>Dues status (as of today)</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="status"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value: string) =>
                LABEL_BY_STATUS[value as DuesStatus] ?? value
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    LABEL_BY_STATUS[value as DuesStatus] ?? String(value)
                  }
                />
              }
            />
            <Bar dataKey="members" fill="var(--color-members)" />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function HostingByMonthChart({
  rows,
  providers,
  year,
}: {
  rows: FinanceDashboard['hostingByMonth'];
  providers: HostingProvider[];
  year: number;
}) {
  const data = toHostingChartData(rows, providers, year);
  const config = configFor(
    providers.map((p) => ({ key: p.slug, label: p.name })),
  );

  return (
    <Card data-test="finance-chart-hosting">
      <CardHeader>
        <CardTitle>Hosting costs by month</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hosting costs recorded this year.
          </p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
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
                  <ChartTooltipContent
                    formatter={moneyTooltipFormatter(config)}
                  />
                }
              />
              {providers.map((p) => (
                <Bar
                  key={p.slug}
                  dataKey={p.slug}
                  stackId="a"
                  fill={`var(--color-${p.slug})`}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function NetByYearChart({
  rows,
  showHosting = true,
}: {
  rows: NetYear[];
  showHosting?: boolean;
}) {
  const data = toNetChartData(rows, showHosting);

  return (
    <Card data-test="finance-chart-net">
      <CardHeader>
        <CardTitle>
          {showHosting
            ? 'Dues, hosting and net by year'
            : 'Dues collected per year'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={NET_CONFIG} className="aspect-auto h-64 w-full">
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={moneyTooltipFormatter(NET_CONFIG)}
                />
              }
            />
            <Bar dataKey="dues" fill="var(--color-dues)" />
            {showHosting ? (
              <>
                <Bar dataKey="hosting" fill="var(--color-hosting)" />
                <Bar dataKey="net" fill="var(--color-net)" />
              </>
            ) : null}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
