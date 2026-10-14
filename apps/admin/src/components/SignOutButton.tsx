'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

/**
 * Signs the reviewer out and clears this device's offline data
 * (`AuthProvider.signOut`).
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
        className="flex w-full flex-col gap-3 rounded-2xl border-2 border-escalate/40 bg-escalate-bg p-4 text-sm text-gray-900 shadow-xs"
      >
        <p className="font-medium leading-relaxed">
          You have {unsentCount} {unsentCount === 1 ? 'review' : 'reviews'} not yet uploaded.
          Reconnect and wait for {unsentCount === 1 ? 'it' : 'them'} to upload, or sign out now
          and lose {unsentCount === 1 ? 'it' : 'them'}.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setUnsentCount(null)}
            className="flex h-touch flex-1 items-center justify-center rounded-xl bg-selected px-4 font-bold text-white shadow-xs transition-colors hover:bg-blue-700"
          >
            Stay signed in
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void finishSignOut()}
            className="flex h-touch flex-1 items-center justify-center rounded-xl border border-reject/40 bg-surface px-4 font-bold text-reject shadow-2xs transition-colors hover:bg-reject-bg disabled:border-gray-200 disabled:text-gray-300"
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
      className="flex h-touch items-center justify-center rounded-xl border border-gray-200/90 bg-surface px-4 text-sm font-semibold text-gray-700 shadow-2xs transition-all duration-150 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.99] disabled:text-gray-300"
    >
      Sign out
    </button>
  );
}
