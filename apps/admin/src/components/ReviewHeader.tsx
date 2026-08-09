/**
 * Plan 7.9's "live counters," visible at all times. Only the reviewed
 * count has a real source this session — the running accuracy and weekly
 * earnings both need session F / canonical session 09 (gold-item audits,
 * payment accrual), which does not exist yet. Rendering them as "—" is
 * deliberate: a guessed number here would be a quietly wrong result the
 * reviewer has no way to catch.
 */
export interface ReviewHeaderProps {
  reviewedThisSession: number;
}

export function ReviewHeader({ reviewedThisSession }: ReviewHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 text-xs">
      <Stat label="Reviewed this session" value={String(reviewedThisSession)} />
      <Stat label="Accuracy" value="—" />
      <Stat label="Earned this week" value="—" />
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
