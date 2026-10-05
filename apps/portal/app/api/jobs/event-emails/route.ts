import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { readEventEmailsConfig } from '@kit/event-emails/config';
import { runEventEmailsJob } from '@kit/event-emails/server/job';

function authorized(header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  try {
    const config = readEventEmailsConfig();

    if (!authorized(request.headers.get('authorization'), config.jobsSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runEventEmailsJob({
      client: getSupabaseServerAdminClient(),
      config,
    });
    // 200 even when some emails failed: the failures are recorded on the
    // emails, and a non-2xx would only make the cron retry.
    return NextResponse.json(result);
  } catch (error) {
    console.error('Event emails job failed:', error);
    return NextResponse.json({ error: 'Job failed' }, { status: 500 });
  }
}
