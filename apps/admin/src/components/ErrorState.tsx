export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-base text-reject">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="h-touch rounded-lg bg-selected px-6 text-base font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
