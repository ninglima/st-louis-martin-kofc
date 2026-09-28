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
      {timedOut ? (
        <Button onClick={() => window.location.reload()}>Try again</Button>
      ) : (
        <>
          <Spinner />
          <p className={'text-muted-foreground text-lg'}>Please wait...</p>
        </>
      )}
    </div>
  );
}
