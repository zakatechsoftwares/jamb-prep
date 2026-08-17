'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { ErrorState } from '../../src/components/ErrorState';
import { useBriefBoard } from '../../src/hooks/useBriefBoard';

/**
 * The open brief board (plan 7.12). Gated only on having a session at all —
 * no role check — matching how the review queue treats reviewers and
 * contributors as one pool with no role-based wall. Deliberately just a
 * list-and-claim board, nothing more: no filter, no search, matching this
 * workspace's existing anti-cherry-picking stance for the review queue.
 */
export default function BriefsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const { state, claim } = useBriefBoard();
  const [claiming, setClaiming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    }
  }, [session, router]);

  if (!session) {
    return null;
  }

  async function handleClaim(briefId: number) {
    setError(null);
    setClaiming(briefId);
    const result = await claim(briefId);
    setClaiming(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(`/briefs/${briefId}/author`);
  }

  return (
    <div className="flex h-dvh flex-col overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-gray-900">Open briefs</h1>

      {state.status === 'loading' && <p className="text-sm text-gray-500">Loading…</p>}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={() => location.reload()} />}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-reject">
          {error}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          {state.briefs.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No open briefs right now.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {state.briefs.map((brief) => (
                <li
                  key={brief.id}
                  className="flex items-center justify-between rounded-lg border-2 border-gray-200 p-3 text-sm"
                >
                  <span>
                    Objective #{brief.objectiveId} — {brief.itemCount} item
                    {brief.itemCount === 1 ? '' : 's'} — ₦{(brief.feeKobo / 100).toLocaleString()} — due{' '}
                    {new Date(brief.deadline).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    disabled={claiming === brief.id}
                    onClick={() => handleClaim(brief.id)}
                    className="h-touch rounded-lg bg-selected px-4 text-sm font-semibold text-white disabled:bg-gray-300"
                  >
                    Claim
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
