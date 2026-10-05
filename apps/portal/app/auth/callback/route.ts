import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { createAuthCallbackService } from '@kit/supabase/auth';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '@kit/brand/config/paths';

import { safeRedirectPath } from '~/lib/safe-redirect-path';

export async function GET(request: NextRequest) {
  const service = createAuthCallbackService(getSupabaseServerClient());

  const { nextPath } = await service.exchangeCodeForSession(request, {
    redirectPath: pathsConfig.app.home,
  });

  // `nextPath` is the caller-supplied `next` parameter.
  return redirect(safeRedirectPath(nextPath, pathsConfig.app.home));
}
