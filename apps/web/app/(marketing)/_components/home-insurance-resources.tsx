import Link from 'next/link';

import { Button } from '@kit/ui/button';

interface AgentContact {
  label: string;
  value: string;
  href?: string;
}

const AGENT_CONTACTS: readonly AgentContact[] = [
  { label: 'Phone/Text', value: '703-624-9687', href: 'tel:7036249687' },
  { label: 'Toll-Free', value: '833-563-2467', href: 'tel:8335632467' },
  {
    label: 'Email',
    value: 'bill.lupinacci@kofc.org',
    href: 'mailto:bill.lupinacci@kofc.org',
  },
  {
    label: 'Office',
    value: '2911 Hunter Mill Road, Suite 205, Oakton, VA 22124',
  },
];

const HEADING_CLASS =
  'text-foreground mb-4 text-2xl font-semibold tracking-tight';
const BODY_CLASS = 'text-muted-foreground leading-7';
const LINK_CLASS = 'text-primary font-medium underline underline-offset-4';

export function HomeInsuranceResources() {
  return (
    <section className="py-12 lg:py-16">
      <div className="container grid gap-10 md:grid-cols-2 md:gap-16">
        <div className="flex flex-col">
          <h2 className={HEADING_CLASS}>Insurance & Financial Services</h2>

          <h3 className="text-foreground mb-3 text-lg font-semibold">
            Bill Lupinacci — Abbate Agency
          </h3>

          <p className={BODY_CLASS}>
            Knights of Columbus offers retirement protection, estate planning,
            long-term care, and life insurance exclusively for members and their
            families.
          </p>

          <dl className="mt-6 flex flex-col gap-2 text-sm">
            {AGENT_CONTACTS.map((contact) => (
              <div key={contact.label} className="flex flex-wrap gap-x-2">
                <dt className="text-foreground font-medium">
                  {contact.label}:
                </dt>

                <dd className="text-muted-foreground">
                  {contact.href ? (
                    <a href={contact.href} className={LINK_CLASS}>
                      {contact.value}
                    </a>
                  ) : (
                    contact.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col items-start">
          <h2 className={HEADING_CLASS}>Catholic Resources</h2>

          <p className={BODY_CLASS}>
            Access prayers, encyclicals, catechism resources, and links to our
            local parish community.
          </p>

          <Button
            nativeButton={false}
            variant="outline"
            size="lg"
            className="mt-6"
            data-test="home-resources-cta"
            render={<Link href="/catholic-resources" />}
          >
            View Resources
          </Button>
        </div>
      </div>
    </section>
  );
}
