import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { readNoticesConfig } from '@kit/dues-notices/config';
import { runDuesNoticesJob } from '@kit/dues-notices/server/job';

function authorized(header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  const config = readNoticesConfig();

  if (!authorized(request.headers.get('authorization'), config.jobsSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runDuesNoticesJob({
      client: getSupabaseServerAdminClient(),
      config,
    });
    // 200 even when some emails failed: the failures are recorded on the
    // notices, and a non-2xx would only make the cron retry.
    return NextResponse.json(result);
  } catch (error) {
    console.error('Dues notices job failed:', error);
    return NextResponse.json({ error: 'Job failed' }, { status: 500 });
  }
}
