import { ColdStartSimulator } from './cold-start';
import type { Env } from './env';
import { buildOriginRequest, rewriteLocation } from './forward';
import { classify, pleaseWaitEligible } from './routing';
import { runDuesNoticesTrigger, runEventEmailsTrigger } from './scheduled';

const PLEASE_WAIT_AFTER_MS = 1500;

let simulator: ColdStartSimulator | null = null;

function getSimulator(env: Env): ColdStartSimulator {
  simulator ??= new ColdStartSimulator(
    Number(env.SIMULATE_COLD_START_MS ?? 0),
    Number(env.SIMULATE_IDLE_MS ?? 60000),
  );

  return simulator;
}

async function proxyToPortal(request: Request, env: Env): Promise<Response> {
  const cold = getSimulator(env);
  const delay = cold.delayFor(Date.now());

  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const response = await fetch(buildOriginRequest(request, env));
  cold.markWarm(Date.now());

  return rewriteLocation(
    response,
    env.PORTAL_ORIGIN,
    new URL(request.url).origin,
  );
}

async function pleaseWait(request: Request, env: Env): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL('/please-wait', request.url));

  return new Response(page.body, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'retry-after': '2',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Static files never reach here: Workers static assets answers a
    // matching file before the Worker runs. What arrives is either a portal
    // path or a miss, and a miss gets the site's 404 page without waking
    // Cloud Run.
    if (classify(url) === 'site') {
      return env.ASSETS.fetch(request);
    }

    const portal = proxyToPortal(request, env);

    if (!pleaseWaitEligible(request, url)) {
      return portal;
    }

    const TIMED_OUT = Symbol('timed-out');
    const winner = await Promise.race([
      portal,
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), PLEASE_WAIT_AFTER_MS),
      ),
    ]);

    if (winner !== TIMED_OUT) {
      return winner;
    }

    // Let the original request finish: it is what warms the container.
    ctx.waitUntil(
      portal.then((response) => response.body?.cancel()).catch(() => {}),
    );

    return pleaseWait(request, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      Promise.all([
        runDuesNoticesTrigger(env),
        runEventEmailsTrigger(env),
      ]).then(() => undefined),
    );
  },
} satisfies ExportedHandler<Env>;
