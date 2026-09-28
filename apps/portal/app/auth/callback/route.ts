import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { createAuthCallbackService } from '@kit/supabase/auth';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '@kit/brand/config/paths';

export async function GET(request: NextRequest) {
  const service = createAuthCallbackService(getSupabaseServerClient());

  const { nextPath } = await service.exchangeCodeForSession(request, {
    redirectPath: pathsConfig.app.home,
  });

  return redirect(nextPath);
}
