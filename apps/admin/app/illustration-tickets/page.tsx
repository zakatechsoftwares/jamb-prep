'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { ErrorState } from '../../src/components/ErrorState';
import { useIllustrationBoard } from '../../src/hooks/useIllustrationBoard';

/**
 * The illustrator queue (plan 7.12 step 5). Gated only on having a session
 * at all — no role check — matching the brief board's own decision that
 * illustrators are not a new role. Deliberately just a list-and-claim
 * board, nothing more, same anti-cherry-picking stance as the review queue
 * and the brief board.
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
    <div className="flex h-dvh flex-col overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-gray-900">Open illustration tickets</h1>

      {state.status === 'loading' && <p className="text-sm text-gray-500">Loading…</p>}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={() => location.reload()} />}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-reject">
          {error}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          {state.tickets.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No open illustration tickets right now.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {state.tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex items-center justify-between rounded-lg border-2 border-gray-200 p-3 text-sm"
                >
                  <span>{ticket.figureDescription}</span>
                  <button
                    type="button"
                    disabled={claiming === ticket.id}
                    onClick={() => handleClaim(ticket.id)}
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
