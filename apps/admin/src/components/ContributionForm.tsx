'use client';

import { useState, type FormEvent } from 'react';
import type { ContributedItemInput, OptionLabel } from '@jamb/shared';

const OPTION_LABELS: readonly OptionLabel[] = ['A', 'B', 'C', 'D'];

export interface ContributionFormProps {
  onSubmit: (
    draft: ContributedItemInput,
    sketchPhoto: File | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}

interface OptionDraft {
  text: string;
  distractorRationale: string;
}

/**
 * The structured authoring form for a claimed brief (plan 7.12 step 3) —
 * produces the exact same item schema as a generated item: stem, four
 * options, one key, a distractor rationale on every wrong option,
 * explanation, method steps. The brief's own objective is fixed, so unlike
 * a reviewer's inline edit there is no objective picker here.
 */
export function ContributionForm({ onSubmit }: ContributionFormProps) {
  const [stem, setStem] = useState('');
  const [options, setOptions] = useState<Record<OptionLabel, OptionDraft>>({
    A: { text: '', distractorRationale: '' },
    B: { text: '', distractorRationale: '' },
    C: { text: '', distractorRationale: '' },
    D: { text: '', distractorRationale: '' },
  });
  const [correctLabel, setCorrectLabel] = useState<OptionLabel>('A');
  const [explanation, setExplanation] = useState('');
  const [methodStepsText, setMethodStepsText] = useState('');
  const [cognitiveLevel, setCognitiveLevel] = useState('recall');
  const [authorDifficulty, setAuthorDifficulty] = useState('0.5');
  const [expectedTimeSeconds, setExpectedTimeSeconds] = useState('60');
  const [needsDiagram, setNeedsDiagram] = useState(false);
  const [figureDescription, setFigureDescription] = useState('');
  const [sketchPhoto, setSketchPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  function updateOption(label: OptionLabel, patch: Partial<OptionDraft>) {
    setOptions((current) => ({ ...current, [label]: { ...current[label], ...patch } }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (stem.trim() === '') {
      setError('Stem is required.');
      return;
    }
    if (explanation.trim() === '') {
      setError('Explanation is required.');
      return;
    }
    for (const label of OPTION_LABELS) {
      if (options[label].text.trim() === '') {
        setError(`Option ${label} must have text.`);
        return;
      }
      if (label !== correctLabel && options[label].distractorRationale.trim() === '') {
        setError(`Option ${label} is a wrong option and needs a distractor rationale.`);
        return;
      }
    }
    const difficultyNum = Number(authorDifficulty);
    if (!Number.isFinite(difficultyNum) || difficultyNum < 0 || difficultyNum > 1) {
      setError('Author difficulty must be a number in [0, 1].');
      return;
    }
    const expectedTimeNum = Number(expectedTimeSeconds);
    if (!Number.isInteger(expectedTimeNum) || expectedTimeNum <= 0) {
      setError('Expected time (seconds) must be a positive integer.');
      return;
    }
    if (needsDiagram && figureDescription.trim() === '') {
      setError('Figure description is required when this item needs a diagram.');
      return;
    }
    if (needsDiagram && sketchPhoto === null) {
      setError('A sketch photo is required when this item needs a diagram.');
      return;
    }

    setSubmitting(true);
    const result = await onSubmit(
      {
        stem,
        explanation,
        methodSteps: methodStepsText
          .split('\n')
          .map((step) => step.trim())
          .filter((step) => step !== ''),
        cognitiveLevel,
        authorDifficulty: difficultyNum,
        expectedTimeSeconds: expectedTimeNum,
        options: OPTION_LABELS.map((label) => ({
          label,
          text: options[label].text,
          isCorrect: label === correctLabel,
          distractorRationale: label === correctLabel ? null : options[label].distractorRationale,
        })),
        diagramRequest: needsDiagram ? { figureDescription } : null,
      },
      needsDiagram ? sketchPhoto : null,
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSucceeded(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Stem</span>
        <textarea
          aria-label="Stem"
          value={stem}
          onChange={(event) => setStem(event.target.value)}
          className="rounded-lg border-2 border-gray-200 p-3 text-base text-gray-900"
        />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Options</legend>
        {OPTION_LABELS.map((label) => (
          <div key={label} className="flex flex-col gap-1 rounded-lg border-2 border-gray-200 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="correctOption"
                aria-label={`Option ${label} is correct`}
                checked={correctLabel === label}
                onChange={() => setCorrectLabel(label)}
              />
              <span className="font-semibold">{label}</span>
              <input
                aria-label={`Option ${label} text`}
                value={options[label].text}
                onChange={(event) => updateOption(label, { text: event.target.value })}
                className="h-touch flex-1 rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
              />
            </label>
            {label !== correctLabel && (
              <input
                aria-label={`Option ${label} distractor rationale`}
                placeholder="Distractor rationale"
                value={options[label].distractorRationale}
                onChange={(event) => updateOption(label, { distractorRationale: event.target.value })}
                className="h-touch rounded-lg border-2 border-gray-200 px-3 text-sm text-gray-900"
              />
            )}
          </div>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Explanation</span>
        <textarea
          aria-label="Explanation"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          className="rounded-lg border-2 border-gray-200 p-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Method steps (one per line)
        </span>
        <textarea
          aria-label="Method steps"
          value={methodStepsText}
          onChange={(event) => setMethodStepsText(event.target.value)}
          className="rounded-lg border-2 border-gray-200 p-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Cognitive level</span>
        <input
          aria-label="Cognitive level"
          value={cognitiveLevel}
          onChange={(event) => setCognitiveLevel(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Author difficulty (0-1)
        </span>
        <input
          aria-label="Author difficulty"
          value={authorDifficulty}
          onChange={(event) => setAuthorDifficulty(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Expected time (seconds)
        </span>
        <input
          aria-label="Expected time in seconds"
          value={expectedTimeSeconds}
          onChange={(event) => setExpectedTimeSeconds(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="This item needs a diagram"
          checked={needsDiagram}
          onChange={(event) => setNeedsDiagram(event.target.checked)}
        />
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          This item needs a diagram
        </span>
      </label>

      {needsDiagram && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold uppercase tracking-wide text-gray-500">
              Figure description
            </span>
            <textarea
              aria-label="Figure description"
              value={figureDescription}
              onChange={(event) => setFigureDescription(event.target.value)}
              className="rounded-lg border-2 border-gray-200 p-3 text-base text-gray-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold uppercase tracking-wide text-gray-500">
              Sketch photo
            </span>
            <input
              type="file"
              accept="image/*"
              aria-label="Sketch photo"
              onChange={(event) => setSketchPhoto(event.target.files?.[0] ?? null)}
            />
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-reject">
          {error}
        </p>
      )}
      {succeeded && <p className="text-sm font-medium text-approve">Item submitted.</p>}

      <button
        type="submit"
        disabled={submitting}
        className="h-touch rounded-lg bg-selected text-base font-semibold text-white disabled:bg-gray-300"
      >
        Submit item
      </button>
    </form>
  );
}
