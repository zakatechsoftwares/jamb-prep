import { OPTION_LABELS, type OptionLabel } from '@jamb/shared';
import type { ItemEditDraft, ItemEditDraftPatch } from '../lib/review-flow-reducer';

export interface InlineEditFormProps {
  draft: ItemEditDraft;
  pending: boolean;
  onChange: (patch: ItemEditDraftPatch) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Plan 7.9's "inline editing": correct a typo, swap a distractor, rewrite
 * the explanation, change the key — all without leaving the item.
 * Objective retagging is not offered here — the objective tree has no
 * browsable data source yet (no endpoint lists/searches objectives), so
 * that part of 7.9 is a known gap for this session, not a silent omission.
 */
export function InlineEditForm({
  draft,
  pending,
  onChange,
  onConfirm,
  onCancel,
}: InlineEditFormProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Stem</span>
        <textarea
          value={draft.stem}
          onChange={(event) => onChange({ stem: event.target.value })}
          rows={2}
          className="rounded-lg border-2 border-gray-200 p-2 text-base text-gray-900"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Options — pick the correct one
        </legend>
        {OPTION_LABELS.map((label) => (
          <div key={label} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct-option"
              aria-label={label}
              checked={draft.key === label}
              onChange={() => onChange({ key: label as OptionLabel })}
              className="size-5"
            />
            <input
              value={draft.options[label]}
              onChange={(event) => onChange({ options: { [label]: event.target.value } })}
              className="h-touch flex-1 rounded-lg border-2 border-gray-200 px-2 text-base text-gray-900"
            />
          </div>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Explanation</span>
        <textarea
          value={draft.explanation}
          onChange={(event) => onChange({ explanation: event.target.value })}
          rows={3}
          className="rounded-lg border-2 border-gray-200 p-2 text-base text-gray-900"
        />
      </label>

      <div className="mt-auto flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-touch flex-1 rounded-lg border-2 border-gray-200 bg-white text-base font-semibold text-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-touch flex-1 rounded-lg bg-approve text-base font-semibold text-white disabled:bg-gray-300"
        >
          Save and approve
        </button>
      </div>
    </div>
  );
}
