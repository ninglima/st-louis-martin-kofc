'use client';

import { useEffect } from 'react';

import { createPrewarmer } from '~/lib/prewarm';

export function PortalPrewarm() {
  useEffect(() => {
    const prewarm = createPrewarmer({
      pageOrigin: window.location.origin,
      fetchVersion: () => {
        void fetch('/version', { cache: 'no-store' }).catch(() => {});
      },
    });

    const onIntent = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      prewarm(anchor?.getAttribute('href') ?? null);
    };

    const events = ['pointerover', 'focusin', 'touchstart'] as const;
    events.forEach((name) =>
      document.addEventListener(name, onIntent, { passive: true }),
    );

    return () =>
      events.forEach((name) => document.removeEventListener(name, onIntent));
  }, []);

  return null;
}
