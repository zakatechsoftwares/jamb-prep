import { AlertTriangleIcon } from './icons';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangleIcon className="h-10 w-10 text-reject" />
      <p className="text-base font-medium text-reject">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="h-touch rounded-lg bg-selected px-6 text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
