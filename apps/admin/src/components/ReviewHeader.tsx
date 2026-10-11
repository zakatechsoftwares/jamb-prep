/**
 * Plan 7.9's "live counters," visible at all times. Only the reviewed
 * count has a real source this session — the running accuracy and weekly
 * earnings both need session F / canonical session 09 (gold-item audits,
 * payment accrual), which does not exist yet. Rendering them as "—" is
 * deliberate: a guessed number here would be a quietly wrong result the
 * reviewer has no way to catch.
 *
 * The offline stats (session 08, 8.3) are conditionally shown: normal,
 * fully-synced operation shouldn't clutter the header with zeros, but
 * anything worth the reviewer's attention — being offline, work waiting to
 * cache or sync, a decision the server filed as a late-arriving second
 * opinion rather than the authoritative outcome — is never hidden.
 */
export interface ReviewHeaderProps {
  reviewedThisSession: number;
  isOnline?: boolean;
  cachedItemCount?: number;
  pendingDecisionCount?: number;
  nextClaimExpiry?: Date | null;
  lateArrivalCount?: number;
  /** Shown as a small button when provided; the page owns the navigation. */
  onChangePassword?: () => void;
  /** Rendered at the end of the header — the page passes its sign-out control. */
  children?: ReactNode;
}

import type { ReactNode } from 'react';
import { WifiOffIcon } from './icons';

export function ReviewHeader({
  reviewedThisSession,
  isOnline = true,
  cachedItemCount = 0,
  pendingDecisionCount = 0,
  nextClaimExpiry = null,
  lateArrivalCount = 0,
  onChangePassword,
  children,
}: ReviewHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-surface px-3 py-2 text-xs shadow-sm">
      <Stat label="Reviewed this session" value={String(reviewedThisSession)} />
      <Stat label="Accuracy" value="—" />
      <Stat label="Earned this week" value="—" />

      {!isOnline && (
        <span className="flex items-center gap-1 rounded-full bg-reject-bg px-2 py-1 font-semibold text-reject">
          <WifiOffIcon className="h-3.5 w-3.5" />
          Offline
        </span>
      )}
      {cachedItemCount > 0 && <Stat label="Cached" value={String(cachedItemCount)} />}
      {pendingDecisionCount > 0 && (
        <Stat label="Pending upload" value={String(pendingDecisionCount)} />
      )}
      {nextClaimExpiry && (
        <span className="text-muted">
          Earliest cached claim expires{' '}
          {nextClaimExpiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {lateArrivalCount > 0 && (
        <Stat label="Recorded as second opinion" value={String(lateArrivalCount)} />
      )}
      {onChangePassword && (
        <button
          type="button"
          onClick={onChangePassword}
          className="rounded-lg px-2 py-1 font-semibold text-selected underline-offset-2 hover:underline"
        >
          Change password
        </button>
      )}
      {children}
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg px-2 py-1">
      <span className="text-sm font-semibold text-gray-900">{value}</span>
      <span className="uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}
