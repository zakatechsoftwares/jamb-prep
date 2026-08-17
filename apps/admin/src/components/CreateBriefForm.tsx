'use client';

import { useState, type FormEvent } from 'react';
import type { CreateBriefInput } from '@jamb/shared';

export interface CreateBriefFormProps {
  /** Pre-filled from the gap the content lead clicked "create brief" on, if any. */
  initialObjectiveId?: number;
  onSubmit: (input: CreateBriefInput) => Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * The brief-creation form (plan 7.12 step 2). `difficultySpread` and
 * `cognitiveLevels` are free-form JSON — matching how the database stores
 * them (JSONB, no fixed schema) — rather than a bespoke structured picker
 * not asked for by the plan. Parsed and validated client-side before
 * submit, so a malformed JSON object is caught immediately rather than
 * surfacing as a confusing 400 from the server.
 */
export function CreateBriefForm({ initialObjectiveId, onSubmit }: CreateBriefFormProps) {
  const [objectiveId, setObjectiveId] = useState(initialObjectiveId?.toString() ?? '');
  const [itemCount, setItemCount] = useState('1');
  const [difficultySpread, setDifficultySpread] = useState('{"easy": 1}');
  const [cognitiveLevels, setCognitiveLevels] = useState('{"recall": 1}');
  const [styleNotes, setStyleNotes] = useState('');
  const [feeNaira, setFeeNaira] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const objectiveIdNum = Number(objectiveId);
    const itemCountNum = Number(itemCount);
    const feeNairaNum = Number(feeNaira);

    if (!Number.isInteger(objectiveIdNum) || objectiveIdNum <= 0) {
      setError('Objective id must be a positive integer.');
      return;
    }
    if (!Number.isInteger(itemCountNum) || itemCountNum <= 0) {
      setError('Item count must be a positive integer.');
      return;
    }
    if (!Number.isFinite(feeNairaNum) || feeNairaNum < 0) {
      setError('Fee must be a non-negative number.');
      return;
    }
    if (!deadline) {
      setError('Deadline is required.');
      return;
    }

    let difficultySpreadParsed: Record<string, unknown>;
    let cognitiveLevelsParsed: Record<string, unknown>;
    try {
      difficultySpreadParsed = JSON.parse(difficultySpread) as Record<string, unknown>;
    } catch {
      setError('Difficulty spread must be valid JSON, e.g. {"easy": 2, "moderate": 1}.');
      return;
    }
    try {
      cognitiveLevelsParsed = JSON.parse(cognitiveLevels) as Record<string, unknown>;
    } catch {
      setError('Cognitive levels must be valid JSON, e.g. {"recall": 2, "application": 1}.');
      return;
    }

    setSubmitting(true);
    const result = await onSubmit({
      objectiveId: objectiveIdNum,
      itemCount: itemCountNum,
      difficultySpread: difficultySpreadParsed,
      cognitiveLevels: cognitiveLevelsParsed,
      styleNotes: styleNotes.trim() === '' ? null : styleNotes,
      feeKobo: Math.round(feeNairaNum * 100),
      deadline: new Date(deadline).toISOString(),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSucceeded(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-gray-900">Create a brief</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Objective id</span>
        <input
          aria-label="Objective id"
          value={objectiveId}
          onChange={(event) => setObjectiveId(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Item count</span>
        <input
          aria-label="Item count"
          value={itemCount}
          onChange={(event) => setItemCount(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Difficulty spread (JSON)
        </span>
        <input
          aria-label="Difficulty spread"
          value={difficultySpread}
          onChange={(event) => setDifficultySpread(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">
          Cognitive levels (JSON)
        </span>
        <input
          aria-label="Cognitive levels"
          value={cognitiveLevels}
          onChange={(event) => setCognitiveLevels(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Style notes</span>
        <textarea
          aria-label="Style notes"
          value={styleNotes}
          onChange={(event) => setStyleNotes(event.target.value)}
          className="rounded-lg border-2 border-gray-200 p-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Fee (₦)</span>
        <input
          aria-label="Fee in naira"
          value={feeNaira}
          onChange={(event) => setFeeNaira(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Deadline</span>
        <input
          aria-label="Deadline"
          type="date"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          className="h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm font-medium text-reject">
          {error}
        </p>
      )}
      {succeeded && <p className="text-sm font-medium text-approve">Brief created.</p>}

      <button
        type="submit"
        disabled={submitting}
        className="h-touch rounded-lg bg-selected text-base font-semibold text-white disabled:bg-gray-300"
      >
        Create brief
      </button>
    </form>
  );
}
