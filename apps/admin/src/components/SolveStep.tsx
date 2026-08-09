import type { OptionLabel, ReviewQueueItem } from '@jamb/shared';

export interface SolveStepProps {
  item: ReviewQueueItem;
  selected: OptionLabel | null;
  pending: boolean;
  onSelect: (option: OptionLabel) => void;
  onSubmit: () => void;
}

/**
 * The blind-solve step for a high risk_tier item (plan 7.10): the
 * reviewer records their own answer before anything about the proposed
 * key exists anywhere on screen. There is nothing here to anchor on by
 * design, not merely by omission.
 */
export function SolveStep({ item, selected, pending, onSelect, onSubmit }: SolveStepProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <p className="text-lg font-medium text-gray-900">{item.stem}</p>

      <div className="flex flex-col gap-2">
        {item.options.map((option) => {
          const isSelected = selected === option.label;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => onSelect(option.label as OptionLabel)}
              aria-pressed={isSelected}
              className={`h-touch rounded-lg border-2 px-4 text-left text-base ${
                isSelected
                  ? 'border-selected bg-selected-bg font-semibold text-gray-900'
                  : 'border-gray-200 bg-white text-gray-900'
              }`}
            >
              <span className="mr-2 font-semibold">{option.label}.</span>
              {option.text}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={selected === null || pending}
        className="mt-auto h-touch shrink-0 rounded-lg bg-selected px-6 text-base font-semibold text-white disabled:bg-gray-300"
      >
        Submit answer
      </button>
    </div>
  );
}
