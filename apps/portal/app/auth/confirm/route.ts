import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { createAuthCallbackService } from '@kit/supabase/auth';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '@kit/brand/config/paths';

export async function GET(request: NextRequest) {
  const service = createAuthCallbackService(getSupabaseServerClient());

  const url = await service.verifyTokenHash(request, {
    redirectPath: pathsConfig.app.home,
  });

  // Behind the router, `request.url` carries the container's own listen
  // address (`http://0.0.0.0:8080`), not the public origin, so an absolute
  // redirect built from it sends the browser nowhere. A path-only Location
  // resolves against whatever origin the visitor used.
  return redirect(`${url.pathname}${url.search}`);
}
