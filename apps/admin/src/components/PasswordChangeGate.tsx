'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { CHANGE_PASSWORD_ROUTE } from '../lib/home-route';

/**
 * Keeps a session that still holds a temporary password on the
 * change-password screen. Mounted once in the root layout rather than
 * checked page by page, and it renders nothing in place of the page — not
 * the page plus a redirect — so no page's own data-fetching effect gets to
 * fire for that session first (the same reason the content-lead hooks take
 * an `enabled` flag).
 *
 * A client-side gate only: the API does not refuse a must-change session.
 * The point is that the content lead who issued the temporary password
 * never knows the one the reviewer settles on, and anyone holding the
 * temporary password could change it themselves either way.
 */
export function PasswordChangeGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const blocked = session?.mustChangePassword === true && pathname !== CHANGE_PASSWORD_ROUTE;

  useEffect(() => {
    if (blocked) {
      router.replace(CHANGE_PASSWORD_ROUTE);
    }
  }, [blocked, router]);

  return blocked ? null : <>{children}</>;
}
