import type { ReviewQueueItem, RevealResult } from '@jamb/shared';

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
        <div className="rounded-lg border-2 border-reject bg-reject-bg p-3 text-sm font-semibold text-reject">
          You disagreed with the proposed key.
        </div>
      )}
      {reveal.agreesWithKey === true && (
        <div className="rounded-lg border border-approve bg-approve-bg p-2 text-sm text-approve">
          You agreed with the proposed key.
        </div>
      )}

      <p className="text-lg font-medium text-gray-900">{item.stem}</p>

      <div className="flex flex-col gap-2">
        {item.options.map((option) => {
          const isCorrect = reveal.correctOption === option.label;
          return (
            <div
              key={option.label}
              className={`rounded-lg border-2 px-4 py-2 text-base ${
                isCorrect ? 'border-approve bg-approve-bg font-semibold' : 'border-gray-200 bg-white'
              }`}
            >
              <span className="mr-2 font-semibold">{option.label}.</span>
              {option.text}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg bg-gray-100 p-3 text-sm text-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Explanation — machine verdict: {reveal.verdict}
        </p>
        {reveal.explanation}
      </div>

      <div className="mt-auto grid shrink-0 grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={pending}
          className="h-touch rounded-lg bg-approve text-base font-semibold text-white disabled:bg-gray-300"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onStartEdit}
          disabled={pending}
          className="h-touch rounded-lg bg-selected text-base font-semibold text-white disabled:bg-gray-300"
        >
          Edit and approve
        </button>
        <button
          type="button"
          onClick={onStartReject}
          disabled={pending}
          className="h-touch rounded-lg bg-reject text-base font-semibold text-white disabled:bg-gray-300"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onEscalate}
          disabled={pending}
          className="h-touch rounded-lg bg-escalate text-base font-semibold text-white disabled:bg-gray-300"
        >
          Escalate
        </button>
      </div>
    </div>
  );
}
