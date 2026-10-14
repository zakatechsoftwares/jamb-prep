'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { ErrorState } from '../../src/components/ErrorState';
import { SignOutButton } from '../../src/components/SignOutButton';
import { useBriefBoard } from '../../src/hooks/useBriefBoard';

/**
 * The open brief board (plan 7.12).
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
    <div className="flex h-dvh flex-col overflow-y-auto bg-surface-sunken p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Open briefs</h1>
          <p className="text-xs text-muted">Claim syllabus items to author and earn reviewer bounties.</p>
        </div>
        <SignOutButton />
      </div>

      {state.status === 'loading' && (
        <div className="mt-8 flex items-center justify-center text-sm text-muted">
          Loading open briefs…
        </div>
      )}
      {state.status === 'error' && (
        <ErrorState message={state.message} onRetry={() => location.reload()} />
      )}
      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-reject/30 bg-reject-bg p-3 text-sm font-semibold text-reject">
          {error}
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {state.briefs.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-gray-200/80 bg-surface p-8 text-center shadow-xs">
              <span className="text-3xl">📋</span>
              <p className="mt-2 text-base font-semibold text-gray-800">No open briefs right now</p>
              <p className="text-xs text-muted">Check back later when content leads commission new syllabus items.</p>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {state.briefs.map((brief) => (
                <li
                  key={brief.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/90 bg-surface p-4 shadow-xs transition-all duration-150 hover:shadow-md"
                >
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-gray-900">
                      Objective #{brief.objectiveId} — {brief.itemCount} item
                      {brief.itemCount === 1 ? '' : 's'} — ₦{(brief.feeKobo / 100).toLocaleString()} — due{' '}
                      {new Date(brief.deadline).toLocaleDateString()}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                        Fee: ₦{(brief.feeKobo / 100).toLocaleString()}
                      </span>
                      <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                        {brief.itemCount} item{brief.itemCount === 1 ? '' : 's'}
                      </span>
                      <span className="text-xs text-muted">
                        Due: {new Date(brief.deadline).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={claiming === brief.id}
                    onClick={() => handleClaim(brief.id)}
                    className="h-touch rounded-xl bg-selected px-6 text-sm font-bold text-white shadow-xs transition-all duration-150 hover:bg-blue-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
                  >
                    {claiming === brief.id ? 'Claiming…' : 'Claim'}
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
