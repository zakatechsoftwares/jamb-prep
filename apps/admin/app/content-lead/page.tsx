'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { ContentLeadDashboard } from '../../src/components/ContentLeadDashboard';
import { ErrorState } from '../../src/components/ErrorState';
import { useContentLeadDashboard } from '../../src/hooks/useContentLeadDashboard';

/** How far back the dashboard's time-windowed metrics look by default. */
const WINDOW_DAYS = 7;

/**
 * The content-lead dashboard (plan 7.11) — a `content_lead`-only route.
 * Anyone without a session is redirected to /login, the same as '/'; a
 * session that isn't content_lead is redirected to the reviewer workspace
 * rather than shown a 403 page, since every other role's actual workspace
 * already lives there.
 */
export default function ContentLeadPage() {
  const { session } = useAuth();
  const router = useRouter();
  // Computed once on mount, not on every render — a fresh `new Date()` in
  // the render body would shift by milliseconds each render and retrigger
  // useContentLeadDashboard's effect in a loop.
  const [since] = useState(() => new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const { state, refresh } = useContentLeadDashboard(since, session?.role === 'content_lead');

  useEffect(() => {
    if (!session) {
      router.replace('/login');
      return;
    }
    if (session.role !== 'content_lead') {
      router.replace('/');
    }
  }, [session, router]);

  if (!session || session.role !== 'content_lead') {
    return null;
  }

  // router.push, never a plain <a href>: the session lives only in memory,
  // so a full page load would sign the content lead out.
  return (
    <div className="flex h-dvh flex-col">
      <nav
        aria-label="Content lead"
        className="flex shrink-0 flex-wrap gap-2 border-b border-gray-200 bg-surface px-3 py-2"
      >
        <button
          type="button"
          onClick={() => router.push('/content-lead/reviewers')}
          className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900"
        >
          Review panel
        </button>
        <button
          type="button"
          onClick={() => router.push('/content-lead/briefs')}
          className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900"
        >
          Coverage gaps
        </button>
        <button
          type="button"
          onClick={() => router.push('/account/password')}
          className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900"
        >
          Change password
        </button>
      </nav>

      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          Loading…
        </div>
      )}

      {state.status === 'forbidden' && (
        <div className="flex flex-1 items-center justify-center text-sm text-reject">
          You do not have access to this dashboard.
        </div>
      )}

      {state.status === 'error' && <ErrorState message={state.message} onRetry={refresh} />}

      {state.status === 'ready' && (
        <div className="flex-1 overflow-y-auto">
          <ContentLeadDashboard dashboard={state.dashboard} />
        </div>
      )}
    </div>
  );
}
