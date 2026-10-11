'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

/**
 * Signs the reviewer out and clears this device's offline data
 * (`AuthProvider.signOut`). When reviews are still waiting to upload — the
 * reviewer worked offline and hasn't reconnected — it warns first: signing
 * out discards them, since queued work is never uploaded under the next
 * person's session. The reviewer chooses; nothing is blocked.
 */
export function SignOutButton() {
  const { offlineStore, signOut } = useAuth();
  const router = useRouter();
  const [unsentCount, setUnsentCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function finishSignOut() {
    setBusy(true);
    await signOut();
    router.replace('/login');
  }

  async function handleClick() {
    setBusy(true);
    const pending = offlineStore
      ? (await offlineStore.countPendingDecisions()) + (await offlineStore.countPendingSolves())
      : 0;
    if (pending > 0) {
      setBusy(false);
      setUnsentCount(pending);
      return;
    }
    await finishSignOut();
  }

  if (unsentCount !== null) {
    return (
      <div
        role="alertdialog"
        aria-label="Unsent reviews"
        className="flex w-full flex-col gap-2 rounded-lg border-2 border-escalate bg-escalate-bg p-3 text-sm text-gray-900"
      >
        <p>
          You have {unsentCount} {unsentCount === 1 ? 'review' : 'reviews'} not yet uploaded.
          Reconnect and wait for {unsentCount === 1 ? 'it' : 'them'} to upload, or sign out now
          and lose {unsentCount === 1 ? 'it' : 'them'}.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setUnsentCount(null)}
            className="h-touch flex-1 rounded-lg bg-selected px-4 font-semibold text-white"
          >
            Stay signed in
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void finishSignOut()}
            className="h-touch flex-1 rounded-lg border-2 border-reject bg-surface px-4 font-semibold text-reject disabled:border-gray-200 disabled:text-gray-300"
          >
            Sign out anyway
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handleClick()}
      className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-4 text-sm font-semibold text-gray-900 disabled:text-gray-300"
    >
      Sign out
    </button>
  );
}
