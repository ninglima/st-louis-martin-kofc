'use client';

import { useEffect, useState } from 'react';

import { Button } from '@kit/ui/button';
import { Spinner } from '@kit/ui/spinner';

import { waitForPortal } from '~/lib/wait-for-portal';

/**
 * Served by the router in place of a portal page while Cloud Run starts. The
 * address bar still shows the page the visitor asked for, so reloading goes
 * straight back to it, query string included.
 */
export function PleaseWaitClient() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // Opened at its own address (the public-site sweep does this) there is
    // no portal page behind it to reload into, and reloading would only
    // bring this page back, forever.
    if (window.location.pathname.replace(/\/$/, '') === '/please-wait') {
      return;
    }

    let cancelled = false;

    void waitForPortal({
      fetchVersion: async () =>
        (await fetch('/version', { cache: 'no-store' })).status,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    }).then((result) => {
      if (cancelled) return;
      if (result === 'ready') window.location.reload();
      else setTimedOut(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={'flex flex-col items-center gap-4 py-24'} role={'status'}>
      {timedOut ? null : <Spinner />}
      {/* The page's one h1, as on every other public route. */}
      <h1 className={'text-muted-foreground text-lg font-normal'}>
        Please wait...
      </h1>
      {timedOut ? (
        <Button onClick={() => window.location.reload()}>Try again</Button>
      ) : null}
    </div>
  );
}
