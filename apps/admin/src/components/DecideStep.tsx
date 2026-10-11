import type { ReviewQueueItem, RevealResult } from '@jamb/shared';
import { svgToImageSrc } from '../lib/svg-data-uri';
import { AlertTriangleIcon, CheckIcon, PencilIcon, XIcon } from './icons';

/**
 * A visual keyboard-shortcut hint, `aria-hidden` so it never becomes part
 * of the button's accessible name -- tests match on an exact anchored
 * name (e.g. `/^approve$/i`), which a visible "1" inside the button would
 * otherwise break.
 */
function KeyHint({ keyLabel }: { keyLabel: string }) {
  return (
    <span
      aria-hidden="true"
      className="rounded border border-white/40 px-1 text-xs font-normal opacity-80"
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
 * explanation, the machine's independent-solve verdict, and — when this
 * reviewer blind-solved it (high risk_tier only; `agreesWithKey` is null
 * otherwise, per `agreesWithKey()`'s contract) — whether they agreed,
 * with disagreement the most visually prominent thing on the screen.
 * Four actions, nothing else: Approve and Escalate decide immediately;
 * Reject and Edit and approve each need one more step (a reason, a
 * patch) before the decision is a real one.
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
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {reveal.agreesWithKey === false && (
        <div className="flex items-center gap-2 rounded-lg border-2 border-reject bg-reject-bg p-3 text-sm font-semibold text-reject">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />
          You disagreed with the proposed key.
        </div>
      )}
      {reveal.agreesWithKey === true && (
        <div className="flex items-center gap-2 rounded-lg border border-approve bg-approve-bg p-2 text-sm text-approve">
          <CheckIcon className="h-4 w-4 shrink-0" />
          You agreed with the proposed key.
        </div>
      )}

      <p className="text-lg font-medium text-gray-900">{item.stem}</p>

      {item.diagram && (
        <img
          src={svgToImageSrc(item.diagram.svgMarkup)}
          alt={item.diagram.altText}
          className="max-w-full rounded-lg border border-gray-200 shadow-sm"
        />
      )}

      <div className="flex flex-col gap-2">
        {item.options.map((option) => {
          const isCorrect = reveal.correctOption === option.label;
          return (
            <div
              key={option.label}
              className={`rounded-lg border-2 px-4 py-2 text-base transition-colors duration-150 ${
                isCorrect
                  ? 'border-approve bg-approve-bg font-semibold shadow-sm'
                  : 'border-gray-200 bg-surface'
              }`}
            >
              <span className="mr-2 font-semibold">{option.label}.</span>
              {option.text}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-gray-200 bg-surface-sunken p-3 text-sm text-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Explanation — machine verdict: {reveal.verdict}
        </p>
        {reveal.explanation}
      </div>

      <div className="mt-auto grid shrink-0 grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-lg bg-approve text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-green-700 disabled:bg-gray-300 disabled:shadow-none"
        >
          <CheckIcon className="h-5 w-5" />
          Approve
          <KeyHint keyLabel="1" />
        </button>
        <button
          type="button"
          onClick={onStartEdit}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-lg bg-selected text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700 disabled:bg-gray-300 disabled:shadow-none"
        >
          <PencilIcon className="h-5 w-5" />
          Edit and approve
          <KeyHint keyLabel="2" />
        </button>
        <button
          type="button"
          onClick={onStartReject}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-lg bg-reject text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-red-700 disabled:bg-gray-300 disabled:shadow-none"
        >
          <XIcon className="h-5 w-5" />
          Reject
          <KeyHint keyLabel="3" />
        </button>
        <button
          type="button"
          onClick={onEscalate}
          disabled={pending}
          className="flex h-touch items-center justify-center gap-2 rounded-lg bg-escalate text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-amber-700 disabled:bg-gray-300 disabled:shadow-none"
        >
          <AlertTriangleIcon className="h-5 w-5" />
          Escalate
          <KeyHint keyLabel="4" />
        </button>
      </div>
    </div>
  );
}
