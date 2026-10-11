import { CheckCircleIcon } from './icons';

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
      <CheckCircleIcon className="h-10 w-10 text-approve" />
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-gray-900">All caught up</p>
        <p className="text-sm text-muted">Nothing to review right now. Check back soon.</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-touch rounded-lg bg-selected px-6 text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700"
      >
        Check again
      </button>
    </div>
  );
}
