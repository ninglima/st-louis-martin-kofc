import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { DuesService } from '@kit/dues/server/dues.service';
import { VolunteerHomeCard } from '@kit/events/components/volunteer-home-card';
import { EventsService } from '@kit/events/server/events.service';
import { MemberHome } from '@kit/finance/components/member-home';
import { DuesAndPaymentsCard } from '@kit/payments/components/dues-and-payments-card';
import { describeDuesAndPayments } from '@kit/payments/lib/dues-and-payments';
import { PaymentService } from '@kit/payments/server/payment.service';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

type SupabaseServerClient = ReturnType<
  typeof getSupabaseServerClient<Database>
>;

/**
 * The member home: one dues-and-payments card beside volunteering.
 * Payments are read with the member's own session, so the `payments` select
 * policy limits them to the member's rows (the `eq` filter keeps an officer
 * with `payments.manage` to their own as well).
 */
export async function MemberHomeContent({
  client,
}: {
  client: SupabaseServerClient;
}) {
  const user = await requireUserInServerComponent();
  const [dues, volunteering, payments] = await Promise.all([
    readDuesIfDeployed(() => new DuesService(client).mySummary()),
    readDuesIfDeployed(() => new EventsService(client).myVolunteering()),
    new PaymentService(client).getPayments(user.id, false),
  ]);
  const summary = dues.deployed ? dues.value : null;

  return (
    <MemberHome
      duesDeployed={dues.deployed}
      linked={summary !== null}
      duesCard={
        <DuesAndPaymentsCard
          view={describeDuesAndPayments(
            summary,
            payments,
            new Date(),
            chicagoToday(),
          )}
        />
      }
      volunteerCard={
        volunteering.deployed && volunteering.value.linked ? (
          <VolunteerHomeCard data={volunteering.value} />
        ) : null
      }
    />
  );
}
