import { APIRequestContext } from '@playwright/test';

import postgres from 'postgres';

/**
 * The local Supabase database -- same default and `E2E_DATABASE_URL`
 * override as `utils/cleanup.ts`. `public.event_emails` grants `service_role`
 * only `select`/`update`, so the outbox is read and written over a direct
 * Postgres connection, which is refused for any non-local host.
 */
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export interface OutboxRow {
  id: string;
  kind: string;
  status: string;
  mode: string | null;
}

async function withLocalSql<T>(
  run: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const { hostname } = new URL(DATABASE_URL);

  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(
      `event-emails E2E helpers refuse a non-local database (${hostname})`,
    );
  }

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** The id of a member's sign-up on an event, found by the member's email. */
export function signupIdFor(eventId: string, email: string) {
  return withLocalSql(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      select s.id
      from public.event_signups s
      join public.event_shifts sh on sh.id = s.shift_id
      join public.members m on m.id = s.member_id
      where sh.event_id = ${eventId} and lower(m.primary_email) = lower(${email})`;

    return rows[0]?.id;
  });
}

export function outboxFor(signupId: string) {
  return withLocalSql(
    (sql) =>
      sql<OutboxRow[]>`
      select id, kind, status, mode
      from public.event_emails
      where signup_id = ${signupId}
      order by created_at`,
  );
}

/**
 * Makes the sign-up's confirmation look like a live send that Resend
 * reported delivered. Test-only; nothing is sent.
 */
export function simulateLiveDelivered(signupId: string) {
  return withLocalSql(async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      update public.event_emails
      set mode = 'live', status = 'sent', sent_at = now(),
          resend_email_id = ${`e2e-${signupId}`}
      where signup_id = ${signupId} and kind = 'confirmation'
      returning id`;

    await sql`
      insert into public.event_email_events (email_id, type, occurred_at, svix_id, payload)
      values (${row!.id}, 'delivered', now(), ${`e2e-svix-${signupId}`}, '{}'::jsonb)`;
  });
}

export function postEventEmailsJob(request: APIRequestContext, bearer: string) {
  return request.post('/api/jobs/event-emails', {
    headers: { authorization: `Bearer ${bearer}` },
  });
}
