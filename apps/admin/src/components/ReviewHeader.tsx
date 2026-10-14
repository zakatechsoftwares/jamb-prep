/**
 * Plan 7.9's "live counters," visible at all times.
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
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-surface px-4 py-2.5 text-xs shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Stat label="Reviewed this session" value={String(reviewedThisSession)} highlight />
        <Stat label="Accuracy" value="—" />
        <Stat label="Earned this week" value="—" />

        {!isOnline && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-reject/20 bg-reject-bg px-2.5 py-1 font-semibold text-reject shadow-xs">
            <WifiOffIcon className="h-3.5 w-3.5 animate-pulse" />
            Offline
          </span>
        )}
        {cachedItemCount > 0 && <Stat label="Cached" value={String(cachedItemCount)} />}
        {pendingDecisionCount > 0 && (
          <Stat label="Pending upload" value={String(pendingDecisionCount)} />
        )}
        {lateArrivalCount > 0 && (
          <Stat label="Recorded as second opinion" value={String(lateArrivalCount)} />
        )}
      </div>

      <div className="flex items-center gap-2">
        {nextClaimExpiry && (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-muted">
            Earliest cached claim expires{' '}
            <strong className="font-semibold text-gray-700">
              {nextClaimExpiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </strong>
          </span>
        )}
        {onChangePassword && (
          <button
            type="button"
            onClick={onChangePassword}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-semibold text-selected shadow-2xs transition-colors hover:bg-selected-bg hover:border-selected/30"
          >
            Change password
          </button>
        )}
        {children}
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 transition-colors ${
        highlight
          ? 'border-selected/20 bg-selected-bg/60 text-selected'
          : 'border-gray-200/80 bg-surface-sunken text-gray-700'
      }`}
    >
      <span className="text-sm font-bold tracking-tight text-gray-900">{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
    </div>
  );
}
