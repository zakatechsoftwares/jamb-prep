import { CheckCircleIcon } from './icons';

export interface EmptyQueueStateProps {
  onRetry: () => void;
}

/**
 * The queue draining is an ordinary state, not an error.
 */
export function EmptyQueueState({ onRetry }: EmptyQueueStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-gray-200/90 bg-surface p-8 shadow-xs">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-approve-bg text-approve shadow-2xs">
          <CheckCircleIcon className="h-8 w-8" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xl font-bold tracking-tight text-gray-900">All caught up</p>
          <p className="text-sm text-muted">Nothing to review right now. Check back soon.</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 flex h-touch w-full items-center justify-center rounded-xl bg-selected px-6 text-base font-bold text-white shadow-xs transition-all duration-150 hover:bg-blue-700 active:scale-[0.99]"
        >
          Check again
        </button>
      </div>
    </div>
  );
}
