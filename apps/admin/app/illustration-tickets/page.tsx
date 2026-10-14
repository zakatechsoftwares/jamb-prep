'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { ErrorState } from '../../src/components/ErrorState';
import { SignOutButton } from '../../src/components/SignOutButton';
import { useIllustrationBoard } from '../../src/hooks/useIllustrationBoard';

/**
 * The illustrator queue (plan 7.12 step 5).
 */
export default function IllustrationTicketsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const { state, claim } = useIllustrationBoard();
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

  async function handleClaim(ticketId: number) {
    setError(null);
    setClaiming(ticketId);
    const result = await claim(ticketId);
    setClaiming(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(`/illustration-tickets/${ticketId}`);
  }

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-surface-sunken p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Open illustration tickets</h1>
          <p className="text-xs text-muted">Claim scientific figures and diagrams needing vector illustration.</p>
        </div>
        <SignOutButton />
      </div>

      {state.status === 'loading' && (
        <div className="mt-8 flex items-center justify-center text-sm text-muted">
          Loading open illustration tickets…
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
          {state.tickets.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-gray-200/80 bg-surface p-8 text-center shadow-xs">
              <span className="text-3xl">🎨</span>
              <p className="mt-2 text-base font-semibold text-gray-800">No open illustration tickets right now</p>
              <p className="text-xs text-muted">All diagram requests are currently claimed or complete.</p>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {state.tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/90 bg-surface p-4 shadow-xs transition-all duration-150 hover:shadow-md"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-gray-900">{ticket.figureDescription}</span>
                    <span className="text-xs font-semibold text-muted">Ticket #{ticket.id}</span>
                  </div>
                  <button
                    type="button"
                    disabled={claiming === ticket.id}
                    onClick={() => handleClaim(ticket.id)}
                    className="h-touch rounded-xl bg-selected px-6 text-sm font-bold text-white shadow-xs transition-all duration-150 hover:bg-blue-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
                  >
                    {claiming === ticket.id ? 'Claiming…' : 'Claim'}
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
