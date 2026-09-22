/**
 * Council figures for the current fraternal year, taken from the site copy
 * spec. The WordPress original animates these counting up; that is decoration
 * that would cost a client component, and the numbers read fine static.
 */
const STATS = [
  {
    value: '372',
    label: 'Brother Knights',
    description: 'Number of Brother Knights in our Council — and growing!',
  },
  {
    value: '64,165',
    label: 'Pounds of Food Donated',
    description:
      'Pounds of food donated by St. Theresa Parishioners and delivered by the Knights in 2025-2026 Fraternal Year to the Sterling Catholic Charities Food Pantry',
  },
  {
    value: '$15,000',
    label: 'Raised for KOVAR',
    description:
      'Amount of money raised for KOVAR in the 2025-2026 Fraternal Year - a Knights of Columbus charity that assists our brothers and sisters with intellectual disabilities.',
  },
] as const;

export function HomeStatsBar() {
  return (
    <section
      className="bg-muted border-y py-12 lg:py-16"
      aria-label="Council by the numbers"
    >
      <div className="container">
        <dl className="grid gap-10 text-center md:grid-cols-3 md:gap-8">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-2">
              {/*
                A description list has to declare its term before its value, so
                the figure is lifted above the label with `order` rather than by
                putting the `dd` first and breaking the content model.
              */}
              <dt className="text-foreground order-2 text-lg font-semibold">
                {stat.label}
              </dt>

              <dd className="text-primary order-1 text-4xl font-bold tracking-tight lg:text-5xl">
                {stat.value}
              </dd>

              <dd className="text-muted-foreground order-3 max-w-sm text-sm leading-6">
                {stat.description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
