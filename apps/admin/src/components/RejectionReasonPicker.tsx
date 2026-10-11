import { REJECTION_REASONS, type RejectionReason } from '@jamb/shared';

export interface RejectionReasonPickerProps {
  pending: boolean;
  onChoose: (reason: RejectionReason) => void;
  onCancel: () => void;
}

function label(reason: RejectionReason): string {
  return reason.replace(/_/g, ' ');
}

/**
 * Plan 7.9: "Rejection reason as a single tap from the fixed enum." No
 * free text anywhere here — REJECTION_REASONS is the whole vocabulary,
 * and tapping one is the entire interaction, not a first step toward
 * typing a note.
 */
export function RejectionReasonPicker({ pending, onChoose, onCancel }: RejectionReasonPickerProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Why reject?</p>
      <div className="grid grid-cols-2 gap-2">
        {REJECTION_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            disabled={pending}
            onClick={() => onChoose(reason)}
            className="h-touch rounded-lg border-2 border-gray-200 bg-surface px-2 text-sm font-medium capitalize text-gray-900 transition-colors duration-150 hover:border-reject hover:bg-reject-bg disabled:opacity-50"
          >
            {label(reason)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-auto h-touch shrink-0 rounded-lg border-2 border-gray-200 bg-surface px-6 text-base font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  );
}
