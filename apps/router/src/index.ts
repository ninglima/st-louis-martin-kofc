import type { Env } from './env';
import { buildOriginRequest, rewriteLocation } from './forward';
import { classify } from './routing';

async function proxyToPortal(request: Request, env: Env): Promise<Response> {
  const response = await fetch(buildOriginRequest(request, env));

  return rewriteLocation(
    response,
    env.PORTAL_ORIGIN,
    new URL(request.url).origin,
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Static files never reach here: Workers static assets answers a
    // matching file before the Worker runs. What arrives is either a portal
    // path or a miss, and a miss gets the site's 404 page without waking
    // Cloud Run.
    if (classify(url) === 'site') {
      return env.ASSETS.fetch(request);
    }

    return proxyToPortal(request, env);
  },
} satisfies ExportedHandler<Env>;
