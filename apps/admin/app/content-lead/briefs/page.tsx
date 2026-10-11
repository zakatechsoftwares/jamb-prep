'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../src/auth/AuthProvider';
import { CreateBriefForm } from '../../../src/components/CreateBriefForm';
import { ErrorState } from '../../../src/components/ErrorState';
import { SignOutButton } from '../../../src/components/SignOutButton';
import { useContentLeadBriefs } from '../../../src/hooks/useContentLeadBriefs';

/**
 * Coverage gaps and brief creation (plan 7.12) — a `content_lead`-only
 * route, gated exactly like `/content-lead`.
 */
export default function ContentLeadBriefsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<number | undefined>(undefined);
  const { state, refresh, createBrief } = useContentLeadBriefs(session?.role === 'content_lead');

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

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-surface-sunken">
      <div className="flex items-center justify-between gap-2 p-6 pb-0">
        <h1 className="text-xl font-semibold text-gray-900">Coverage gaps</h1>
        <SignOutButton />
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading…</div>
      )}

      {state.status === 'forbidden' && (
        <div className="flex flex-1 items-center justify-center text-sm text-reject">
          You do not have access to this page.
        </div>
      )}

      {state.status === 'error' && <ErrorState message={state.message} onRetry={refresh} />}

      {state.status === 'ready' && (
        <>
          {state.gaps.length === 0 ? (
            <p className="p-6 text-sm text-muted">No coverage gaps detected.</p>
          ) : (
            <ul className="flex flex-col gap-2 p-6">
              {state.gaps.map((gap) => (
                <li
                  key={gap.objectiveId}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-surface p-3 text-sm shadow-sm transition-shadow duration-150 hover:shadow-md"
                >
                  <span>
                    Objective #{gap.objectiveId} — short by {gap.deficit}
                    {gap.requiresHumanAuthorship ? ' (human authorship required)' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedObjectiveId(gap.objectiveId)}
                    className="h-touch rounded-lg bg-selected px-4 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700"
                  >
                    Create brief
                  </button>
                </li>
              ))}
            </ul>
          )}

          <CreateBriefForm
            key={selectedObjectiveId}
            initialObjectiveId={selectedObjectiveId}
            onSubmit={createBrief}
          />
        </>
      )}
    </div>
  );
}
