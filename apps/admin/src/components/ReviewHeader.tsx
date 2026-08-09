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
}

export function ReviewHeader({
  reviewedThisSession,
  isOnline = true,
  cachedItemCount = 0,
  pendingDecisionCount = 0,
  nextClaimExpiry = null,
  lateArrivalCount = 0,
}: ReviewHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 text-xs">
      <Stat label="Reviewed this session" value={String(reviewedThisSession)} />
      <Stat label="Accuracy" value="—" />
      <Stat label="Earned this week" value="—" />

      {!isOnline && (
        <span className="rounded-full bg-reject-bg px-2 py-1 font-semibold text-reject">
          Offline
        </span>
      )}
      {cachedItemCount > 0 && <Stat label="Cached" value={String(cachedItemCount)} />}
      {pendingDecisionCount > 0 && (
        <Stat label="Pending upload" value={String(pendingDecisionCount)} />
      )}
      {nextClaimExpiry && (
        <span className="text-gray-500">
          Earliest cached claim expires{' '}
          {nextClaimExpiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {lateArrivalCount > 0 && (
        <Stat label="Recorded as second opinion" value={String(lateArrivalCount)} />
      )}
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-sm font-semibold text-gray-900">{value}</span>
      <span className="uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}
