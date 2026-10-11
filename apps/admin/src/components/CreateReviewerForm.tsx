'use client';

import { useState, type FormEvent } from 'react';
import {
  ASSIGNABLE_REVIEWER_ROLES,
  parseCreateReviewerAccountInput,
  type AssignableReviewerRole,
  type CreateReviewerAccountInput,
  type SubjectSummary,
} from '@jamb/shared';

export interface CreateReviewerFormProps {
  subjects: SubjectSummary[];
  onSubmit: (input: CreateReviewerAccountInput) => Promise<{ ok: true } | { ok: false; message: string }>;
}

const ROLE_LABELS: Record<AssignableReviewerRole, string> = {
  reviewer: 'Reviewer',
  moderator: 'Subject moderator',
  contributor: 'Contributor',
};

const INPUT_CLASS =
  'h-touch rounded-lg border-2 border-gray-200 px-3 text-base text-gray-900 transition-colors duration-150 focus:border-selected';

const LABEL_CLASS = 'font-semibold uppercase tracking-wide text-muted';

/**
 * Creating a panel account (plan 7.8). Validated with the same
 * `parseCreateReviewerAccountInput` the API runs, so the content lead sees
 * the server's own rule — a reviewer needs a subject, the phone format —
 * before submitting rather than as a 400 after.
 */
export function CreateReviewerForm({ subjects, onSubmit }: CreateReviewerFormProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableReviewerRole>('reviewer');
  const [subjectIds, setSubjectIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleSubject(id: number) {
    setSubjectIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    let input: CreateReviewerAccountInput;
    try {
      input = parseCreateReviewerAccountInput({ fullName, phone, email, role, subjectIds });
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : String(validationError));
      return;
    }

    setSubmitting(true);
    const result = await onSubmit(input);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setFullName('');
    setPhone('');
    setEmail('');
    setRole('reviewer');
    setSubjectIds([]);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Add a panel member"
      className="m-6 flex flex-col gap-4 rounded-xl border border-gray-200 bg-surface p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">Add a panel member</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span className={LABEL_CLASS}>Full name</span>
        <input
          aria-label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className={LABEL_CLASS}>Phone</span>
        <input
          aria-label="Phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+2348031234567"
          className={INPUT_CLASS}
        />
        <span className="text-xs text-muted">
          Digits only, no spaces. They can sign in with exactly what you type here.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className={LABEL_CLASS}>Email</span>
        <input
          aria-label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className={LABEL_CLASS}>Role</span>
        <select
          aria-label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as AssignableReviewerRole)}
          className={INPUT_CLASS}
        >
          {ASSIGNABLE_REVIEWER_ROLES.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className={`${LABEL_CLASS} pb-1`}>Subjects</legend>
        {subjects.length === 0 ? (
          <span className="text-muted">No subjects exist yet.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <label
                key={subject.id}
                className="flex h-touch cursor-pointer items-center gap-2 rounded-lg border-2 border-gray-200 px-3 has-[:checked]:border-selected has-[:checked]:bg-selected-bg"
              >
                <input
                  type="checkbox"
                  checked={subjectIds.includes(subject.id)}
                  onChange={() => toggleSubject(subject.id)}
                />
                {subject.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm font-medium text-reject">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="h-touch rounded-lg bg-selected text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-blue-700 disabled:bg-gray-300 disabled:shadow-none"
      >
        Create account
      </button>
    </form>
  );
}
