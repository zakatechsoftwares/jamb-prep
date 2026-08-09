'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker (public/sw.js, plan 7.9 "offline
 * capable"). Best-effort: an unregistered or failed service worker means no
 * offline app-shell caching, not a broken app — reviewing data itself is
 * never routed through the service worker (see sw.js's `/api/` exclusion);
 * that guarantee lives entirely in `offline-store.ts`'s IndexedDB layer.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Nothing to recover into — see the module comment above.
    });
  }, []);

  return null;
}
