import type { OptionLabel, ReviewQueueItem } from '@jamb/shared';
import { svgToImageSrc } from '../lib/svg-data-uri';

export interface SolveStepProps {
  item: ReviewQueueItem;
  selected: OptionLabel | null;
  pending: boolean;
  queued?: boolean;
  onSelect: (option: OptionLabel) => void;
  onSubmit: () => void;
}

/**
 * The blind-solve step for a high risk_tier item (plan 7.10): the
 * reviewer records their own answer before anything about the proposed
 * key exists anywhere on screen.
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
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      {/* Anti-anchoring banner */}
      <div className="flex items-center justify-between rounded-xl border border-blue-200/60 bg-blue-50/50 px-4 py-2.5 text-xs text-blue-900">
        <span className="font-semibold uppercase tracking-wider text-blue-700">
          Independent Blind Solve
        </span>
        <span className="text-muted">Item #{item.itemId}</span>
      </div>

      <div className="rounded-xl border border-gray-200/90 bg-surface p-5 shadow-xs">
        <p className="text-lg font-medium leading-relaxed text-gray-900">{item.stem}</p>
      </div>

      {item.diagram && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-surface p-2 shadow-xs">
          <img
            src={svgToImageSrc(item.diagram.svgMarkup)}
            alt={item.diagram.altText}
            className="max-w-full rounded-lg"
          />
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {item.options.map((option) => {
          const isSelected = selected === option.label;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => onSelect(option.label as OptionLabel)}
              aria-pressed={isSelected}
              disabled={queued}
              className={`flex h-touch items-center rounded-xl border-2 px-4 text-left text-base shadow-2xs transition-all duration-150 disabled:opacity-60 ${
                isSelected
                  ? 'border-selected bg-selected-bg font-semibold text-gray-900 ring-2 ring-selected/20'
                  : 'border-gray-200/90 bg-surface text-gray-900 hover:border-gray-300 hover:bg-gray-50/50'
              }`}
            >
              <span
                className={`mr-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isSelected ? 'bg-selected text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {option.label}
              </span>
              <span className="flex-1">{option.text}</span>
            </button>
          );
        })}
      </div>

      {queued && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Answer queued — will reveal the key once you&apos;re back online.
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={selected === null || pending || queued}
        className="mt-auto flex h-touch shrink-0 items-center justify-center rounded-xl bg-selected px-6 text-base font-bold text-white shadow-sm transition-all duration-150 hover:bg-blue-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
      >
        Submit answer
      </button>
    </div>
  );
}
