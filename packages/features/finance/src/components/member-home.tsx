import type { ReactNode } from 'react';

import { cn } from '@kit/ui/utils';

/**
 * The plain member home's layout: the dues-and-payments card beside the
 * volunteering card on wider screens, stacked on phones. The cards come in
 * as slots, so this package depends on neither `@kit/payments` nor
 * `@kit/events`.
 *
 * `linked` is false when the sign-in has no membership record; then there
 * are no dues to show, only the note saying how to fix that.
 */
export function MemberHome({
  duesDeployed,
  linked,
  duesCard,
  volunteerCard = null,
}: {
  duesDeployed: boolean;
  linked: boolean;
  duesCard: ReactNode;
  volunteerCard?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4" data-test="member-home">
      {duesDeployed && !linked ? (
        <p className="text-muted-foreground" data-test="member-home-no-member">
          Your sign-in is not linked to a membership record yet. Ask the
          Financial Secretary to link it.
        </p>
      ) : null}

      <div
        className={cn(
          'grid items-stretch gap-4',
          volunteerCard ? 'md:grid-cols-2' : null,
        )}
        data-test="member-home-cards"
      >
        {duesCard}
        {volunteerCard}
      </div>
    </div>
  );
}
