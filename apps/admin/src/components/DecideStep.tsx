import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import { svgToImageSrc } from '../lib/svg-data-uri';
import { AlertTriangleIcon, CheckIcon, PencilIcon, XIcon } from './icons';

/**
 * A visual keyboard-shortcut hint, `aria-hidden` so it never becomes part
 * of the button's accessible name.
 */
function KeyHint({ keyLabel }: { keyLabel: string }) {
  return (
    <span
      aria-hidden="true"
      className="ml-1 rounded border border-white/40 px-1.5 py-0.5 text-[11px] font-mono font-semibold opacity-90 shadow-2xs"
    >
      {keyLabel}
    </span>
  );
}

export interface DecideStepProps {
  item: ReviewQueueItem;
  reveal: RevealResult;
  pending: boolean;
  onApprove: () => void;
  onEscalate: () => void;
  onStartReject: () => void;
  onStartEdit: () => void;
}

/**
 * Full context on one screen (plan 7.9): the item, the proposed key, the
 * explanation, the machine's independent-solve verdict, and whether the reviewer agreed.
 */
export function DecideStep({
  item,
  reveal,
  pending,
  onApprove,
  onEscalate,
  onStartReject,
  onStartEdit,
}: DecideStepProps) {
  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-6">
      {/* Agreement / Disagreement Banner */}
      {reveal.agreesWithKey === false && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-reject bg-reject-bg p-3.5 text-sm font-semibold text-reject shadow-xs">
          <AlertTriangleIcon className="h-5 w-5 shrink-0" />
          <span>You disagreed with the proposed key.</span>
        </div>
      )}
      {reveal.agreesWithKey === true && (
        <div className="flex items-center gap-2.5 rounded-xl border border-approve bg-approve-bg p-3 text-sm font-semibold text-approve shadow-xs">
          <CheckIcon className="h-5 w-5 shrink-0" />
          <span>You agreed with the proposed key.</span>
        </div>
      )}

      {/* Stem Card */}
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

      {/* Options List */}
      <div className="flex flex-col gap-2.5">
        {item.options.map((option) => {
          const isCorrect = reveal.correctOption === option.label;
          return (
            <div
              key={option.label}
              className={`flex items-center rounded-xl border-2 px-4 py-2.5 text-base shadow-2xs transition-colors duration-150 ${
                isCorrect
                  ? 'border-approve bg-approve-bg font-semibold text-gray-900 ring-2 ring-approve/20'
                  : 'border-gray-200/90 bg-surface text-gray-800'
              }`}
            >
              <span
                className={`mr-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isCorrect ? 'bg-approve text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {option.label}
              </span>
              <span className="flex-1">{option.text}</span>
            </div>
          );
        })}
      </div>

      {/* Explanation Box */}
      <div className="rounded-xl border border-gray-200/90 bg-surface p-4 shadow-xs">
        <div className="mb-2 flex items-center justify-between border-b border-gray-100 pb-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">
            Explanation — machine verdict: {reveal.verdict}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-gray-700">{reveal.explanation}</p>
      </div>

      {/* 4 Action Controls */}
      <div className="mt-auto grid shrink-0 grid-cols-2 gap-2.5 pt-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-xl bg-approve text-base font-bold text-white shadow-xs transition-all duration-150 hover:bg-emerald-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
        >
          <CheckIcon className="h-5 w-5" />
          Approve
          <KeyHint keyLabel="1" />
        </button>
        <button
          type="button"
          onClick={onStartEdit}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-xl bg-selected text-base font-bold text-white shadow-xs transition-all duration-150 hover:bg-blue-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
        >
          <PencilIcon className="h-5 w-5" />
          Edit and approve
          <KeyHint keyLabel="2" />
        </button>
        <button
          type="button"
          onClick={onStartReject}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-xl bg-reject text-base font-bold text-white shadow-xs transition-all duration-150 hover:bg-rose-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
        >
          <XIcon className="h-5 w-5" />
          Reject
          <KeyHint keyLabel="3" />
        </button>
        <button
          type="button"
          onClick={onEscalate}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-xl bg-escalate text-base font-bold text-white shadow-xs transition-all duration-150 hover:bg-amber-700 active:scale-[0.99] disabled:bg-gray-300 disabled:shadow-none"
        >
          <AlertTriangleIcon className="h-5 w-5" />
          Escalate
          <KeyHint keyLabel="4" />
        </button>
      </div>
    </div>
  );
}
