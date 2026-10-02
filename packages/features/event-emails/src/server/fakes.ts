import { vi } from 'vitest';

import type { EventEmailsConfig } from '../config';

export const liveConfig: EventEmailsConfig = {
  mode: 'live',
  apiKey: 're_k',
  webhookSecret: '',
  jobsSecret: 's',
  from: 'Council Events <events@x.org>',
  replyTo: 'fs@x.org',
  siteUrl: 'https://x.org',
  missingForLive: [],
};

export function row(over: Record<string, unknown> = {}) {
  return {
    email_id: 'e1',
    kind: 'confirmation',
    sequence: 0,
    mode: 'live',
    signup_id: 's1',
    event_id: 'ev1',
    first_name: 'Nick',
    email: 'nick@example.org',
    title: 'Fish Fry',
    location: 'Hall',
    description: null,
    event_status: 'scheduled',
    shift_starts_at: '2026-11-07T01:00:00Z',
    shift_ends_at: '2026-11-07T03:00:00Z',
    shift_label: null,
    ...over,
  };
}

/** Claim answers `pages` in order, then an empty page forever. */
export function fakeClient({
  pages = [] as Record<string, unknown>[][],
  attempts = {} as Record<string, number>,
  claimError = null as { message: string } | null,
  updateError = null as { message: string } | null,
} = {}) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const runs: Record<string, unknown>[] = [];
  const queue = [...pages];
  const rpc = vi.fn(async (name: string) => {
    if (name === 'event_emails_claim') {
      if (claimError) return { data: null, error: claimError };
      return { data: queue.shift() ?? [], error: null };
    }
    return { data: 0, error: null };
  });
  const client = {
    rpc,
    from: (table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        if (table === 'event_email_runs') runs.push(values);
        return { error: null };
      },
      select: () => ({
        in: async (_c: string, ids: string[]) => ({
          data: ids.map((id) => ({ id, attempts: attempts[id] ?? 1 })),
          error: null,
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          updates.push({ id, values });
          return { error: updateError };
        },
      }),
    }),
  };
  return { client: client as never, rpc, updates, runs };
}
