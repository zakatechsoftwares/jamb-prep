import { AlertTriangleIcon } from './icons';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-reject/30 bg-surface p-8 shadow-xs">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-reject-bg text-reject shadow-2xs">
          <AlertTriangleIcon className="h-8 w-8" />
        </div>
        <p className="text-base font-semibold text-gray-900">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 flex h-touch w-full items-center justify-center rounded-xl bg-selected px-6 text-base font-bold text-white shadow-xs transition-all duration-150 hover:bg-blue-700 active:scale-[0.99]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
