export interface EmptyQueueStateProps {
  onRetry: () => void;
}

/**
 * The queue draining is an ordinary state, not an error — 7.9 gives the
 * reviewer no list, filter or search to fall back on, so this is the
 * entire "there's nothing right now" experience.
 */
export function EmptyQueueState({ onRetry }: EmptyQueueStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-base text-gray-600">Nothing to review right now. Check back soon.</p>
      <button
        type="button"
        onClick={onRetry}
        className="h-touch rounded-lg bg-selected px-6 text-base font-semibold text-white"
      >
        Check again
      </button>
    </div>
  );
}
