import Link from 'next/link';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@kit/ui/card';

interface HomeSplitCard {
  title: string;
  body: string;
  action: {
    label: string;
    href: string;
    testId: string;
  };
}

/**
 * The two front doors of the site: one for brothers who already belong and one
 * for men considering the council. The live WordPress cards carry a bullet list
 * of links into membership sub-pages that this app does not have, so each card
 * gets a single unambiguous action instead.
 */
const SPLIT_CARDS: readonly HomeSplitCard[] = [
  {
    title: 'I’m a Member',
    body: 'Access your account, pay dues, and find member resources.',
    action: {
      label: 'Go to My Account',
      href: '/home',
      testId: 'home-member-cta',
    },
  },
  {
    title: 'I Want to Join',
    body: 'Become a Brother Knight and make a difference in your community.',
    action: {
      label: 'Answer the Call to Serve',
      href: '/get-involved/membership',
      testId: 'home-join-cta',
    },
  },
];

export function HomeMemberJoinSplit() {
  return (
    <section className="py-12 lg:py-16" aria-label="Members and joining">
      <div className="container grid gap-6 md:grid-cols-2">
        {SPLIT_CARDS.map((card) => (
          <Card key={card.title} className="flex h-full flex-col">
            <CardHeader>
              <h2 className="text-foreground text-xl font-semibold tracking-tight">
                {card.title}
              </h2>
            </CardHeader>

            <CardContent className="flex-1">
              <p className="text-muted-foreground leading-7">{card.body}</p>
            </CardContent>

            <CardFooter>
              <Button
                nativeButton={false}
                size="lg"
                data-test={card.action.testId}
                render={<Link href={card.action.href} />}
              >
                {card.action.label}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
