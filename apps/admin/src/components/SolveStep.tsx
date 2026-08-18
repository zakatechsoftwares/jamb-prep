import type { OptionLabel, ReviewQueueItem } from '@jamb/shared';
import { svgToImageSrc } from '../lib/svg-data-uri';

export interface SolveStepProps {
  item: ReviewQueueItem;
  selected: OptionLabel | null;
  pending: boolean;
  /**
   * The blind answer was recorded locally while offline and is waiting to
   * upload (session 08, 8.3). Reveal stays online-only — see
   * offline-store.ts — so there is nowhere for this item to advance to
   * until reconnection completes it; the reviewer is not stuck, they are
   * exactly where the anti-anchoring guarantee requires them to be.
   */
  queued?: boolean;
  onSelect: (option: OptionLabel) => void;
  onSubmit: () => void;
}

/**
 * The blind-solve step for a high risk_tier item (plan 7.10): the
 * reviewer records their own answer before anything about the proposed
 * key exists anywhere on screen. There is nothing here to anchor on by
 * design, not merely by omission.
 */
export function SolveStep({
  item,
  selected,
  pending,
  queued = false,
  onSelect,
  onSubmit,
}: SolveStepProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <p className="text-lg font-medium text-gray-900">{item.stem}</p>

      {item.diagram && (
        <img
          src={svgToImageSrc(item.diagram.svgMarkup)}
          alt={item.diagram.altText}
          className="max-w-full rounded-lg border-2 border-gray-200"
        />
      )}

      <div className="flex flex-col gap-2">
        {item.options.map((option) => {
          const isSelected = selected === option.label;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => onSelect(option.label as OptionLabel)}
              aria-pressed={isSelected}
              disabled={queued}
              className={`h-touch rounded-lg border-2 px-4 text-left text-base disabled:opacity-60 ${
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

      {queued && (
        <p className="text-sm text-gray-500">
          Answer queued — will reveal the key once you&apos;re back online.
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={selected === null || pending || queued}
        className="mt-auto h-touch shrink-0 rounded-lg bg-selected px-6 text-base font-semibold text-white disabled:bg-gray-300"
      >
        Submit answer
      </button>
    </div>
  );
}
