import { cn } from '@kit/ui/utils';

export function SitePageHeader({
  title,
  subtitle,
  container = true,
  className = '',
}: {
  title: string;
  subtitle: string;
  container?: boolean;
  className?: string;
}) {
  const containerClass = container ? 'container' : '';

  return (
    <div className={cn('border-b py-8 xl:py-10 2xl:py-12', className)}>
      <div
        className={cn('flex flex-col space-y-2 lg:space-y-4', containerClass)}
      >
        {/*
         * `text-foreground`, not `dark:text-white`: this `h1` renders on
         * `/faq` and the three legal pages, which sit directly beside the 19
         * MDX pages in the navigation, and those render their `h1` in
         * `text-foreground`. Hardcoded white made the same element two
         * different whites on adjacent pages, and opted these four out of any
         * future revision of the council's dark palette.
         */}
        <h1
          className={
            'text-foreground font-heading text-3xl font-medium tracking-tighter xl:text-5xl'
          }
        >
          {title}
        </h1>

        <h2
          className={
            'text-muted-foreground text-lg tracking-tight 2xl:text-2xl'
          }
        >
          {subtitle}
        </h2>
      </div>
    </div>
  );
}
